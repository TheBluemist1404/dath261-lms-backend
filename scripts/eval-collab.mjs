// Collaboration evaluation for the final report (BE #49): convergence, edit latency
// with 2/3/5 clients, offline edits and reconnect, and authorization on /api/collab.
//
// Usage: node scripts/eval-collab.mjs [--api URL] [--runs 20] [--probes 200]
//   [--only convergence,latency,reconnect,authorization] [--out results.json]
//
// It registers its own throwaway accounts and creates a fresh workspace and pages, so it
// needs a running backend (default http://localhost:3001) and changes that database.
// Pointing it at any host other than localhost needs --allow-remote.
//
// Edits go into a separate shared type ("eval-text" / "eval-latency"), so the measured
// documents are real pages on the real server without touching the editor's content.
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

const { values: options } = parseArgs({
  options: {
    api: { type: 'string', default: 'http://localhost:3001' },
    runs: { type: 'string', default: '20' },
    probes: { type: 'string', default: '200' },
    interval: { type: 'string', default: '50' },
    clients: { type: 'string', default: '2,3,5' },
    'convergence-clients': { type: 'string', default: '3' },
    'convergence-ops': { type: 'string', default: '50' },
    only: { type: 'string', default: 'convergence,latency,reconnect,authorization' },
    out: { type: 'string' },
    'allow-remote': { type: 'boolean', default: false },
  },
});

const api = options.api.replace(/\/$/, '');
const wsUrl = `${api.replace(/^http/, 'ws')}/api/collab`;
const runs = Number(options.runs);
const only = new Set(options.only.split(','));
const PASSWORD = 'eval-password-123';
const STORE_DEBOUNCE_MS = 2000;

