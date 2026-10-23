# Nodus project context

This is an agent/team handoff, updated on 2026-10-06. Notion owns the product and domain model; Figma owns the UI specification. Verify the relevant live source before implementation. This file records where to look and recent implementation decisions, rather than replacing those sources.

## Project and repositories

Nodus is the DATH 261 Learner-Oriented LMS: course discovery and learning combined with contextual notes and collaborative knowledge workspaces. Older sources use Learner LMS or DATN; these refer to the same project. Commercial marketplace features are outside the MVP.

- [Frontend](https://github.com/TheBluemist1404/dath261-lms-frontend): React web client.
- [Backend](https://github.com/TheBluemist1404/dath261-lms-backend): NestJS API and planned collaboration infrastructure.

## Canonical source map

| Concern | Source |
| --- | --- |
| Project overview | [Notion project hub](https://www.notion.so/3d1eb649baec804d9f59cb15838fcf77) |
| Product requirements | [Requirements Engineering](https://www.notion.so/3e2eb649baec81f9bbf6ed37cf3a8314) |
| Acceptance criteria | [Use Cases](https://www.notion.so/3e2eb649baec81119818cc867b18ce11) |
| Domain structure | [Domain Model](https://www.notion.so/3e2eb649baec810c8d2ffe6329d8ff59) |
| Persistence design | [Data Model & ERD](https://www.notion.so/3e2eb649baec810eb4afcb8585c257f0) |
| Permissions | [Authorization Model](https://www.notion.so/3e2eb649baec814ab314e8ff675e0655) |
| UI screens, states, components | [Figma design](https://www.figma.com/design/ZoyZvigjte06avd3hQ0K7K/Learner-oritented-LMS?node-id=0-1) |
| Workspace UI | [Knowledge Workspaces page](https://www.figma.com/design/ZoyZvigjte06avd3hQ0K7K/Learner-oritented-LMS?node-id=7-6) |

Figma workspace references include the populated list at node `21:91`, personal-only state at `21:7`, and create dialog at `30:13413`. Inspect the relevant frame and alternate states; the file contains more than one screen. If access is unavailable, state that limitation instead of claiming a design comparison. Design prototypes simulate behavior; they do not prove API, persistence, or authorization implementation.

## Recent workspace decisions

These are the latest user-approved clarifications from 2026-10-06; reconcile older source wording before implementing conflicting behavior.

- Student/Lecturer workspace users have a default personal workspace that remains private and has no collaborators. They may create additional workspaces and optionally add collaborators. Additional workspaces can also be used alone; this is about collaboration, not public publishing or a private/public workspace taxonomy.
- Administrators have no workspace workflow in the current product direction. Generic recovery links return home. Older Notion statements granting every User a default workspace need reconciliation with this clarification before backend provisioning is implemented.
- The approved landing-page adaptation shows recently used pages alongside the personal workspace, actual additional-workspace cards, and a Create button on the same line as the section title. Avoid redundant introductory panels.

For membership roles, invitation acceptance, nested pages, live references, and collaboration recovery, consult the Domain, Authorization, and Use Case sources above. Workspace membership does not grant access to referenced course resources; backend authorization remains authoritative.

## Workspace API status

The REST contract the frontend codes against is `docs/workspace-api-contract.md` in the frontend repo (workspaces, pages, members, course references, search, recent pages). It is implemented on `feat/workspace-api` (2026-10-23) in `src/modules/workspaces`, `pages`, `references` and `search`, and was checked end to end against the frontend's `feat/workspace-foundation` branch with mocks off. Decisions approved by the Workspace owner for this work:

- A Student or Lecturer's personal workspace is created the first time they use the workspace API, which also sets `User.defaultWorkspaceId`. Administrators have no workspace and get `403` on workspace routes.
- Course references read Course, CourseBlock and Enrollment through Prisma; they do not depend on the course module.
- Shared pages sync live through a Yjs WebSocket server (Hocuspocus) attached to the API's HTTP server at `/api/collab`, in `src/modules/collaboration`. It authenticates with the REST access token, checks workspace membership per page, serves archived workspaces read-only, stores the Yjs state in `pages.yjs_state` with a plain-text `content` snapshot for search, and closes sessions when a member is removed, a page is deleted, or the workspace is archived or restored. Chosen over the y-webrtc signaling server because WebRTC cannot enforce membership or persist documents. `node scripts/bench-collab.mjs` measures edit delay between two members.
- Page discussion (`src/modules/discussion`): `GET/POST /pages/:pageId/messages` on shared pages and `POST /reports` for messages. New messages are pushed to subscribers of the `discussion:<pageId>` channel on `/api/collab`.
- Pages are archived rather than deleted in the UI: `POST /api/pages/:id/archive` and `/restore` set `pages.archived_at` on the page and its active subpages at the same instant, so a restore brings back exactly that subtree. Archived pages leave the page tree, search and recent pages, stay readable, and are read-only (edits, references and messages return 409; live sessions reconnect as read-only with close reason `page-changed`).
- Out of scope for now: copying course material (FR-RR-07/08), which waits for a course block content contract and file storage.

`pnpm db:seed:dev` fills a development database with a student, a classmate and a lecturer (password `password123`), published and draft courses with FILE and VIDEO blocks, and a shared workspace with pages and references. It uses fixed ids and can be run again safely.

E2E suites share one database: `test/support` provides `createTestApp` (same pipeline as `main.ts` via `configureApp`), `resetDatabase`, real-auth user helpers and course fixtures, and the E2E config runs files one at a time.

## Team boundaries

| Owner | Area |
| --- | --- |
| Vũ Lê Hoàng | Workspace/pages/editor/references; architecture and integration |
| Hồ Phương Duy | Backend identity/auth, authorization, database/shared infrastructure |
| Trần Quốc Bảo | Backend courses/CourseBlock, assessments, lecturer rules |
| Lương Thế Hoàng | Student frontend and initial authentication UI |
| Võ Hoàng Phúc Duy | Lecturer frontend |
| Lê Huy Hoàng | Administration frontend |

Feature owners own their tests. Agree API contracts across the repos; do not take over a teammate's domain as incidental scaffolding.

## Backend implementation context

- NestJS 12, TypeScript, PostgreSQL, Prisma 7, config/DTO validation, Swagger, Biome, and Vitest/Supertest. Read [RULESET.md](RULESET.md) and [CONTRIBUTING.md](CONTRIBUTING.md) before implementation.
- Application domains belong under `src/modules/<domain>/` as they enter implementation. Technical adapters belong under `src/infrastructure/`; controllers stay focused on transport and services own business behavior.
- The inspected `main` baseline has health/config/database infrastructure only. Prisma has a generator and datasource, with no domain models or migrations. Other branches may contain work in progress; inspect the actual target branch before extending it.
- Derive schema and API contracts from the reviewed Notion model. In particular, use the current CourseBlock and Workspace/Page/WorkspaceMembership models rather than the superseded fixed Module/Lesson/Resource or StudyGroup/SharedDocument hierarchies. Do not infer a database model from a Figma card or frontend preview object.
- Course and assessment domain APIs are pending on this baseline; workspace APIs and Yjs/WebSocket persistence exist on `feat/workspace-api`. Frontend preview data and local workspace creation do not establish backend contracts.
- Enforce resource authorization on REST and real-time paths. A platform role alone does not establish workspace ownership, course enrollment, or referenced-resource access. Loss of membership or course access must not expose protected content through an existing connection or reference.
- Frontend workspace auth is currently assumed. Coordinate session/current-user and resource contracts before integration; the frontend auth store is not an authorization boundary.

## Development and checks

Use Node.js 24 as selected by .nvmrc; GitHub CI reads the same file. The older Node 22.12 runner failed in the Nest CLI's CommonJS/ESM dependency loading, while Node 24 builds successfully.

Frontend defaults to `http://localhost:3000`, backend to `http://localhost:3001`. Application REST routes use `/api`; health is `/health`; Swagger is `/docs` when enabled. Declare environment requirements in `.env.example` and keep credentials out of tracked files.

Use `pnpm run ci` for the package quality script. With pnpm 12, bare `pnpm ci` invokes clean installation. Backend checks include Biome, Prisma validation, TypeScript, unit/E2E tests, and build. Prisma commands may need local database configuration; provision test dependencies explicitly rather than relying on a developer database. On PowerShell, use `pnpm.cmd` if execution policy blocks the `.ps1` shim.

Follow repository hooks, Conventional Commits, and attribution rules. Keep this context current when reviewed decisions or implemented contracts change; detailed product rules remain in Notion.
