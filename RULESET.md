# DATH 261 Backend Rules

These rules define the engineering boundaries for the Learner-Oriented LMS backend.

## 1. Notion Is the Product Source of Truth

The DATH 261 Notion workspace owns requirements, use cases, domain models, authorization rules, system architecture, and the conceptual data model.

Code and database migrations implement those decisions; they must not silently redefine them.

If implementation reveals an unresolved product rule, update/review the relevant Notion model before hard-coding the decision.

## 2. Follow NestJS Conventions First

Use Nest modules, controllers, providers/services, guards, pipes, interceptors, and decorators according to their intended framework roles.

Do not build a parallel framework inside NestJS.

## 3. Organize by Business Domain

As implementation begins, application features belong under:

```text
src/
└── modules/
    └── <domain>/
        ├── <domain>.module.ts
        ├── <domain>.controller.ts
        ├── <domain>.service.ts
        └── dto/
```

Do not create global `controllers/`, `services/`, `repositories/`, or `dto/` folders that scatter one domain across the repository.

Do not scaffold empty domain modules before their requirements are ready.

## 4. Keep Infrastructure Explicit

Cross-cutting technical adapters belong under `src/infrastructure/`.

Current selected infrastructure:

- PostgreSQL;
- Prisma ORM;
- S3-compatible object storage when file storage is implemented;
- an authenticated Yjs/WebSocket collaboration path when real-time work is implemented.

Domain modules may depend on infrastructure providers, but persistence/storage implementation details should not leak into controllers.

## 5. Keep Controllers Thin

Controllers handle HTTP transport concerns: routing, request extraction, DTO validation, status codes, and delegation.

Business/application behavior belongs in providers/services.

## 6. Authorization Is Resource-Aware

Do not rely on role checks alone.

Authorization can depend on:

- ownership;
- current enrollment;
- course/content publication state;
- study-group membership;
- explicit sharing/invitation;
- administrative moderation scope.

Course-resource references must re-check both note/page access and current access to the canonical course resource.

Frontend checks are UX only. Backend REST and WebSocket paths enforce authorization.

## 7. Prisma Models Follow the Reviewed Data Model

PostgreSQL + Prisma is the project persistence stack.

The Prisma schema must be derived from the canonical Notion Data Model & ERD. Do not add speculative models, fields, enums, or relations.

Every reviewed schema change should be represented by a migration once the database baseline is established.

Generated Prisma Client code is not committed.

## 8. Avoid Premature Architecture

Do not introduce repository ports, use-case classes, mapping layers, generic base services, or domain wrappers by default.

Add an abstraction when it creates a concrete boundary, supports meaningful substitution/testing, or resolves demonstrated complexity.

## 9. Configuration and Secrets

- Declare required environment variables in `.env.example`.
- Validate runtime configuration at startup.
- Never commit real secrets or local `.env` files.
- Production credentials belong in the deployment environment.

## 10. API Boundary

- Application REST routes live under `/api`.
- `/health` is an infrastructure endpoint outside the API prefix.
- Swagger is exposed at `/docs` when enabled.
- Use DTOs plus Nest validation at external boundaries.
- Do not introduce API versioning until there is a concrete compatibility need.

## 11. Testing

- Unit-test meaningful policy/service behavior.
- Use E2E tests for important HTTP/application boundaries.
- Add explicit authorization tests for protected resources.
- Real-time collaboration must include connection authorization, convergence, and reconnect tests.
- Keep tests deterministic and independent from developer machines.

Run `pnpm ci` before opening a PR.

## 12. Workflow and Traceability

Use:

```text
Notion requirement/model
        ↓
GitHub issue
        ↓
focused branch + commits
        ↓
pull request + tests
        ↓
CI/review
        ↓
main
```

Use Conventional Commits and keep coursework contributions individually traceable.
