import { createCourse } from './support/courses.js';
import { createTestApp, resetDatabase, type TestApp } from './support/test-app.js';
import { createAdmin, registerUser, type TestUser } from './support/users.js';
import {
  addMembership,
  archiveWorkspace,
  createWorkspace,
  insertPage,
} from './support/workspaces.js';

const lexicalState = {
  root: {
    type: 'root',
    children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Dynamic programming' }] }],
  },
};

describe('Pages API (e2e)', () => {
  let testApp: TestApp;
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let workspaceId: string;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(testApp.prisma);
    owner = await registerUser(testApp);
    member = await registerUser(testApp);
    outsider = await registerUser(testApp);
    workspaceId = (await createWorkspace(testApp, owner)).id;
    await addMembership(testApp, workspaceId, member, 'MEMBER');
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  const http = () => testApp.http();

  describe('GET /workspaces/:id/pages', () => {
    it('returns a flat list of summaries without content', async () => {
      const root = await insertPage(testApp, workspaceId, 'Root');
      await insertPage(testApp, workspaceId, 'Child', root.id);
      await testApp.prisma.page.update({ where: { id: root.id }, data: { content: lexicalState } });

      const response = await http()
        .get(`/api/workspaces/${workspaceId}/pages`)
        .set(member.auth)
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body[0]).toEqual({
        id: root.id,
        workspaceId,
        title: 'Root',
        parentPageId: null,
        archivedAt: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(response.body[1]).toMatchObject({ title: 'Child', parentPageId: root.id });
    });

    it('only lists pages of the requested workspace', async () => {
      const other = await createWorkspace(testApp, owner, 'Other');
      await insertPage(testApp, other.id, 'Elsewhere');
      await insertPage(testApp, workspaceId, 'Here');

      const response = await http()
        .get(`/api/workspaces/${workspaceId}/pages`)
        .set(owner.auth)
        .expect(200);
      expect(response.body.map((page: { title: string }) => page.title)).toEqual(['Here']);
    });

    it('hides the workspace from non-members and admins', async () => {
      await http().get(`/api/workspaces/${workspaceId}/pages`).set(outsider.auth).expect(404);
      await http().get('/api/workspaces/unknown/pages').set(owner.auth).expect(404);
      const admin = await createAdmin(testApp);
      await http().get(`/api/workspaces/${workspaceId}/pages`).set(admin.auth).expect(403);
    });

    it('stays readable in an archived workspace', async () => {
      await insertPage(testApp, workspaceId, 'Kept');
      await archiveWorkspace(testApp, workspaceId);

      const response = await http()
        .get(`/api/workspaces/${workspaceId}/pages`)
        .set(member.auth)
        .expect(200);
      expect(response.body).toHaveLength(1);
    });
  });

  describe('POST /workspaces/:id/pages', () => {
    it('lets any member create a top-level page', async () => {
      const response = await http()
        .post(`/api/workspaces/${workspaceId}/pages`)
        .set(member.auth)
        .send({ title: '  Week 3  ' })
        .expect(201);

      expect(response.body).toEqual({
        id: expect.any(String),
        workspaceId,
        title: 'Week 3',
        parentPageId: null,
        archivedAt: null,
        content: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it('creates a subpage under a parent in the same workspace', async () => {
      const parent = await insertPage(testApp, workspaceId, 'Parent');

      const response = await http()
        .post(`/api/workspaces/${workspaceId}/pages`)
        .set(owner.auth)
        .send({ title: 'Child', parentPageId: parent.id })
        .expect(201);
      expect(response.body.parentPageId).toBe(parent.id);
    });

    it('accepts an explicit null parent', async () => {
      await http()
        .post(`/api/workspaces/${workspaceId}/pages`)
        .set(owner.auth)
        .send({ title: 'Root', parentPageId: null })
        .expect(201);
    });

    it('rejects a parent from another workspace or one that does not exist', async () => {
      const other = await createWorkspace(testApp, owner, 'Other');
      const foreign = await insertPage(testApp, other.id, 'Foreign');

      for (const parentPageId of [foreign.id, 'missing']) {
        const response = await http()
          .post(`/api/workspaces/${workspaceId}/pages`)
          .set(owner.auth)
          .send({ title: 'Child', parentPageId })
          .expect(400);
        expect(response.body.message).toBe('parentPageId must be an active page in this workspace');
      }
    });

    it('accepts a 200 character title', async () => {
      await http()
        .post(`/api/workspaces/${workspaceId}/pages`)
        .set(owner.auth)
        .send({ title: 'a'.repeat(200) })
        .expect(201);
    });

    it.each([
      ['missing title', {}],
      ['empty title', { title: '' }],
      ['whitespace title', { title: '  ' }],
      ['title over 200 characters', { title: 'a'.repeat(201) }],
      ['numeric parent', { title: 'x', parentPageId: 5 }],
      ['content on create', { title: 'x', content: {} }],
    ])('rejects %s with 400', async (_label, body) => {
      await http()
        .post(`/api/workspaces/${workspaceId}/pages`)
        .set(owner.auth)
        .send(body)
        .expect(400);
    });

    it('rejects writes to an archived workspace', async () => {
      await archiveWorkspace(testApp, workspaceId);
      await http()
        .post(`/api/workspaces/${workspaceId}/pages`)
        .set(owner.auth)
        .send({ title: 'x' })
        .expect(409);
    });

    it('hides the workspace from non-members', async () => {
      await http()
        .post(`/api/workspaces/${workspaceId}/pages`)
        .set(outsider.auth)
        .send({ title: 'x' })
        .expect(404);
      expect(await testApp.prisma.page.count()).toBe(0);
    });
  });

  describe('GET /pages/:id', () => {
    it('returns the page with its content to members', async () => {
      const page = await insertPage(testApp, workspaceId, 'Notes');
      await testApp.prisma.page.update({ where: { id: page.id }, data: { content: lexicalState } });

      const response = await http().get(`/api/pages/${page.id}`).set(member.auth).expect(200);
      expect(response.body).toMatchObject({ id: page.id, title: 'Notes', content: lexicalState });
    });

    it('returns 404 to non-members and for unknown pages', async () => {
      const page = await insertPage(testApp, workspaceId, 'Private');

      const hidden = await http().get(`/api/pages/${page.id}`).set(outsider.auth).expect(404);
      expect(hidden.body.message).toBe('Page not found');
      const missing = await http().get('/api/pages/missing').set(owner.auth).expect(404);
      expect(missing.body.message).toBe('Page not found');
    });

    it('requires authentication', async () => {
      const page = await insertPage(testApp, workspaceId, 'Private');
      await http().get(`/api/pages/${page.id}`).expect(401);
    });
  });

  describe('PATCH /pages/:id', () => {
    it('renames a page', async () => {
      const page = await insertPage(testApp, workspaceId, 'Old');

      const response = await http()
        .patch(`/api/pages/${page.id}`)
        .set(member.auth)
        .send({ title: ' New ' })
        .expect(200);
      expect(response.body.title).toBe('New');
    });

    it('saves editor content and bumps updatedAt', async () => {
      const page = await insertPage(testApp, workspaceId, 'Notes');

      const response = await http()
        .patch(`/api/pages/${page.id}`)
        .set(member.auth)
        .send({ content: lexicalState })
        .expect(200);
      expect(response.body.content).toEqual(lexicalState);
      expect(Date.parse(response.body.updatedAt)).toBeGreaterThan(page.updatedAt.getTime());

      const reread = await http().get(`/api/pages/${page.id}`).set(owner.auth).expect(200);
      expect(reread.body.content).toEqual(lexicalState);
      expect(reread.body.title).toBe('Notes');
    });

    it('clears content with null', async () => {
      const page = await insertPage(testApp, workspaceId, 'Notes');
      await testApp.prisma.page.update({ where: { id: page.id }, data: { content: lexicalState } });

      const response = await http()
        .patch(`/api/pages/${page.id}`)
        .set(owner.auth)
        .send({ content: null })
        .expect(200);
      expect(response.body.content).toBeNull();
    });

    it('stores a document larger than the default 100 kB body limit', async () => {
      const page = await insertPage(testApp, workspaceId, 'Long');
      const content = {
        root: {
          type: 'root',
          children: Array.from({ length: 3000 }, (_, index) => ({
            type: 'paragraph',
            children: [{ type: 'text', text: `Paragraph ${index} ${'x'.repeat(100)}` }],
          })),
        },
      };

      expect(JSON.stringify(content).length).toBeGreaterThan(400_000);
      await http().patch(`/api/pages/${page.id}`).set(owner.auth).send({ content }).expect(200);
      const reread = await http().get(`/api/pages/${page.id}`).set(owner.auth).expect(200);
      expect(reread.body.content.root.children).toHaveLength(3000);
    });

    it('moves a page under a sibling and back to the top level', async () => {
      const a = await insertPage(testApp, workspaceId, 'A');
      const b = await insertPage(testApp, workspaceId, 'B');

      const moved = await http()
        .patch(`/api/pages/${b.id}`)
        .set(owner.auth)
        .send({ parentPageId: a.id })
        .expect(200);
      expect(moved.body.parentPageId).toBe(a.id);

      const back = await http()
        .patch(`/api/pages/${b.id}`)
        .set(owner.auth)
        .send({ parentPageId: null })
        .expect(200);
      expect(back.body.parentPageId).toBeNull();
    });

    it('refuses to move a page under itself or a descendant', async () => {
      const root = await insertPage(testApp, workspaceId, 'Root');
      const child = await insertPage(testApp, workspaceId, 'Child', root.id);
      const grandchild = await insertPage(testApp, workspaceId, 'Grandchild', child.id);

      for (const parentPageId of [root.id, child.id, grandchild.id]) {
        const response = await http()
          .patch(`/api/pages/${root.id}`)
          .set(owner.auth)
          .send({ parentPageId })
          .expect(400);
        expect(response.body.message).toBe(
          'parentPageId must be another page outside this subtree',
        );
      }

      // Moving a grandchild up under its grandparent is fine.
      await http()
        .patch(`/api/pages/${grandchild.id}`)
        .set(owner.auth)
        .send({ parentPageId: root.id })
        .expect(200);
    });

    it('refuses a parent in another workspace or one that does not exist', async () => {
      const page = await insertPage(testApp, workspaceId, 'Page');
      const other = await createWorkspace(testApp, owner, 'Other');
      const foreign = await insertPage(testApp, other.id, 'Foreign');

      for (const parentPageId of [foreign.id, 'missing']) {
        await http()
          .patch(`/api/pages/${page.id}`)
          .set(owner.auth)
          .send({ parentPageId })
          .expect(400);
      }
      const unchanged = await testApp.prisma.page.findUniqueOrThrow({ where: { id: page.id } });
      expect(unchanged.parentPageId).toBeNull();
    });

    it('accepts an empty update', async () => {
      const page = await insertPage(testApp, workspaceId, 'Same');
      const response = await http()
        .patch(`/api/pages/${page.id}`)
        .set(owner.auth)
        .send({})
        .expect(200);
      expect(response.body.title).toBe('Same');
    });

    it.each([
      ['null title', { title: null }],
      ['empty title', { title: '' }],
      ['long title', { title: 'a'.repeat(201) }],
      ['array content', { content: [1, 2] }],
      ['string content', { content: 'text' }],
      ['unknown field', { workspaceId: 'other' }],
    ])('rejects %s with 400', async (_label, body) => {
      const page = await insertPage(testApp, workspaceId, 'Page');
      await http().patch(`/api/pages/${page.id}`).set(owner.auth).send(body).expect(400);
    });

    it('rejects edits in an archived workspace', async () => {
      const page = await insertPage(testApp, workspaceId, 'Page');
      await archiveWorkspace(testApp, workspaceId);

      await http().patch(`/api/pages/${page.id}`).set(owner.auth).send({ title: 'x' }).expect(409);
    });

    it('hides the page from non-members', async () => {
      const page = await insertPage(testApp, workspaceId, 'Page');
      await http()
        .patch(`/api/pages/${page.id}`)
        .set(outsider.auth)
        .send({ title: 'x' })
        .expect(404);
    });
  });

  describe('DELETE /pages/:id', () => {
    it('deletes the page with its whole subtree and its references', async () => {
      const root = await insertPage(testApp, workspaceId, 'Root');
      const child = await insertPage(testApp, workspaceId, 'Child', root.id);
      await insertPage(testApp, workspaceId, 'Grandchild', child.id);
      const sibling = await insertPage(testApp, workspaceId, 'Sibling');
      const lecturer = await registerUser(testApp, 'LECTURER');
      const course = await createCourse(testApp, {
        lecturerId: lecturer.id,
        blocks: [{ type: 'FILE', title: 'Slides' }],
      });
      await testApp.prisma.resourceReference.create({
        data: { pageId: child.id, courseBlockId: course.blocks[0].id },
      });

      await http().delete(`/api/pages/${root.id}`).set(member.auth).expect(204);

      const remaining = await testApp.prisma.page.findMany({ where: { workspaceId } });
      expect(remaining.map((page) => page.id)).toEqual([sibling.id]);
      expect(await testApp.prisma.resourceReference.count()).toBe(0);
      await http().get(`/api/pages/${root.id}`).set(owner.auth).expect(404);
    });

    it('rejects deletes in an archived workspace', async () => {
      const page = await insertPage(testApp, workspaceId, 'Page');
      await archiveWorkspace(testApp, workspaceId);

      await http().delete(`/api/pages/${page.id}`).set(owner.auth).expect(409);
      expect(await testApp.prisma.page.count()).toBe(1);
    });

    it('hides the page from non-members and unknown ids', async () => {
      const page = await insertPage(testApp, workspaceId, 'Page');

      await http().delete(`/api/pages/${page.id}`).set(outsider.auth).expect(404);
      await http().delete('/api/pages/missing').set(owner.auth).expect(404);
      expect(await testApp.prisma.page.count()).toBe(1);
    });
  });

  describe('page archive', () => {
    const archive = (pageId: string, user: TestUser = member) =>
      http().post(`/api/pages/${pageId}/archive`).set(user.auth);
    const restore = (pageId: string, user: TestUser = member) =>
      http().post(`/api/pages/${pageId}/restore`).set(user.auth);
    const titles = async (archived: boolean) =>
      (
        await http()
          .get(`/api/workspaces/${workspaceId}/pages?archived=${archived}`)
          .set(member.auth)
          .expect(200)
      ).body.map((page: { title: string }) => page.title);

    it('archives the page with its subtree and keeps everything for restoring', async () => {
      const root = await insertPage(testApp, workspaceId, 'Root');
      const child = await insertPage(testApp, workspaceId, 'Child', root.id);
      await insertPage(testApp, workspaceId, 'Grandchild', child.id);
      await insertPage(testApp, workspaceId, 'Sibling');
      await testApp.prisma.page.update({
        where: { id: child.id },
        data: { content: lexicalState },
      });

      const response = await archive(root.id).expect(200);
      expect(response.body).toMatchObject({ id: root.id, archivedAt: expect.any(String) });

      expect(await titles(false)).toEqual(['Sibling']);
      expect(await titles(true)).toEqual(['Root', 'Child', 'Grandchild']);
      // Archived pages stay readable, content included.
      const page = await http().get(`/api/pages/${child.id}`).set(member.auth).expect(200);
      expect(page.body).toMatchObject({ content: lexicalState, archivedAt: expect.any(String) });
    });

    it('makes archived pages read-only', async () => {
      const root = await insertPage(testApp, workspaceId, 'Root');
      await archive(root.id).expect(200);

      await http()
        .patch(`/api/pages/${root.id}`)
        .set(member.auth)
        .send({ title: 'Renamed' })
        .expect(409);
      await http()
        .post(`/api/workspaces/${workspaceId}/pages`)
        .set(member.auth)
        .send({ title: 'Under archived', parentPageId: root.id })
        .expect(400);
      const other = await insertPage(testApp, workspaceId, 'Other');
      await http()
        .patch(`/api/pages/${other.id}`)
        .set(member.auth)
        .send({ parentPageId: root.id })
        .expect(400);
      await archive(root.id).expect(409);
    });

    it('restores the subtree archived with it, but not subpages archived earlier', async () => {
      const root = await insertPage(testApp, workspaceId, 'Root');
      const child = await insertPage(testApp, workspaceId, 'Child', root.id);
      const earlier = await insertPage(testApp, workspaceId, 'Archived earlier', root.id);
      await archive(earlier.id).expect(200);
      await archive(root.id).expect(200);

      const response = await restore(root.id).expect(200);
      expect(response.body).toMatchObject({ id: root.id, archivedAt: null, parentPageId: null });

      expect(await titles(false)).toEqual(['Root', 'Child']);
      expect(await titles(true)).toEqual(['Archived earlier']);
      const restoredChild = await testApp.prisma.page.findUniqueOrThrow({
        where: { id: child.id },
      });
      expect(restoredChild).toMatchObject({ parentPageId: root.id, archivedAt: null });
      await restore(root.id).expect(409);
    });

    it('restores to the root while the previous parent is still archived', async () => {
      const root = await insertPage(testApp, workspaceId, 'Root');
      const child = await insertPage(testApp, workspaceId, 'Child', root.id);
      await archive(root.id).expect(200);

      const response = await restore(child.id).expect(200);
      expect(response.body).toMatchObject({ parentPageId: null, archivedAt: null });
      expect(await titles(false)).toEqual(['Child']);

      // Back under its parent once that parent is active again.
      const sibling = await insertPage(testApp, workspaceId, 'Sibling', root.id);
      await archive(sibling.id).expect(200);
      await restore(root.id).expect(200);
      expect((await restore(sibling.id).expect(200)).body.parentPageId).toBe(root.id);
    });

    it('hides archived pages from search and recent pages', async () => {
      const page = await insertPage(testApp, workspaceId, 'Graph notes');
      await archive(page.id).expect(200);

      const search = await http().get('/api/search/pages?q=Graph').set(member.auth).expect(200);
      expect(search.body).toEqual([]);
      const recent = await http().get('/api/recent-pages').set(member.auth).expect(200);
      expect(recent.body).toEqual([]);
    });

    it('keeps references and messages read-only on archived pages', async () => {
      const page = await insertPage(testApp, workspaceId, 'Page');
      const lecturer = await registerUser(testApp, 'LECTURER');
      const course = await createCourse(testApp, {
        lecturerId: lecturer.id,
        blocks: [{ type: 'FILE', title: 'Slides' }],
      });
      await testApp.prisma.enrollment.create({
        data: { userId: member.id, courseId: course.id },
      });
      const reference = await testApp.prisma.resourceReference.create({
        data: { pageId: page.id, courseBlockId: course.blocks[0].id },
      });
      await archive(page.id).expect(200);

      await http().get(`/api/pages/${page.id}/references`).set(member.auth).expect(200);
      await http()
        .post(`/api/pages/${page.id}/references`)
        .set(member.auth)
        .send({ courseBlockId: course.blocks[0].id })
        .expect(409);
      await http().delete(`/api/references/${reference.id}`).set(member.auth).expect(409);
      await http().get(`/api/pages/${page.id}/messages`).set(member.auth).expect(200);
      await http()
        .post(`/api/pages/${page.id}/messages`)
        .set(member.auth)
        .send({ content: 'Hello' })
        .expect(409);
    });

    it('needs an active workspace and membership', async () => {
      const page = await insertPage(testApp, workspaceId, 'Page');
      await archive(page.id, outsider).expect(404);
      await archive('missing').expect(404);
      await archiveWorkspace(testApp, workspaceId);
      await archive(page.id, owner).expect(409);
      expect(await titles(true)).toEqual([]);
    });
  });
});
