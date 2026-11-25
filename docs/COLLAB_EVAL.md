# Collaboration evaluation

Results for the real-time collaboration component (Hocuspocus/Yjs over `/api/collab`), for the final
report (BE #49). Measured on 25 Nov 2026 against a local production build (`node dist/src/main.js`,
Node 24, PostgreSQL 16) with the clients in the same machine, so the latency figures are server and
protocol overhead without network distance. Raw numbers: [`eval/collab-local.json`](eval/collab-local.json).

## Results

| ID | What | Method | Result |
| --- | --- | --- | --- |
| EV-01 | Convergence | 20 runs; 3 members make 50 random concurrent inserts and deletes each on one page | **20/20** runs: every client ended with the same text and the same Yjs state vector, and a new client opening the page after the store showed the same text (stored state = client state) |
| EV-02 | Edit latency | One member writes 200 edits, 50 ms apart; every other member timestamps their arrival (one clock) | See the table below; every edit delivered |
| EV-03 | Offline edits and reconnect | 20 runs; one member goes offline, both members write 10 edits each, the member reconnects | **20/20** runs kept all 21 markers on both sides; the documents had diverged in 20/20 runs before the reconnect; merged in 16 ms median, 18 ms max after reconnecting |
| EV-04 | Authorization | Ten access cases against the socket | **10/10** as expected, listed below |

### EV-02 Edit delay to another member (ms, local)

| Clients on the page | Edits delivered | p50 | p95 | max | Time for all clients to connect and sync |
| --- | --- | --- | --- | --- | --- |
| 2 | 200/200 | 1.1 | 1.4 | 2.2 | 9 |
| 3 | 400/400 | 1.0 | 1.6 | 3.4 | 18 |
| 5 | 800/800 | 1.1 | 1.5 | 3.4 | 34 |

The delay does not grow with the number of clients up to five. On Render the network round trip
adds to these numbers; see "Running it" for measuring the deployed server.

### EV-04 Authorization cases

| Case | Expected | Result |
| --- | --- | --- |
| Non-member of the workspace | refused, no content | Pass |
| Empty token | refused | Pass |
| Malformed token | refused | Pass |
| Member's token with a forged signature | refused | Pass |
| Unknown page id | refused | Pass |
| Member removed while connected | connection closed | Pass |
| Removed member reconnects | refused | Pass |
| Another user opens a personal page | refused | Pass |
| Owner opens their own personal page over the socket | refused (personal pages are not shared) | Pass |
| Edit sent to an archived page | read-only; the edit is not stored | Pass |

"Refused" also checks that the client received none of the document: the page's text, editor
content and probe data stay empty on the refused client.

## Running it

```bash
# Backend running on localhost:3001 (pnpm start:dev, or pnpm build && pnpm start:prod)
pnpm eval:collab                          # all four, 20 runs, 200 probes per writer
pnpm eval:collab --only latency --clients 2,3,5 --probes 200
pnpm eval:collab --runs 5 --out /tmp/collab.json
```

The script registers its own throwaway accounts, creates a workspace and one page per run, and
writes into separate shared types (`eval-text`, `eval-latency`), so editor content on other pages is
untouched. It exits with status 1 if any convergence, reconnect or authorization check fails.

Because it creates accounts and data, it refuses to run against a host other than `localhost`.
To measure the deployed server, which adds the real network delay, pass `--allow-remote`
(for example `--api https://<backend>.onrender.com --allow-remote --only latency`), and only with
the team's agreement, since the accounts and pages stay in that database.

The older `scripts/bench-collab.mjs` measures two-client latency on the seeded page as half the
echo round trip; it needs no new accounts.

## Not covered here

- Usability: the 8 to 12 student session (30 Nov to 6 Dec) is run separately.
- Load beyond five clients on one page, and long-running sessions.
