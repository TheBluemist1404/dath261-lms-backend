import { createTestApp, resetDatabase, type TestApp } from './support/test-app.js';
import { createAdmin, registerUser, type TestUser } from './support/users.js';
import { addMembership, archiveWorkspace, createWorkspace } from './support/workspaces.js';

describe('Workspaces API (e2e)', () => {
  let testApp: TestApp;
  let owner: TestUser;
  let coOwner: TestUser;
  let member: TestUser;
  let outsider: TestUser;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(testApp.prisma);
    owner = await registerUser(testApp);
    coOwner = await registerUser(testApp, 'LECTURER');
    member = await registerUser(testApp);
    outsider = await registerUser(testApp);
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  const http = () => testApp.http();

  async function sharedWorkspace(name = 'Study group') {
    const workspace = await createWorkspace(testApp, owner, name);
    await addMembership(testApp, workspace.id, coOwner, 'CO_OWNER');
    await addMembership(testApp, workspace.id, member, 'MEMBER');
    return workspace;
  }

  describe('authentication and platform role', () => {
    it('rejects requests without an access token', async () => {
      await http().get('/api/workspaces').expect(401);
      await http().post('/api/workspaces').send({ name: 'x' }).expect(401);
    });

    it('rejects an invalid access token', async () => {
      await http().get('/api/workspaces').set('Authorization', 'Bearer not-a-jwt').expect(401);
    });

    it('gives administrators no workspace workflow', async () => {
      const admin = await createAdmin(testApp);

      await http().get('/api/workspaces').set(admin.auth).expect(403);
      await http().post('/api/workspaces').set(admin.auth).send({ name: 'Admin' }).expect(403);
      expect(await testApp.prisma.workspace.count({ where: { createdById: admin.id } })).toBe(0);
    });

    it('allows lecturers as well as students', async () => {
      await http().get('/api/workspaces').set(coOwner.auth).expect(200);
    });
  });

  describe('GET /workspaces', () => {
    it('creates the personal workspace on first use and records it as the default', async () => {
      const response = await http().get('/api/workspaces').set(owner.auth).expect(200);

      expect(response.body).toHaveLength(1);
      const [personal] = response.body;
      expect(personal).toMatchObject({
        name: 'My personal workspace',
        type: 'PERSONAL',
        currentUserRole: 'OWNER',
        pageCount: 0,
        memberCount: 1,
        archivedAt: null,
      });

      const user = await testApp.prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
      expect(user.defaultWorkspaceId).toBe(personal.id);
    });

    it('does not create a second personal workspace on later or concurrent calls', async () => {
      await Promise.all(
        Array.from({ length: 5 }, () => http().get('/api/workspaces').set(owner.auth).expect(200)),
      );
      await http().get('/api/workspaces').set(owner.auth).expect(200);

      expect(
        await testApp.prisma.workspace.count({
          where: { createdById: owner.id, type: 'PERSONAL' },
        }),
      ).toBe(1);
    });

    it('lists only the caller memberships, personal first, then oldest first', async () => {
      const first = await createWorkspace(testApp, owner, 'First');
      const second = await createWorkspace(testApp, owner, 'Second');
      await createWorkspace(testApp, outsider, 'Not mine');
      await addMembership(testApp, second.id, member, 'MEMBER');

      const ownerList = await http().get('/api/workspaces').set(owner.auth).expect(200);
      expect(ownerList.body.map((w: { name: string }) => w.name)).toEqual([
        'My personal workspace',
        'First',
        'Second',
      ]);
      expect(ownerList.body.find((w: { id: string }) => w.id === first.id).memberCount).toBe(1);

      const memberList = await http().get('/api/workspaces').set(member.auth).expect(200);
      expect(
        memberList.body.map((w: { name: string; currentUserRole: string }) => [
          w.name,
          w.currentUserRole,
        ]),
      ).toEqual([
        ['My personal workspace', 'OWNER'],
        ['Second', 'MEMBER'],
      ]);
    });

    it('separates active and archived workspaces', async () => {
      const active = await createWorkspace(testApp, owner, 'Active');
      const archived = await createWorkspace(testApp, owner, 'Old');
      await archiveWorkspace(testApp, archived.id);

      const activeList = await http().get('/api/workspaces').set(owner.auth).expect(200);
      expect(activeList.body.map((w: { id: string }) => w.id)).toContain(active.id);
      expect(activeList.body.map((w: { id: string }) => w.id)).not.toContain(archived.id);

      const explicitActive = await http()
        .get('/api/workspaces?archived=false')
        .set(owner.auth)
        .expect(200);
      expect(explicitActive.body).toHaveLength(activeList.body.length);

      const archivedList = await http()
        .get('/api/workspaces?archived=true')
        .set(owner.auth)
        .expect(200);
      expect(archivedList.body.map((w: { id: string }) => w.id)).toEqual([archived.id]);
      expect(archivedList.body[0].archivedAt).not.toBeNull();
    });

    it('rejects a malformed archived flag', async () => {
      await http().get('/api/workspaces?archived=yes').set(owner.auth).expect(400);
    });

    it('counts pages and members', async () => {
      const workspace = await sharedWorkspace();
      await testApp.prisma.page.createMany({
        data: [
          { workspaceId: workspace.id, title: 'One' },
          { workspaceId: workspace.id, title: 'Two' },
        ],
      });

      const response = await http()
        .get(`/api/workspaces/${workspace.id}`)
        .set(member.auth)
        .expect(200);
      expect(response.body).toMatchObject({ pageCount: 2, memberCount: 3 });
    });
  });

  describe('POST /workspaces', () => {
    it('creates a collaborative workspace with the caller as Owner', async () => {
      const response = await http()
        .post('/api/workspaces')
        .set(owner.auth)
        .send({ name: '  Algorithms  ' })
        .expect(201);

      expect(response.body).toMatchObject({
        name: 'Algorithms',
        type: 'COLLABORATIVE',
        currentUserRole: 'OWNER',
        pageCount: 0,
        memberCount: 1,
        archivedAt: null,
      });
      expect(Date.parse(response.body.createdAt)).not.toBeNaN();

      const membership = await testApp.prisma.workspaceMembership.findUniqueOrThrow({
        where: { workspaceId_userId: { workspaceId: response.body.id, userId: owner.id } },
      });
      expect(membership.role).toBe('OWNER');
    });

    it('accepts a 100 character name', async () => {
      await http()
        .post('/api/workspaces')
        .set(owner.auth)
        .send({ name: 'a'.repeat(100) })
        .expect(201);
    });

    it.each([
      ['missing name', {}],
      ['empty name', { name: '' }],
      ['whitespace name', { name: '   ' }],
      ['name over 100 characters', { name: 'a'.repeat(101) }],
      ['non-string name', { name: 42 }],
      ['unknown field', { name: 'Ok', type: 'PERSONAL' }],
    ])('rejects %s with 400', async (_label, body) => {
      await http().post('/api/workspaces').set(owner.auth).send(body).expect(400);
    });
  });

  describe('GET /workspaces/:id', () => {
    it('returns the workspace with the caller role to each member', async () => {
      const workspace = await sharedWorkspace();

      for (const [user, role] of [
        [owner, 'OWNER'],
        [coOwner, 'CO_OWNER'],
        [member, 'MEMBER'],
      ] as const) {
        const response = await http()
          .get(`/api/workspaces/${workspace.id}`)
          .set(user.auth)
          .expect(200);
        expect(response.body.currentUserRole).toBe(role);
      }
    });

    it('returns 404 to non-members and for unknown ids', async () => {
      const workspace = await sharedWorkspace();

      const hidden = await http()
        .get(`/api/workspaces/${workspace.id}`)
        .set(outsider.auth)
        .expect(404);
      expect(hidden.body).toMatchObject({ statusCode: 404, error: 'Not Found' });
      await http().get('/api/workspaces/does-not-exist').set(owner.auth).expect(404);
    });

    it('keeps archived workspaces readable by members', async () => {
      const workspace = await sharedWorkspace();
      await archiveWorkspace(testApp, workspace.id);

      await http().get(`/api/workspaces/${workspace.id}`).set(member.auth).expect(200);
    });
  });

  describe('PATCH /workspaces/:id', () => {
    it('lets the Owner rename the workspace', async () => {
      const workspace = await sharedWorkspace();

      const response = await http()
        .patch(`/api/workspaces/${workspace.id}`)
        .set(owner.auth)
        .send({ name: ' Renamed ' })
        .expect(200);
      expect(response.body).toMatchObject({
        name: 'Renamed',
        currentUserRole: 'OWNER',
        memberCount: 3,
      });
    });

    it('lets the Owner rename the personal workspace', async () => {
      const list = await http().get('/api/workspaces').set(owner.auth).expect(200);

      await http()
        .patch(`/api/workspaces/${list.body[0].id}`)
        .set(owner.auth)
        .send({ name: 'Notes' })
        .expect(200);
    });

    it('forbids Co-owners and Members', async () => {
      const workspace = await sharedWorkspace();

      for (const user of [coOwner, member]) {
        const response = await http()
          .patch(`/api/workspaces/${workspace.id}`)
          .set(user.auth)
          .send({ name: 'Nope' })
          .expect(403);
        expect(response.body.message).toBe('Only an Owner can rename this workspace');
      }
    });

    it('hides the workspace from non-members', async () => {
      const workspace = await sharedWorkspace();
      await http()
        .patch(`/api/workspaces/${workspace.id}`)
        .set(outsider.auth)
        .send({ name: 'x' })
        .expect(404);
    });

    it('rejects edits to an archived workspace', async () => {
      const workspace = await sharedWorkspace();
      await archiveWorkspace(testApp, workspace.id);

      await http()
        .patch(`/api/workspaces/${workspace.id}`)
        .set(owner.auth)
        .send({ name: 'x' })
        .expect(409);
    });

    it('validates the name', async () => {
      const workspace = await sharedWorkspace();
      await http()
        .patch(`/api/workspaces/${workspace.id}`)
        .set(owner.auth)
        .send({ name: '' })
        .expect(400);
    });
  });

  describe('archive and restore', () => {
    it('lets the Owner archive and restore a collaborative workspace', async () => {
      const workspace = await sharedWorkspace();

      const archived = await http()
        .post(`/api/workspaces/${workspace.id}/archive`)
        .set(owner.auth)
        .expect(200);
      expect(archived.body.archivedAt).not.toBeNull();

      const memberArchived = await http()
        .get('/api/workspaces?archived=true')
        .set(member.auth)
        .expect(200);
      expect(memberArchived.body.map((w: { id: string }) => w.id)).toEqual([workspace.id]);

      const restored = await http()
        .post(`/api/workspaces/${workspace.id}/restore`)
        .set(owner.auth)
        .expect(200);
      expect(restored.body.archivedAt).toBeNull();
    });

    it('never archives the personal workspace', async () => {
      const list = await http().get('/api/workspaces').set(owner.auth).expect(200);

      const response = await http()
        .post(`/api/workspaces/${list.body[0].id}/archive`)
        .set(owner.auth)
        .expect(409);
      expect(response.body.message).toBe('The personal workspace cannot be archived');
    });

    it('rejects archiving twice and restoring an active workspace', async () => {
      const workspace = await sharedWorkspace();

      await http().post(`/api/workspaces/${workspace.id}/restore`).set(owner.auth).expect(409);
      await http().post(`/api/workspaces/${workspace.id}/archive`).set(owner.auth).expect(200);
      await http().post(`/api/workspaces/${workspace.id}/archive`).set(owner.auth).expect(409);
    });

    it('forbids Co-owners and Members and hides from non-members', async () => {
      const workspace = await sharedWorkspace();

      for (const user of [coOwner, member]) {
        await http().post(`/api/workspaces/${workspace.id}/archive`).set(user.auth).expect(403);
      }
      await http().post(`/api/workspaces/${workspace.id}/archive`).set(outsider.auth).expect(404);

      await archiveWorkspace(testApp, workspace.id);
      for (const user of [coOwner, member]) {
        await http().post(`/api/workspaces/${workspace.id}/restore`).set(user.auth).expect(403);
      }
      await http().post(`/api/workspaces/${workspace.id}/restore`).set(outsider.auth).expect(404);
    });
  });
});
