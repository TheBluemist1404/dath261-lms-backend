// Measures how long an edit takes to reach another member through the
// collaboration server. Two clients sign in, open the same shared page, and
// client A writes probes that client B echoes back; half the round trip is
// the edit delay one person sees from another.
//
// Usage: node scripts/bench-collab.mjs [--api URL] [--page ID] [--count N]
//   [--email A] [--email2 B] [--password P]
// Defaults match the development seed (pnpm db:seed:dev) on localhost:3001.
// Probes go in a separate "latency-probe" map, so the page text is untouched.
import { parseArgs } from 'node:util';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

const { values: options } = parseArgs({
  options: {
    api: { type: 'string', default: 'http://localhost:3001' },
    page: { type: 'string', default: 'seed-page-exam' },
    count: { type: 'string', default: '200' },
    interval: { type: 'string', default: '50' },
    email: { type: 'string', default: 'student@dath261.dev' },
    email2: { type: 'string', default: 'classmate@dath261.dev' },
    password: { type: 'string', default: 'password123' },
  },
});
const count = Number(options.count);
const interval = Number(options.interval);

async function login(email) {
  const response = await fetch(`${options.api}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: options.password }),
  });
  if (!response.ok) throw new Error(`Login failed for ${email}: ${response.status}`);
  return (await response.json()).accessToken;
}

function open(token) {
  const document = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: `${options.api.replace(/^http/, 'ws')}/api/collab`,
    name: options.page,
    document,
    token,
  });
  return new Promise((resolve, reject) => {
    provider.on('synced', () => resolve({ document, provider }));
    provider.on('authenticationFailed', ({ reason }) => reject(new Error(`Refused: ${reason}`)));
  });
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

const [tokenA, tokenB] = await Promise.all([login(options.email), login(options.email2)]);
const connectStart = performance.now();
const a = await open(tokenA);
const connectMs = performance.now() - connectStart;
const b = await open(tokenB);

const probesA = a.document.getMap('latency-probe');
const probesB = b.document.getMap('latency-probe');
const sentAt = new Map();
const roundTrips = [];

// B echoes every probe it sees; A times the echo.
probesB.observe((event) => {
  if (event.keysChanged.has('ping')) probesB.set('pong', probesB.get('ping'));
});
const finished = new Promise((resolve) => {
  probesA.observe((event) => {
    if (!event.keysChanged.has('pong')) return;
    const id = probesA.get('pong');
    const started = sentAt.get(id);
    if (started === undefined) return;
    roundTrips.push(performance.now() - started);
    sentAt.delete(id);
    if (roundTrips.length === count) resolve();
  });
});

for (let id = 0; id < count; id += 1) {
  sentAt.set(id, performance.now());
  probesA.set('ping', id);
  await new Promise((resolve) => setTimeout(resolve, interval));
}
await Promise.race([finished, new Promise((resolve) => setTimeout(resolve, 10_000))]);

a.provider.destroy();
b.provider.destroy();

const oneWay = roundTrips.map((ms) => ms / 2).sort((x, y) => x - y);
const format = (ms) => `${ms.toFixed(1)} ms`;
console.log(`Server: ${options.api}  page: ${options.page}`);
console.log(`First connect and sync: ${format(connectMs)}`);
console.log(`Edits delivered: ${roundTrips.length}/${count}`);
if (oneWay.length > 0) {
  console.log('Edit delay, member A to member B (half the echo round trip):');
  console.log(`  median ${format(percentile(oneWay, 50))}`);
  console.log(`  p95    ${format(percentile(oneWay, 95))}`);
  console.log(`  max    ${format(oneWay[oneWay.length - 1])}`);
}
process.exit(roundTrips.length === count ? 0 : 1);
