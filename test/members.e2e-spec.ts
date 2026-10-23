import { createTestApp, resetDatabase, type TestApp } from './support/test-app.js';
import { createAdmin, registerUser, type TestUser } from './support/users.js';
import {
  addMembership,
  archiveWorkspace,
  createWorkspace,
  insertPage,
} from './support/workspaces.js';

describe('Workspace members API (e2e)', () => {
  let testApp: TestApp;
  let owner: TestUser;
  let coOwner: TestUser;
  let member: TestUser;
  let candidate: TestUser;
  let outsider: TestUser;
  let workspaceId: string;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(testApp.prisma);
    owner = await registerUser(testApp, 'STUDENT', { firstName: 'Olivia', lastName: 'Owner' });
    coOwner = await registerUser(testApp, 'LECTURER');
    member = await registerUser(testApp);
    candidate = await registerUser(testApp, 'STUDENT', { firstName: 'Cam', lastName: 'Didate' });
    outsider = await registerUser(testApp);
    workspaceId = (await createWorkspace(testApp, owner)).id;
    await addMembership(testApp, workspaceId, coOwner, 'CO_OWNER');
    await addMembership(testApp, workspaceId, member, 'MEMBER');
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  const http = () => testApp.http();
  const membersPath = () => `/api/workspaces/${workspaceId}/members`;

  async function personalWorkspaceId(user: TestUser) {
    const response = await http().get('/api/workspaces').set(user.auth).expect(200);
    return response.body.find((w: { type: string }) => w.type === 'PERSONAL').id as string;
  }

  describe('GET /workspaces/:id/members', () => {
    it('lists members with their user details, Owner first', async () => {
      const response = await http().get(membersPath()).set(member.auth).expect(200);

      expect(
        response.body.map((m: { userId: string; role: string }) => [m.userId, m.role]),
      ).toEqual([
        [owner.id, 'OWNER'],
        [coOwner.id, 'CO_OWNER'],
        [member.id, 'MEMBER'],
      ]);
      expect(response.body[0]).toEqual({
        userId: owner.id,
        role: 'OWNER',
        joinedAt: expect.any(String),
        user: { id: owner.id, email: owner.email, firstName: 'Olivia', lastName: 'Owner' },
      });
      expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    });

    it('hides the list from non-members and admins', async () => {
      await http().get(membersPath()).set(outsider.auth).expect(404);
      const admin = await createAdmin(testApp);
      await http().get(membersPath()).set(admin.auth).expect(403);
    });

    it('stays readable in an archived workspace', async () => {
      await archiveWorkspace(testApp, workspaceId);
      await http().get(membersPath()).set(member.auth).expect(200);
    });
  });

  describe('POST /workspaces/:id/members', () => {
    it('lets the Owner add a Member or a Co-owner by email', async () => {
      const added = await http()
        .post(membersPath())
        .set(owner.auth)
        .send({ email: candidate.email, role: 'CO_OWNER' })
        .expect(201);
      expect(added.body).toEqual({
        userId: candidate.id,
        role: 'CO_OWNER',
        joinedAt: expect.any(String),
        user: { id: candidate.id, email: candidate.email, firstName: 'Cam', lastName: 'Didate' },
      });

      await http()
        .post(membersPath())
        .set(owner.auth)
        .send({ email: outsider.email, role: 'MEMBER' })
        .expect(201);
      const workspace = await http()
        .get(`/api/workspaces/${workspaceId}`)
        .set(owner.auth)
        .expect(200);
      expect(workspace.body.memberCount).toBe(5);
    });

    it('matches the email case-insensitively and ignores surrounding spaces', async () => {
      await http()
        .post(membersPath())
        .set(owner.auth)
        .send({ email: `  ${candidate.email.toUpperCase()} `, role: 'MEMBER' })
        .expect(201);
    });

    it('gives the added user access to the workspace and its pages', async () => {
      const page = await insertPage(testApp, workspaceId, 'Shared');
      await http().get(`/api/pages/${page.id}`).set(candidate.auth).expect(404);

      await http()
        .post(membersPath())
        .set(owner.auth)
        .send({ email: candidate.email, role: 'MEMBER' })
        .expect(201);

      await http().get(`/api/pages/${page.id}`).set(candidate.auth).expect(200);
      const list = await http().get('/api/workspaces').set(candidate.auth).expect(200);
      expect(list.body.map((w: { id: string }) => w.id)).toContain(workspaceId);
    });

    it('lets a Co-owner add Members but not Co-owners', async () => {
      await http()
        .post(membersPath())
        .set(coOwner.auth)
        .send({ email: candidate.email, role: 'MEMBER' })
        .expect(201);

      const response = await http()
        .post(membersPath())
        .set(coOwner.auth)
        .send({ email: outsider.email, role: 'CO_OWNER' })
        .expect(403);
      expect(response.body.message).toBe('You cannot add members with this role');
    });

    it('forbids Members from adding anyone', async () => {
      await http()
        .post(membersPath())
        .set(member.auth)
        .send({ email: candidate.email, role: 'MEMBER' })
        .expect(403);
    });

    it('returns 404 for an unknown email and 409 for an existing member', async () => {
      const unknown = await http()
        .post(membersPath())
        .set(owner.auth)
        .send({ email: 'nobody@example.com', role: 'MEMBER' })
        .expect(404);
      expect(unknown.body.message).toBe('No user with this email');

      const duplicate = await http()
        .post(membersPath())
        .set(owner.auth)
        .send({ email: member.email, role: 'CO_OWNER' })
        .expect(409);
      expect(duplicate.body.message).toBe('This user is already a member');

      await http()
        .post(membersPath())
        .set(owner.auth)
        .send({ email: owner.email, role: 'MEMBER' })
        .expect(409);
    });

    it('returns 409 rather than 500 when the same user is added twice at once', async () => {
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          http()
            .post(membersPath())
            .set(owner.auth)
            .send({ email: candidate.email, role: 'MEMBER' }),
        ),
      );

      expect(results.map((result) => result.status).sort()).toEqual([201, 409, 409, 409]);
    });

    it('refuses to add administrators', async () => {
      const admin = await createAdmin(testApp);
      await http()
        .post(membersPath())
        .set(owner.auth)
        .send({ email: admin.email, role: 'MEMBER' })
        .expect(400);
    });

    it('never adds collaborators to a personal workspace', async () => {
      const personalId = await personalWorkspaceId(owner);

      const response = await http()
        .post(`/api/workspaces/${personalId}/members`)
        .set(owner.auth)
        .send({ email: candidate.email, role: 'MEMBER' })
        .expect(409);
      expect(response.body.message).toBe('The personal workspace has no collaborators');
    });

    it('rejects adds to an archived workspace', async () => {
      await archiveWorkspace(testApp, workspaceId);
      await http()
        .post(membersPath())
        .set(owner.auth)
        .send({ email: candidate.email, role: 'MEMBER' })
        .expect(409);
    });

    it('hides the workspace from non-members', async () => {
      await http()
        .post(membersPath())
        .set(outsider.auth)
        .send({ email: candidate.email, role: 'MEMBER' })
        .expect(404);
    });

    it.each([
      ['OWNER role', { email: 'a@example.com', role: 'OWNER' }],
      ['unknown role', { email: 'a@example.com', role: 'ADMIN' }],
      ['missing role', { email: 'a@example.com' }],
      ['invalid email', { email: 'not-an-email', role: 'MEMBER' }],
      ['missing email', { role: 'MEMBER' }],
      ['unknown field', { email: 'a@example.com', role: 'MEMBER', userId: 'x' }],
    ])('rejects %s with 400', async (_label, body) => {
      await http().post(membersPath()).set(owner.auth).send(body).expect(400);
    });
  });

  describe('DELETE /workspaces/:id/members/:userId', () => {
    it('lets the Owner remove Co-owners and Members', async () => {
      await http().delete(`${membersPath()}/${coOwner.id}`).set(owner.auth).expect(204);
      await http().delete(`${membersPath()}/${member.id}`).set(owner.auth).expect(204);

      const list = await http().get(membersPath()).set(owner.auth).expect(200);
      expect(list.body.map((m: { userId: string }) => m.userId)).toEqual([owner.id]);
    });

    it('lets a Co-owner remove Members only', async () => {
      const other = await registerUser(testApp, 'LECTURER');
      await addMembership(testApp, workspaceId, other, 'CO_OWNER');

      const response = await http()
        .delete(`${membersPath()}/${other.id}`)
        .set(coOwner.auth)
        .expect(403);
      expect(response.body.message).toBe('You cannot remove this member');
      await http().delete(`${membersPath()}/${member.id}`).set(coOwner.auth).expect(204);
    });

    it('forbids Members from removing anyone, including themselves', async () => {
      const other = await registerUser(testApp);
      await addMembership(testApp, workspaceId, other, 'MEMBER');

      await http().delete(`${membersPath()}/${other.id}`).set(member.auth).expect(403);
      await http().delete(`${membersPath()}/${member.id}`).set(member.auth).expect(403);
    });

    it('never removes the Owner', async () => {
      for (const user of [owner, coOwner]) {
        const response = await http()
          .delete(`${membersPath()}/${owner.id}`)
          .set(user.auth)
          .expect(403);
        expect(response.body.message).toBe('Owner membership cannot be changed');
      }
    });

    it('revokes access to the workspace and its pages immediately', async () => {
      const page = await insertPage(testApp, workspaceId, 'Shared');
      await http().get(`/api/pages/${page.id}`).set(member.auth).expect(200);

      await http().delete(`${membersPath()}/${member.id}`).set(owner.auth).expect(204);

      await http().get(`/api/pages/${page.id}`).set(member.auth).expect(404);
      await http().patch(`/api/pages/${page.id}`).set(member.auth).send({ title: 'x' }).expect(404);
      await http().get(`/api/workspaces/${workspaceId}`).set(member.auth).expect(404);
      const list = await http().get('/api/workspaces').set(member.auth).expect(200);
      expect(list.body.map((w: { id: string }) => w.id)).not.toContain(workspaceId);
    });

    it('returns 404 for a user who is not a member', async () => {
      const response = await http()
        .delete(`${membersPath()}/${outsider.id}`)
        .set(owner.auth)
        .expect(404);
      expect(response.body.message).toBe('Member not found');
    });

    it('rejects removals in an archived workspace', async () => {
      await archiveWorkspace(testApp, workspaceId);
      await http().delete(`${membersPath()}/${member.id}`).set(owner.auth).expect(409);
    });

    it('hides the workspace from non-members', async () => {
      await http().delete(`${membersPath()}/${member.id}`).set(outsider.auth).expect(404);
      expect(await testApp.prisma.workspaceMembership.count({ where: { workspaceId } })).toBe(3);
    });
  });
});
