import { createTestApp, resetDatabase, type TestApp } from './support/test-app.js';
import { createAdmin, registerUser, type TestUser } from './support/users.js';
import {
  addMembership,
  archiveWorkspace,
  createWorkspace,
  insertPage,
} from './support/workspaces.js';

function lexical(...paragraphs: string[]) {
  return {
    root: {
      type: 'root',
      children: paragraphs.map((text) => ({
        type: 'paragraph',
        format: '',
        children: [{ type: 'text', text, format: 0, style: '' }],
      })),
    },
  };
}

interface Hit {
  page: { id: string; title: string; updatedAt: string };
  workspace: { id: string; name: string; type: string };
  path: string[];
  snippet: string | null;
}

describe('Page search and recent pages API (e2e)', () => {
  let testApp: TestApp;
  let user: TestUser;
  let peer: TestUser;
  let workspaceId: string;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(testApp.prisma);
    user = await registerUser(testApp);
    peer = await registerUser(testApp);
    workspaceId = (await createWorkspace(testApp, user, 'Algorithms')).id;
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  const http = () => testApp.http();

  /** Inserts a page with content and a fixed updatedAt so ordering is deterministic. */
  async function page(
    title: string,
    options: {
      content?: object;
      parentPageId?: string;
      minutesAgo?: number;
      workspace?: string;
    } = {},
  ) {
    const created = await insertPage(
      testApp,
      options.workspace ?? workspaceId,
      title,
      options.parentPageId,
    );
    return testApp.prisma.page.update({
      where: { id: created.id },
      data: {
        content: options.content,
        updatedAt: new Date(Date.now() - (options.minutesAgo ?? 0) * 60_000),
      },
    });
  }

  async function search(q: string, as = user) {
    const response = await http().get('/api/search/pages').query({ q }).set(as.auth).expect(200);
    return response.body as Hit[];
  }

  async function recent(query = '', as = user) {
    const response = await http().get(`/api/recent-pages${query}`).set(as.auth).expect(200);
    return response.body as Hit[];
  }

  describe('GET /search/pages', () => {
    it('returns title matches first, then content matches, each newest first', async () => {
      const olderTitle = await page('Graph theory', { minutesAgo: 30 });
      const newerTitle = await page('Graphs II', { minutesAgo: 10 });
      const olderContent = await page('Week 2', {
        content: lexical('Intro to graphs'),
        minutesAgo: 20,
      });
      const newerContent = await page('Week 3', {
        content: lexical('More GRAPH search'),
        minutesAgo: 5,
      });
      await page('Unrelated', { content: lexical('Sorting') });

      const hits = await search('graph');
      expect(hits.map((hit) => hit.page.id)).toEqual([
        newerTitle.id,
        olderTitle.id,
        newerContent.id,
        olderContent.id,
      ]);
    });

    it('describes each hit with its workspace, ancestor path and a snippet', async () => {
      const root = await page('Course');
      const unit = await page('Unit 1', { parentPageId: root.id });
      const leaf = await page('Lecture', {
        parentPageId: unit.id,
        content: lexical('Dijkstra finds shortest paths in weighted graphs'),
      });

      const [hit] = await search('shortest');
      expect(hit).toEqual({
        page: {
          id: leaf.id,
          workspaceId,
          title: 'Lecture',
          parentPageId: unit.id,
          archivedAt: null,
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        },
        workspace: { id: workspaceId, name: 'Algorithms', type: 'COLLABORATIVE' },
        path: ['Course', 'Unit 1'],
        snippet: 'Dijkstra finds shortest paths in weighted graphs',
      });
      expect(hit).not.toHaveProperty('page.content');
    });

    it('cuts long snippets around the first match and gives title-only hits no snippet', async () => {
      const long = `${'intro '.repeat(30)}the needle is here ${'outro '.repeat(30)}`;
      await page('Long', { content: lexical(long) });
      await page('Needle in title');

      const hits = await search('needle');
      const titleHit = hits.find((hit) => hit.page.title === 'Needle in title');
      const contentHit = hits.find((hit) => hit.page.title === 'Long');
      expect(titleHit?.snippet).toBeNull();
      expect(contentHit?.snippet).toMatch(/^….*the needle is here.*…$/);
      expect(contentHit?.snippet?.length).toBeLessThanOrEqual(60 * 2 + 'needle'.length + 2);
    });

    it('matches only text, never node types, keys or other string fields', async () => {
      await page('Doc', {
        content: {
          root: {
            type: 'root',
            children: [
              {
                type: 'link',
                url: 'https://example.com/heap',
                children: [{ type: 'text', text: 'see here' }],
              },
            ],
          },
        },
      });

      expect(await search('paragraph')).toEqual([]);
      expect(await search('root')).toEqual([]);
      expect(await search('heap')).toEqual([]);
      expect(await search('see here')).toHaveLength(1);
    });

    it('matches text across Unicode case', async () => {
      await page('Ghi chú', { content: lexical('Học thuật toán đồ thị') });

      expect(await search('HỌC')).toHaveLength(1);
      expect(await search('ghi CHÚ')).toHaveLength(1);
    });

    it('treats LIKE wildcards literally', async () => {
      await page('Plain page', { content: lexical('nothing special') });
      await page('Progress', { content: lexical('done: 50% of tasks') });

      expect(await search('%%')).toEqual([]);
      expect((await search('0%')).map((hit) => hit.page.title)).toEqual(['Progress']);
      expect(await search('__')).toEqual([]);
    });

    it('covers only active workspaces the caller belongs to', async () => {
      const archived = await createWorkspace(testApp, user, 'Old');
      await page('Graph archive', { workspace: archived.id });
      await archiveWorkspace(testApp, archived.id);

      const foreign = await createWorkspace(testApp, peer, 'Theirs');
      await page('Graph secret', { workspace: foreign.id });

      const shared = await createWorkspace(testApp, peer, 'Shared');
      await addMembership(testApp, shared.id, user, 'MEMBER');
      await page('Graph shared', { workspace: shared.id });
      await page('Graph mine');

      expect((await search('graph')).map((hit) => hit.page.title).sort()).toEqual([
        'Graph mine',
        'Graph shared',
      ]);

      await testApp.prisma.workspaceMembership.deleteMany({
        where: { workspaceId: shared.id, userId: user.id },
      });
      expect((await search('graph')).map((hit) => hit.page.title)).toEqual(['Graph mine']);
    });

    it('includes the personal workspace', async () => {
      const list = await http().get('/api/workspaces').set(user.auth).expect(200);
      const personal = list.body.find((w: { type: string }) => w.type === 'PERSONAL');
      await page('Private graph notes', { workspace: personal.id });

      const [hit] = await search('graph');
      expect(hit.workspace).toEqual({
        id: personal.id,
        name: 'My personal workspace',
        type: 'PERSONAL',
      });
    });

    it('returns at most 50 results', async () => {
      await testApp.prisma.page.createMany({
        data: Array.from({ length: 60 }, (_, index) => ({ workspaceId, title: `Topic ${index}` })),
      });

      expect(await search('topic')).toHaveLength(50);
    });

    it.each([[''], ['a'], ['  a  ']])('rejects q=%j with 400', async (q) => {
      await http().get('/api/search/pages').query({ q }).set(user.auth).expect(400);
    });

    it('rejects a missing q', async () => {
      await http().get('/api/search/pages').set(user.auth).expect(400);
    });

    it('is closed to admins and anonymous callers', async () => {
      const admin = await createAdmin(testApp);
      await http().get('/api/search/pages?q=graph').set(admin.auth).expect(403);
      await http().get('/api/search/pages?q=graph').expect(401);
    });
  });

  describe('GET /recent-pages', () => {
    it('returns the five most recently edited pages by default', async () => {
      for (let minutesAgo = 7; minutesAgo >= 1; minutesAgo -= 1) {
        await page(`Page ${minutesAgo}`, { content: lexical('text'), minutesAgo });
      }

      const hits = await recent();
      expect(hits.map((hit) => hit.page.title)).toEqual([
        'Page 1',
        'Page 2',
        'Page 3',
        'Page 4',
        'Page 5',
      ]);
      expect(hits.every((hit) => hit.snippet === null)).toBe(true);
      expect(hits[0].workspace).toEqual({
        id: workspaceId,
        name: 'Algorithms',
        type: 'COLLABORATIVE',
      });
    });

    it('honours the limit from 1 to 20', async () => {
      await testApp.prisma.page.createMany({
        data: Array.from({ length: 25 }, (_, index) => ({ workspaceId, title: `P${index}` })),
      });

      expect(await recent('?limit=1')).toHaveLength(1);
      expect(await recent('?limit=20')).toHaveLength(20);
    });

    it('moves a page to the top when it is edited', async () => {
      const old = await page('Old', { minutesAgo: 60 });
      await page('New', { minutesAgo: 1 });

      await http()
        .patch(`/api/pages/${old.id}`)
        .set(user.auth)
        .send({ content: lexical('edit') })
        .expect(200);
      expect((await recent()).map((hit) => hit.page.title)).toEqual(['Old', 'New']);
    });

    it('includes ancestor paths', async () => {
      const parent = await page('Parent', { minutesAgo: 5 });
      await page('Child', { parentPageId: parent.id });

      expect((await recent())[0]).toMatchObject({ page: { title: 'Child' }, path: ['Parent'] });
    });

    it('covers only active workspaces the caller belongs to', async () => {
      const archived = await createWorkspace(testApp, user, 'Old');
      await page('Archived page', { workspace: archived.id });
      await archiveWorkspace(testApp, archived.id);
      const foreign = await createWorkspace(testApp, peer, 'Theirs');
      await page('Foreign page', { workspace: foreign.id });
      await page('Mine');

      expect((await recent()).map((hit) => hit.page.title)).toEqual(['Mine']);
      expect((await recent('', peer)).map((hit) => hit.page.title)).toEqual(['Foreign page']);
    });

    it('returns an empty list for a new user', async () => {
      expect(await recent('', peer)).toEqual([]);
    });

    it.each([
      ['0'],
      ['21'],
      ['-1'],
      ['abc'],
      ['2.5'],
    ])('rejects limit=%s with 400', async (limit) => {
      await http().get(`/api/recent-pages?limit=${limit}`).set(user.auth).expect(400);
    });

    it('does not collide with page ids', async () => {
      await http().get('/api/pages/recent').set(user.auth).expect(404);
    });

    it('is closed to admins and anonymous callers', async () => {
      const admin = await createAdmin(testApp);
      await http().get('/api/recent-pages').set(admin.auth).expect(403);
      await http().get('/api/recent-pages').expect(401);
    });
  });
});
