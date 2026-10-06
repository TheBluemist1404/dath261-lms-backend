# Contributing

This repository contains the NestJS backend for the DATN 261 Learner-Oriented LMS.

## Source of Truth

Product requirements, use cases, domain models, authorization rules, data modelling, and system architecture are maintained in the DATN 261 Notion workspace.

Do not invent persistent entities, API behavior, permissions, or lifecycle rules only in code. If implementation exposes a missing decision, refine the relevant Notion model first and reference that decision from the issue/PR.

## Start From an Issue

Non-trivial work should begin with a GitHub issue containing:

- scope and expected behavior;
- relevant requirement IDs/use cases from Notion;
- acceptance criteria;
- expected test evidence.

## Branch From `main`

```bash
git switch main
git pull --ff-only
git switch -c feat/42-course-enrollment
```

Recommended prefixes:

```text
feat/
fix/
refactor/
test/
docs/
chore/
```

## Backend Structure

Application code is organized primarily by business domain under `src/modules/` as domains are implemented.

Cross-cutting adapters belong under `src/infrastructure/`, for example PostgreSQL/Prisma integration. Avoid global controller/service/repository folders that scatter one domain across the repository.

Follow NestJS module/controller/provider conventions and keep controllers focused on transport concerns.

## Persistence

PostgreSQL + Prisma is the selected persistence stack.

The Prisma schema must be derived from the reviewed Notion data model. Do not add speculative tables or relations simply because they may be useful later.

Create migrations for reviewed schema changes and include migration impact in the PR.

## Authorization

Role checks are only the first layer. Protected operations may depend on ownership, enrollment state, publication state, group membership, or explicit sharing.

Authorization must be enforced on the backend and on protected real-time connections. Frontend visibility checks are not security controls.

## Commit Cleanly

Use Conventional Commits:

```text
feat: add enrollment workflow
fix: block revoked resource references
test: cover course access policy
refactor: extract workspace access checks
docs: clarify database setup
chore: update CI configuration
```

Husky runs staged-file checks and typechecking. Commit messages are validated by commitlint.

## Test the Change

Before opening a pull request:

```bash
pnpm run ci
```

The quality gate checks Biome, the Prisma schema, TypeScript, unit tests, E2E tests, and the production build.

Tests that require a real database should explicitly provision/seed their test database rather than depending on a developer's local state.

## Pull Requests

Keep PRs focused and individually traceable. A good PR:

- links the relevant issue;
- references applicable Notion requirements/use cases;
- explains authorization or data-model changes;
- includes appropriate tests;
- avoids unrelated cleanup;
- documents migrations/environment changes;
- calls out known limitations or follow-up work.