const host = new URL(api).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host) && !options['allow-remote']) {
  console.error(
    `Refusing to create test accounts on ${host}. Pass --allow-remote to do it anyway.`,
  );
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, timeoutMs = 15_000, label = 'condition') {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return Date.now() - started;
    await sleep(10);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

// ---------------------------------------------------------------------------
// REST fixture
// ---------------------------------------------------------------------------

async function call(method, path, token, body) {
  const response = await fetch(`${api}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function newUser(label) {
  const email = `eval-${label}-${randomBytes(4).toString('hex')}@example.com`;
  const { user } = await call('POST', '/auth/register', undefined, {
    email,
    password: PASSWORD,
    role: 'STUDENT',
    firstName: 'Eval',
    lastName: label,
  });
  const { accessToken } = await call('POST', '/auth/login', undefined, {
    email,
    password: PASSWORD,
  });
  return { id: user.id, email, token: accessToken };
}

async function setUp() {
  const users = await Promise.all(
    ['owner', 'm1', 'm2', 'm3', 'm4', 'outsider', 'removed'].map(newUser),
  );
  const [owner, ...rest] = users;
  const workspace = await call('POST', '/workspaces', owner.token, {
    name: `Collaboration evaluation ${new Date().toISOString()}`,
  });
  const members = rest.slice(0, 4);
  for (const member of [...members, rest[5]]) {
    await call('POST', `/workspaces/${workspace.id}/members`, owner.token, {
      email: member.email,
      role: 'MEMBER',
    });
  }
  return {
    owner,
    members,
    everyone: [owner, ...members],
    outsider: rest[4],
    removed: rest[5],
    workspaceId: workspace.id,
  };
}

async function newPage(fixture, title) {
  const page = await call('POST', `/workspaces/${fixture.workspaceId}/pages`, fixture.owner.token, {
    title,
  });
  return page.id;
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

function connect(token, pageId) {
  const doc = new Y.Doc();
  let scope = null;
  let closeReason = null;
  const provider = new HocuspocusProvider({ url: wsUrl, name: pageId, document: doc, token });
  provider.on('authenticated', ({ scope: granted }) => {
    scope = granted;
  });
  provider.on('close', ({ event }) => {
    closeReason = event?.reason ?? 'closed';
  });
  const ready = new Promise((resolve) => {
    provider.on('synced', () => resolve('synced'));
    provider.on('authenticationFailed', ({ reason }) => resolve(`refused: ${reason}`));
    setTimeout(() => resolve('timeout'), 10_000);
  });
  return {
    doc,
    provider,
    ready,
    text: () => doc.getText('eval-text').toString(),
    scope: () => scope,
    closeReason: () => closeReason,
    destroy: () => provider.destroy(),
  };
}

async function connectAll(tokens, pageId) {
  const clients = tokens.map((token) => connect(token, pageId));
  const states = await Promise.all(clients.map((client) => client.ready));
  if (states.some((state) => state !== 'synced')) {
    throw new Error(`Clients failed to sync: ${states.join(', ')}`);
  }
  return clients;
}

const allSynced = (clients) => clients.every((client) => !client.provider.hasUnsyncedChanges);

function percentile(sorted, p) {
  if (sorted.length === 0) return Number.NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

// ---------------------------------------------------------------------------
// EV-01 Convergence
// ---------------------------------------------------------------------------

/** Random insert or delete at a random position; deletes are a third of the operations. */
function randomEdit(doc, label, index) {
  const text = doc.getText('eval-text');
  if (text.length > 0 && Math.random() < 1 / 3) {
    const at = Math.floor(Math.random() * text.length);
    text.delete(at, Math.min(1 + Math.floor(Math.random() * 3), text.length - at));
  } else {
    const at = Math.floor(Math.random() * (text.length + 1));
    text.insert(at, `[${label}${index}]`);
  }
}

async function convergence(fixture) {
  const clientCount = Number(options['convergence-clients']);
  const opsPerClient = Number(options['convergence-ops']);
  const results = [];
  for (let run = 1; run <= runs; run += 1) {
    const pageId = await newPage(fixture, `Convergence ${run}`);
    const clients = await connectAll(
      fixture.everyone.slice(0, clientCount).map((user) => user.token),
      pageId,
    );

    // Every client edits at the same time, with a little jitter between its edits.
    const started = performance.now();
    await Promise.all(
      clients.map(async (client, c) => {
        for (let i = 0; i < opsPerClient; i += 1) {
          randomEdit(client.doc, String.fromCharCode(65 + c), i);
          if (Math.random() < 0.5) await sleep(Math.floor(Math.random() * 5));
        }
      }),
    );
    const editsDone = performance.now();
    await waitFor(
      () => allSynced(clients) && clients.every((client) => client.text() === clients[0].text()),
      20_000,
      'convergence',
    );
    const convergeMs = performance.now() - editsDone;

    const texts = clients.map((client) => client.text());
    const vectors = clients.map((client) =>
      Buffer.from(Y.encodeStateVector(client.doc)).toString('base64'),
    );
    const identical = texts.every((t) => t === texts[0]) && vectors.every((v) => v === vectors[0]);
    const finalText = texts[0];
    for (const client of clients) client.destroy();

    // Persistence: once everyone has left and the debounced store ran, a new client
    // loads the stored state from the database and must see the same document.
    await sleep(STORE_DEBOUNCE_MS + 1500);
    const [fresh] = await connectAll([fixture.owner.token], pageId);
    const persisted = fresh.text() === finalText;
    fresh.destroy();

    results.push({
      run,
      identical,
      persisted,
      length: finalText.length,
      editMs: Math.round(editsDone - started),
      convergeMs: Math.round(convergeMs),
    });
    process.stdout.write(identical && persisted ? '.' : 'F');
  }
  process.stdout.write('\n');
  const ok = results.filter((r) => r.identical && r.persisted).length;
  const converge = results.map((r) => r.convergeMs).sort((a, b) => a - b);
  return {
    clients: clientCount,
    editsPerClient: opsPerClient,
    runs: results.length,
    passed: ok,
    convergeMsMedian: percentile(converge, 50),
    convergeMsMax: converge.at(-1),
    results,
  };
}

// ---------------------------------------------------------------------------
// EV-02 Latency
// ---------------------------------------------------------------------------

/**
 * One writer sets probes; every other client records when each probe arrives. All
 * clients run in this process, so one clock times both ends: the figure is the
 * one-way time from a local edit to its appearance in another member's document.
 */
async function latency(fixture) {
  const probes = Number(options.probes);
  const interval = Number(options.interval);
  const rows = [];
  for (const clientCount of options.clients.split(',').map(Number)) {
    const pageId = await newPage(fixture, `Latency ${clientCount} clients`);
    const connectStarted = performance.now();
    const clients = await connectAll(
      fixture.everyone.slice(0, clientCount).map((user) => user.token),
      pageId,
    );
    const connectMs = performance.now() - connectStarted;
    const [writer, ...readers] = clients;
    const sentAt = new Map();
    const delays = [];
    for (const reader of readers) {
      reader.doc.getMap('eval-latency').observe((event) => {
        const now = performance.now();
        for (const key of event.keysChanged) {
          const started = sentAt.get(key);
          if (started !== undefined) delays.push(now - started);
        }
      });
    }
    for (let i = 0; i < probes; i += 1) {
      const key = `p${i}`;
      sentAt.set(key, performance.now());
      writer.doc.getMap('eval-latency').set(key, i);
      await sleep(interval);
    }
    const expected = probes * readers.length;
    await waitFor(() => delays.length >= expected, 10_000, 'probes').catch(() => {});
    for (const client of clients) client.destroy();

    const sorted = delays.sort((a, b) => a - b);
    rows.push({
      clients: clientCount,
      delivered: `${delays.length}/${expected}`,
      connectAllMs: Math.round(connectMs),
      p50: Number(percentile(sorted, 50).toFixed(1)),
      p95: Number(percentile(sorted, 95).toFixed(1)),
      max: Number((sorted.at(-1) ?? Number.NaN).toFixed(1)),
    });
    process.stdout.write('.');
  }
  process.stdout.write('\n');
  return { probesPerWriter: probes, intervalMs: interval, rows };
}

// ---------------------------------------------------------------------------
// EV-03 Reconnect
// ---------------------------------------------------------------------------

/** A random position between two markers, so an insert never splits one. */
function markerBoundary(text) {
  const boundaries = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === ';') boundaries.push(i + 1);
  return boundaries[Math.floor(Math.random() * boundaries.length)];
}

async function reconnect(fixture) {
  const results = [];
  for (let run = 1; run <= runs; run += 1) {
    const pageId = await newPage(fixture, `Reconnect ${run}`);
    const [a, b] = await connectAll([fixture.owner.token, fixture.members[0].token], pageId);

    a.doc.getText('eval-text').insert(0, 'base;');
    await waitFor(() => b.text() === a.text() && allSynced([a, b]), 10_000, 'base text');

    // A drops off the network and both keep writing.
    a.provider.disconnect();
    const offlineEdits = 10;
    for (let i = 0; i < offlineEdits; i += 1) {
      a.doc.getText('eval-text').insert(markerBoundary(a.text()), `a${i};`);
      b.doc.getText('eval-text').insert(markerBoundary(b.text()), `b${i};`);
    }
    await sleep(200);
    const diverged = a.text() !== b.text();

    const reconnectStarted = performance.now();
    await a.provider.connect();
    await waitFor(() => a.text() === b.text() && allSynced([a, b]), 15_000, 'reconnect merge');
    const mergeMs = performance.now() - reconnectStarted;

    const markers = ['base;'];
    for (let i = 0; i < offlineEdits; i += 1) markers.push(`a${i};`, `b${i};`);
    const finalText = a.text();
    const lost = markers.filter((marker) => !finalText.includes(marker));
    a.destroy();
    b.destroy();

    results.push({ run, diverged, lost: lost.length, mergeMs: Math.round(mergeMs) });
    process.stdout.write(lost.length === 0 ? '.' : 'F');
  }
  process.stdout.write('\n');
  const merge = results.map((r) => r.mergeMs).sort((x, y) => x - y);
  return {
    runs: results.length,
    passed: results.filter((r) => r.lost === 0).length,
    divergedWhileOffline: results.filter((r) => r.diverged).length,
    editsWhileOffline: 20,
    mergeMsMedian: percentile(merge, 50),
    mergeMsMax: merge.at(-1),
    results,
  };
}

// ---------------------------------------------------------------------------
// EV-04 Authorization
// ---------------------------------------------------------------------------

/** A refused client must not receive any of the document. */
async function expectRefused(token, pageId, secret) {
  const client = connect(token, pageId);
  const state = await client.ready;
  await sleep(300);
  const leaked =
    client.text().includes(secret) ||
    client.doc.getXmlFragment('document-store').length > 0 ||
    client.doc.getMap('eval-latency').size > 0;
  client.destroy();
  return { state, leaked, refused: state.startsWith('refused') && !leaked };
}

async function authorization(fixture) {
  const secret = `secret-${randomBytes(4).toString('hex')}`;
  const pageId = await newPage(fixture, 'Authorization');
  const [writer] = await connectAll([fixture.owner.token], pageId);
  writer.doc.getText('eval-text').insert(0, secret);
  await waitFor(() => allSynced([writer]), 10_000, 'secret stored');

  const cases = [];
  const record = (name, outcome, expected) =>
    cases.push({ case: name, outcome, expected, pass: outcome === expected });

  // Non-member, no token, malformed and tampered tokens.
  record(
    'Non-member of the workspace',
    (await expectRefused(fixture.outsider.token, pageId, secret)).refused ? 'refused' : 'allowed',
    'refused',
  );
  record(
    'Empty token',
    (await expectRefused('', pageId, secret)).refused ? 'refused' : 'allowed',
    'refused',
  );
  record(
    'Malformed token',
    (await expectRefused('not-a-jwt', pageId, secret)).refused ? 'refused' : 'allowed',
    'refused',
  );
  const [head, payload, signature] = fixture.members[0].token.split('.');
  const tampered = `${head}.${payload}.${signature.slice(0, -2)}${signature.endsWith('AA') ? 'BB' : 'AA'}`;
  record(
    'Member token with a forged signature',
    (await expectRefused(tampered, pageId, secret)).refused ? 'refused' : 'allowed',
    'refused',
  );
  record(
    'Unknown page id',
    (await expectRefused(fixture.owner.token, 'no-such-page', secret)).refused
      ? 'refused'
      : 'allowed',
    'refused',
  );

  // Removed while connected: the open connection is closed and a reconnect is refused.
  const removed = connect(fixture.removed.token, pageId);
  const removedReady = await removed.ready;
  await waitFor(() => removed.text() === secret, 5_000, 'removed member synced').catch(() => {});
  await call(
    'DELETE',
    `/workspaces/${fixture.workspaceId}/members/${fixture.removed.id}`,
    fixture.owner.token,
  );
  let kicked = false;
  try {
    await waitFor(() => removed.closeReason() !== null, 5_000, 'removed member closed');
    kicked = true;
  } catch {}
  removed.destroy();
  record(
    'Member removed while connected',
    removedReady === 'synced' && kicked ? 'disconnected' : 'still connected',
    'disconnected',
  );
  record(
    'Removed member reconnects',
    (await expectRefused(fixture.removed.token, pageId, secret)).refused ? 'refused' : 'allowed',
    'refused',
  );

  // Personal workspace pages are never shared, not even with their owner over the socket.
  const workspaces = await call('GET', '/workspaces', fixture.owner.token);
  const personal = (workspaces.data ?? workspaces).find((w) => w.type === 'PERSONAL');
  if (personal) {
    const personalPage = await call(
      'POST',
      `/workspaces/${personal.id}/pages`,
      fixture.owner.token,
      {
        title: 'Private notes',
      },
    );
    record(
      'Another user opens a personal page',
      (await expectRefused(fixture.members[0].token, personalPage.id, secret)).refused
        ? 'refused'
        : 'allowed',
      'refused',
    );
    record(
      'Owner opens their personal page over the socket',
      (await expectRefused(fixture.owner.token, personalPage.id, secret)).refused
        ? 'refused'
        : 'allowed',
      'refused',
    );
  }

  // Archived page: members can read it but their edits are not applied.
  await call('POST', `/pages/${pageId}/archive`, fixture.owner.token);
  const reader = connect(fixture.members[1].token, pageId);
  const readerState = await reader.ready;
  reader.doc.getText('eval-text').insert(0, 'should-not-stick;');
  await sleep(800);
  reader.destroy();
  writer.destroy();
  await sleep(STORE_DEBOUNCE_MS + 1500);
  const [check] = await connectAll([fixture.members[2].token], pageId);
  const stuck = check.text().includes('should-not-stick');
  check.destroy();
  record(
    'Edit sent to an archived page',
    readerState === 'synced' && reader.scope() === 'readonly' && !stuck
      ? 'read-only, not stored'
      : 'stored',
    'read-only, not stored',
  );

  return { cases, passed: cases.filter((c) => c.pass).length, total: cases.length };
}

// ---------------------------------------------------------------------------

console.log(`Collaboration evaluation against ${api}`);
const fixture = await setUp();
const report = { api, startedAt: new Date().toISOString() };

if (only.has('convergence')) {
  process.stdout.write(`EV-01 convergence, ${runs} runs `);
  report.convergence = await convergence(fixture);
}
if (only.has('latency')) {
  process.stdout.write('EV-02 latency ');
  report.latency = await latency(fixture);
}
if (only.has('reconnect')) {
  process.stdout.write(`EV-03 reconnect, ${runs} runs `);
  report.reconnect = await reconnect(fixture);
}
if (only.has('authorization')) {
  console.log('EV-04 authorization');
  report.authorization = await authorization(fixture);
}

console.log('');
if (report.convergence) {
  const c = report.convergence;
  console.log(
    `EV-01 Convergence: ${c.passed}/${c.runs} runs identical on every client and in the stored state ` +
      `(${c.clients} clients x ${c.editsPerClient} concurrent edits; converged ${c.convergeMsMedian} ms median, ${c.convergeMsMax} ms max after the last edit)`,
  );
}
if (report.latency) {
  console.log('EV-02 Latency, edit to another member (ms):');
  console.log('| Clients | Delivered | p50 | p95 | max | Connect all |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const row of report.latency.rows) {
    console.log(
      `| ${row.clients} | ${row.delivered} | ${row.p50} | ${row.p95} | ${row.max} | ${row.connectAllMs} |`,
    );
  }
}
if (report.reconnect) {
  const r = report.reconnect;
  console.log(
    `EV-03 Reconnect: ${r.passed}/${r.runs} runs kept every edit (${r.editsWhileOffline} edits while one client was offline, documents diverged in ${r.divergedWhileOffline}/${r.runs}; merged ${r.mergeMsMedian} ms median, ${r.mergeMsMax} ms max)`,
  );
}
if (report.authorization) {
  console.log(
    `EV-04 Authorization: ${report.authorization.passed}/${report.authorization.total} cases as expected`,
  );
  for (const c of report.authorization.cases) {
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.case}: ${c.outcome}`);
  }
}
if (options.out) {
  writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote ${options.out}`);
}

const failed =
  (report.convergence && report.convergence.passed !== report.convergence.runs) ||
  (report.reconnect && report.reconnect.passed !== report.reconnect.runs) ||
  (report.authorization && report.authorization.passed !== report.authorization.total);
process.exit(failed ? 1 : 0);
