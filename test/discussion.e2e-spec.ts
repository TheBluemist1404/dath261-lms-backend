import type { AddressInfo } from 'node:net';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import {
  COLLABORATION_PATH,
  DISCUSSION_PREFIX,
} from '../src/modules/collaboration/collaboration.service.js';
import { createTestApp, resetDatabase, type TestApp } from './support/test-app.js';
import { createAdmin, registerUser, type TestUser } from './support/users.js';
import {
  addMembership,
  archiveWorkspace,
  createWorkspace,
  insertPage,
} from './support/workspaces.js';

describe('Page discussion API (e2e)', () => {
  let testApp: TestApp;
  let url: string;
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let workspaceId: string;
  let pageId: string;
  const providers: HocuspocusProvider[] = [];

  beforeAll(async () => {
    testApp = await createTestApp();
    await testApp.app.listen(0);
    const { port } = testApp.app.getHttpServer().address() as AddressInfo;
    url = `ws://127.0.0.1:${port}${COLLABORATION_PATH}`;
  });

  beforeEach(async () => {
    await resetDatabase(testApp.prisma);
    owner = await registerUser(testApp, 'STUDENT', { firstName: 'Olivia', lastName: 'Owner' });
    member = await registerUser(testApp, 'STUDENT', { firstName: 'Mai', lastName: 'Tran' });
    outsider = await registerUser(testApp);
    workspaceId = (await createWorkspace(testApp, owner)).id;
    await addMembership(testApp, workspaceId, member, 'MEMBER');
    pageId = (await insertPage(testApp, workspaceId, 'Shared notes')).id;
  });

  afterEach(() => {
    for (const provider of providers.splice(0)) provider.destroy();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  const http = () => testApp.http();
  const messagesPath = (id = pageId) => `/api/pages/${id}/messages`;
  const post = (user: TestUser, content: unknown, id = pageId) =>
    http().post(messagesPath(id)).set(user.auth).send({ content });

  async function messageBy(user: TestUser, content = 'Hello') {
    return (await post(user, content).expect(201)).body as { id: string };
  }

  describe('messages', () => {
    it('posts and lists messages oldest first with their sender', async () => {
      const first = await post(member, '  First question  ').expect(201);
      expect(first.body).toEqual({
        id: expect.any(String),
        pageId,
        sender: { id: member.id, firstName: 'Mai', lastName: 'Tran' },
        content: 'First question',
        createdAt: expect.any(String),
      });
      await post(owner, 'An answer').expect(201);

      const list = await http().get(messagesPath()).set(owner.auth).expect(200);
      expect(list.body.map((message: { content: string }) => message.content)).toEqual([
        'First question',
        'An answer',
      ]);
    });

    it('validates content length after trimming', async () => {
      await post(member, '   ').expect(400);
      await post(member, 'x'.repeat(2001)).expect(400);
      await post(member, 42).expect(400);
      await post(member, 'x'.repeat(2000)).expect(201);
      await http()
        .post(messagesPath())
        .set(member.auth)
        .send({ content: 'ok', extra: 1 })
        .expect(400);
    });

    it('hides the discussion from non-members and missing pages', async () => {
      await http().get(messagesPath()).set(outsider.auth).expect(404);
      await post(outsider, 'Hi').expect(404);
      await http().get(messagesPath('missing')).set(owner.auth).expect(404);
    });

    it('has no discussion on personal pages', async () => {
      const workspaces = await http().get('/api/workspaces').set(owner.auth).expect(200);
      const personal = workspaces.body.find((entry: { type: string }) => entry.type === 'PERSONAL');
      const page = await insertPage(testApp, personal.id, 'Private');

      await http().get(messagesPath(page.id)).set(owner.auth).expect(409);
      await post(owner, 'Hi', page.id).expect(409);
    });

    it('keeps archived discussions readable but closed to new messages', async () => {
      await messageBy(member, 'Before archive');
      await archiveWorkspace(testApp, workspaceId);

      const list = await http().get(messagesPath()).set(member.auth).expect(200);
      expect(list.body).toHaveLength(1);
      await post(member, 'After archive').expect(409);
    });

    it('requires a signed-in Student or Lecturer', async () => {
      await http().get(messagesPath()).expect(401);
      const admin = await createAdmin(testApp);
      await http().get(messagesPath()).set(admin.auth).expect(403);
    });

    it('removes messages with their page', async () => {
      await messageBy(member);
      await http().delete(`/api/pages/${pageId}`).set(owner.auth).expect(204);
      expect(await testApp.prisma.message.count()).toBe(0);
    });
  });

  describe('reports', () => {
    const report = (user: TestUser, body: Record<string, unknown>) =>
      http().post('/api/reports').set(user.auth).send(body);

    it('lets a member report someone else’s message', async () => {
      const message = await messageBy(member);
      const response = await report(owner, {
        targetType: 'MESSAGE',
        targetId: message.id,
        reason: ' Harassment or abuse ',
        description: '  Repeated insults  ',
      }).expect(201);

      expect(response.body).toEqual({ id: expect.any(String), status: 'PENDING' });
      const stored = await testApp.prisma.report.findUniqueOrThrow({
        where: { id: response.body.id },
      });
      expect(stored).toMatchObject({
        reporterId: owner.id,
        targetType: 'MESSAGE',
        targetId: message.id,
        reason: 'Harassment or abuse',
        description: 'Repeated insults',
      });
    });

    it('stores an empty description as none', async () => {
      const message = await messageBy(member);
      const response = await report(owner, {
        targetType: 'MESSAGE',
        targetId: message.id,
        reason: 'Spam',
        description: '   ',
      }).expect(201);
      const stored = await testApp.prisma.report.findUniqueOrThrow({
        where: { id: response.body.id },
      });
      expect(stored.description).toBeNull();
    });

    it('refuses own messages, invisible messages and invalid bodies', async () => {
      const message = await messageBy(member);
      const valid = { targetType: 'MESSAGE', targetId: message.id, reason: 'Spam' };

      await report(member, valid).expect(400);
      await report(outsider, valid).expect(404);
      await report(owner, { ...valid, targetId: 'missing' }).expect(404);
      await report(owner, { ...valid, targetType: 'PAGE' }).expect(400);
      await report(owner, { ...valid, reason: '  ' }).expect(400);
      await report(owner, { ...valid, reason: 'x'.repeat(101) }).expect(400);
      await report(owner, { ...valid, description: 'x'.repeat(1001) }).expect(400);
    });
  });

  describe('live delivery', () => {
    function subscribe(user: TestUser, id = pageId) {
      const received: unknown[] = [];
      const provider = new HocuspocusProvider({
        url,
        name: `${DISCUSSION_PREFIX}${id}`,
        document: new Y.Doc(),
        token: user.accessToken,
      });
      providers.push(provider);
      provider.on('stateless', ({ payload }: { payload: string }) =>
        received.push(JSON.parse(payload)),
      );
      const ready = new Promise<{ result: string; readOnly: boolean }>((resolve) => {
        let readOnly = false;
        provider.on('authenticated', ({ scope }: { scope: string }) => {
          readOnly = scope === 'readonly';
        });
        provider.on('synced', () => resolve({ result: 'synced', readOnly }));
        provider.on('authenticationFailed', ({ reason }: { reason: string }) =>
          resolve({ result: reason, readOnly }),
        );
      });
      const closed = new Promise<string>((resolve) =>
        provider.on('close', ({ event }: { event: { reason: string } }) => resolve(event.reason)),
      );
      return { received, ready, closed };
    }

    it('pushes new messages to members viewing the discussion', async () => {
      const viewer = subscribe(owner);
      expect(await viewer.ready).toEqual({ result: 'synced', readOnly: true });

      const sent = await post(member, 'Live question').expect(201);

      await vi.waitFor(() =>
        expect(viewer.received).toEqual([{ type: 'message.created', message: sent.body }]),
      );
    });

    it('applies page membership to discussion subscriptions', async () => {
      expect((await subscribe(outsider).ready).result).toBe('not-found');

      const viewer = subscribe(member);
      expect((await viewer.ready).result).toBe('synced');
      await http()
        .delete(`/api/workspaces/${workspaceId}/members/${member.id}`)
        .set(owner.auth)
        .expect(204);
      expect(await viewer.closed).toBe('access-revoked');
    });

    it('ends discussion subscriptions when the page is deleted', async () => {
      const viewer = subscribe(member);
      expect((await viewer.ready).result).toBe('synced');
      await http().delete(`/api/pages/${pageId}`).set(owner.auth).expect(204);
      expect(await viewer.closed).toBe('page-deleted');
    });

    it('does not persist anything for discussion channels', async () => {
      const viewer = subscribe(member);
      expect((await viewer.ready).result).toBe('synced');
      const page = await testApp.prisma.page.findUniqueOrThrow({ where: { id: pageId } });
      expect(page.yjsState).toBeNull();
    });
  });
});
