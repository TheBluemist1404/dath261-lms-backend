# Learner-Oriented LMS — Backend

[![CI](https://github.com/TheBluemist1404/dath261-lms-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/TheBluemist1404/dath261-lms-backend/actions/workflows/ci.yml)

NestJS backend for the **DATH 261 Learner-Oriented Learning Management System**.

The system combines conventional LMS workflows with a student-owned knowledge workspace, permission-aware references to canonical course material, assessment/progress workflows, and real-time collaborative study spaces.

## Source of Truth

Detailed requirements and system modelling live in Notion:

- [Proposal](https://app.notion.com/p/3d9eb649baec804ab901f1ac0a960daa)
- [Requirements & System Modelling](https://app.notion.com/p/3dceb649baec80239320fab55e7a7208)

Notion is canonical for product behavior, domain boundaries, authorization rules, and data modelling. This repository implements those decisions rather than redefining them independently.

## Architecture

```text
React + Lexical
      │
      ├── REST /api ───────────> NestJS API
      │                           Auth / RBAC / LMS domains
      │                                  │
      │                                  ▼
      │                          PostgreSQL + Prisma
      │
      └── WebSocket + Yjs <────> Collaboration service
                                  shared documents / presence

NestJS API ─────────────────────> S3-compatible object storage
                                  (when file storage is implemented)
```

The backend follows NestJS conventions and organizes application code by business domain.

```text
src/
├── config/
├── health/
├── infrastructure/
│   └── database/
│       └── prisma/
└── modules/                 # created as reviewed domains enter implementation
```

Domain modules are intentionally not scaffolded yet. Requirements and models are reviewed in Notion before persistent schemas and API behavior are committed.

## Current Foundation

- NestJS 12 + TypeScript
- REST API prefix at `/api`
- PostgreSQL + Prisma ORM foundation
- environment validation with `@nestjs/config`
- global Nest `ValidationPipe`
- Swagger/OpenAPI at `/docs`
- health endpoint at `/health`
- Vitest + Supertest
- Biome
- Husky + lint-staged + commitlint
- pnpm
- GitHub Actions

The Prisma schema currently contains only the PostgreSQL datasource and client generator. Domain models will be added after the corresponding Notion data-model decisions are reviewed.

## Local Development

### Requirements

- Node.js **22.12+**
- pnpm **12**
- PostgreSQL

Enable Corepack if needed:

```bash
corepack enable
```

Install dependencies:

```bash
pnpm install
```

Create a local environment file:

```bash
cp .env.example .env
```

PowerShell:

```powershell
Copy-Item .env.example .env
```

Set `DATABASE_URL` to your local or development PostgreSQL database, then validate the Prisma setup:

```bash
pnpm prisma:validate
pnpm prisma:generate
```

Start the backend:

```bash
pnpm start:dev
```

### Local endpoints

```text
Frontend        http://localhost:3000
Backend         http://localhost:3001
Application API http://localhost:3001/api/*
Health          http://localhost:3001/health
Swagger         http://localhost:3001/docs
```

The frontend should use `/api` as its API base and proxy that path to the backend during local development.

### Environment

```env
NODE_ENV=development
PORT=3001
CORS_ORIGIN=http://localhost:3000
SWAGGER_ENABLED=true
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dath261_lms
```

Never commit real credentials or local `.env` files.

## Database Workflow

The selected persistence stack is PostgreSQL + Prisma.

Useful commands:

| Command | Purpose |
| --- | --- |
| `pnpm prisma:validate` | Validate Prisma configuration/schema |
| `pnpm prisma:generate` | Generate Prisma Client |
| `pnpm prisma:format` | Format the Prisma schema |
| `pnpm db:migrate` | Create/apply development migrations |
| `pnpm db:deploy` | Apply committed migrations in deployment |
| `pnpm db:studio` | Open Prisma Studio |

Do not create database entities speculatively. The reviewed Notion domain/data model drives Prisma models and migrations.

## Quality Commands

| Command | Purpose |
| --- | --- |
| `pnpm start:dev` | Run NestJS in watch mode |
| `pnpm build` | Compile the backend |
| `pnpm typecheck` | Run TypeScript without emitting |
| `pnpm test` | Run unit tests |
| `pnpm test:e2e` | Run E2E tests |
| `pnpm test:cov` | Run tests with coverage |
| `pnpm lint` | Lint with Biome |
| `pnpm format` | Format with Biome |
| `pnpm check` | Run Biome checks |
| `pnpm ci` | Run the complete local quality gate |

## Contribution Workflow

Coursework changes should remain individually traceable.

```text
Notion requirement / model
        ↓
GitHub issue
        ↓
feature branch
        ↓
focused Conventional Commits
        ↓
Pull Request
        ↓
CI + review
        ↓
main
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [RULESET.md](RULESET.md) before implementation work.
