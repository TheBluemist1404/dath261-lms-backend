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
- Authentication, domain APIs, Lexical document storage, and Yjs/WebSocket persistence are pending on this baseline. Frontend preview data and local workspace creation do not establish backend contracts.
- Enforce resource authorization on REST and real-time paths. A platform role alone does not establish workspace ownership, course enrollment, or referenced-resource access. Loss of membership or course access must not expose protected content through an existing connection or reference.
- Frontend workspace auth is currently assumed. Coordinate session/current-user and resource contracts before integration; the frontend auth store is not an authorization boundary.

## Development and checks

Frontend defaults to `http://localhost:3000`, backend to `http://localhost:3001`. Application REST routes use `/api`; health is `/health`; Swagger is `/docs` when enabled. Declare environment requirements in `.env.example` and keep credentials out of tracked files.

Use `pnpm run ci` for the package quality script. With pnpm 12, bare `pnpm ci` invokes clean installation. Backend checks include Biome, Prisma validation, TypeScript, unit/E2E tests, and build. Prisma commands may need local database configuration; provision test dependencies explicitly rather than relying on a developer database. On PowerShell, use `pnpm.cmd` if execution policy blocks the `.ps1` shim.

Follow repository hooks, Conventional Commits, and attribution rules. Keep this context current when reviewed decisions or implemented contracts change; detailed product rules remain in Notion.
