import type { AddressInfo } from 'node:net';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import {
  COLLABORATION_PATH,
  CollaborationService,
} from '../src/modules/collaboration/collaboration.service.js';
import { DOCUMENT_FRAGMENT, documentText } from '../src/modules/collaboration/page-document.js';
import { createTestApp, resetDatabase, type TestApp } from './support/test-app.js';
import { registerUser, type TestUser } from './support/users.js';
import {
  addMembership,
  archiveWorkspace,
  createWorkspace,
  insertPage,
} from './support/workspaces.js';

interface Client {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  /** Resolves with the refusal reason, or "synced" once the document arrived. */
  ready: Promise<string>;
  closed: Promise<string>;
  readOnly: () => boolean;
}

describe('Collaboration server (e2e)', () => {
  let testApp: TestApp;
  let url: string;
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let workspaceId: string;
  let pageId: string;
  const clients: Client[] = [];

  beforeAll(async () => {
    testApp = await createTestApp();
    await testApp.app.listen(0);
    const { port } = testApp.app.getHttpServer().address() as AddressInfo;
    url = `ws://127.0.0.1:${port}${COLLABORATION_PATH}`;
  });

  beforeEach(async () => {
    await resetDatabase(testApp.prisma);
    owner = await registerUser(testApp);
    member = await registerUser(testApp);
    outsider = await registerUser(testApp);
    workspaceId = (await createWorkspace(testApp, owner)).id;
    await addMembership(testApp, workspaceId, member, 'MEMBER');
    pageId = (await insertPage(testApp, workspaceId, 'Shared notes')).id;
  });

  afterEach(() => {
    for (const client of clients.splice(0)) client.provider.destroy();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  function connect(token: string, documentName = pageId): Client {
    const doc = new Y.Doc();
    let scope = '';
    const provider = new HocuspocusProvider({
      url,
      name: documentName,
      document: doc,
      token,
    });
    provider.on('authenticated', ({ scope: granted }: { scope: string }) => {
      scope = granted;
    });
    const ready = new Promise<string>((resolve) => {
      provider.on('synced', () => resolve('synced'));
      provider.on('authenticationFailed', ({ reason }: { reason: string }) => resolve(reason));
    });
    const closed = new Promise<string>((resolve) => {
      provider.on('close', ({ event }: { event: { reason: string } }) => resolve(event.reason));
    });
    const client = { doc, provider, ready, closed, readOnly: () => scope === 'readonly' };
    clients.push(client);
    return client;
  }

  function write(doc: Y.Doc, text: string) {
    const group = new Y.XmlElement('blockGroup');
    const container = new Y.XmlElement('blockContainer');
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [new Y.XmlText(text)]);
    container.insert(0, [paragraph]);
    group.insert(0, [container]);
    doc.getXmlFragment(DOCUMENT_FRAGMENT).push([group]);
  }

  async function storedPage() {
    testApp.app.get(CollaborationService).hocuspocus.flushPendingStores();
    return testApp.prisma.page.findUniqueOrThrow({ where: { id: pageId } });
  }

  it('relays edits between members and stores the state with a text snapshot', async () => {
    const a = connect(owner.accessToken);
    const b = connect(member.accessToken);
    expect(await a.ready).toBe('synced');
    expect(await b.ready).toBe('synced');

    write(a.doc, 'Shared idea');
    await vi.waitFor(() => expect(documentText(b.doc)).toContain('Shared idea'));

    await vi.waitFor(async () => {
      const page = await storedPage();
      expect(page.content).toEqual({ type: 'plain-text', text: 'Shared idea' });
      expect(page.yjsState).not.toBeNull();
    });
  });

  it('seeds the shared document once from existing page content', async () => {
    await testApp.prisma.page.update({
      where: { id: pageId },
      data: { content: { type: 'plain-text', text: 'First line\n\nThird line' } },
    });

    const a = connect(owner.accessToken);
    expect(await a.ready).toBe('synced');
    expect(documentText(a.doc)).toBe('First line\nThird line');
    const seeded = (await testApp.prisma.page.findUniqueOrThrow({ where: { id: pageId } }))
      .yjsState;
    expect(seeded).not.toBeNull();

    // A second client gets the same history rather than a fresh seed.
    const b = connect(member.accessToken);
    expect(await b.ready).toBe('synced');
    expect(documentText(b.doc)).toBe('First line\nThird line');
    expect(b.doc.getXmlFragment(DOCUMENT_FRAGMENT).length).toBe(1);
  });

  it('refuses outsiders, bad tokens, unknown pages and personal pages', async () => {
    expect(await connect(outsider.accessToken).ready).toBe('not-found');
    expect(await connect('not-a-token').ready).toBe('token-invalid');
    expect(await connect(owner.accessToken, 'missing-page').ready).toBe('not-found');

    const personal = await testApp.prisma.workspace.create({
      data: {
        name: 'Mine',
        type: 'PERSONAL',
        createdById: owner.id,
        memberships: { create: { userId: owner.id, role: 'OWNER' } },
      },
    });
    const privatePage = await insertPage(testApp, personal.id, 'Private');
    expect(await connect(owner.accessToken, privatePage.id).ready).toBe('not-collaborative');
  });

  it('serves archived workspaces read-only', async () => {
    await archiveWorkspace(testApp, workspaceId);
    const a = connect(member.accessToken);
    expect(await a.ready).toBe('synced');
    expect(a.readOnly()).toBe(true);

    write(a.doc, 'Should not land');
    await new Promise((resolve) => setTimeout(resolve, 300));
    const page = await storedPage();
    expect(page.content).toBeNull();
  });

  it('ends a removed member’s session and refuses them afterwards', async () => {
    const b = connect(member.accessToken);
    expect(await b.ready).toBe('synced');

    await testApp
      .http()
      .delete(`/api/workspaces/${workspaceId}/members/${member.id}`)
      .set(owner.auth)
      .expect(204);

    expect(await b.closed).toBe('access-revoked');
    expect(await connect(member.accessToken).ready).toBe('not-found');
  });

  it('reconnects sessions when the workspace is archived', async () => {
    const a = connect(member.accessToken);
    expect(await a.ready).toBe('synced');

    await testApp.http().post(`/api/workspaces/${workspaceId}/archive`).set(owner.auth).expect(200);

    expect(await a.closed).toBe('workspace-changed');
  });

  it('closes sessions on deleted pages', async () => {
    const a = connect(member.accessToken);
    expect(await a.ready).toBe('synced');

    await testApp.http().delete(`/api/pages/${pageId}`).set(owner.auth).expect(204);

    expect(await a.closed).toBe('page-deleted');
  });

  it('reconnects sessions on archived pages and serves them read-only', async () => {
    const a = connect(member.accessToken);
    expect(await a.ready).toBe('synced');

    await testApp.http().post(`/api/pages/${pageId}/archive`).set(owner.auth).expect(200);

    expect(await a.closed).toBe('page-changed');
    const b = connect(member.accessToken);
    expect(await b.ready).toBe('synced');
    expect(b.readOnly()).toBe(true);
  });
});
