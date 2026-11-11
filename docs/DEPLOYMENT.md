# Deployment and demo setup

How the backend is built, deployed to Render and filled with demo data. The frontend is on Vercel and
reaches this backend through the `/api` rewrite in its `vercel.json`.

## Build and start

| Step | Command | Notes |
| --- | --- | --- |
| Install | `pnpm install --frozen-lockfile` | Installs dev dependencies too; the build needs them. |
| Generate client | `pnpm prisma generate` | Run it explicitly on hosts that cache `node_modules` and skip `postinstall`. |
| Build | `pnpm build` | Emits `dist/src/main.js`, because the root config files are compiled too. |
| Start | `pnpm start:prod` | Runs `node dist/src/main.js`. |

CI builds the app, applies the migrations to an empty database, seeds it, starts `pnpm start:prod` and
checks `/health` and an admin login, so a broken start command fails the pull request.

## Environment variables

| Variable | Required | Example | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | yes | `production` | `development`, `test` or `production`. |
| `PORT` | no | `3001` | Render sets it. |
| `DATABASE_URL` | yes | `postgresql://…` | The app refuses to start without it. |
| `JWT_ACCESS_SECRET` | yes | a long random string | Signs access tokens and collaboration tickets. |
| `CORS_ORIGIN` | set it in production | `https://<frontend>.vercel.app` | Comma-separated list. Defaults to `http://localhost:3000`. |
| `SWAGGER_ENABLED` | no | `true` | Serves `/docs`. Defaults to `false` when `NODE_ENV=production`. |
| `NODE_VERSION` | Render only | `24` | Matches `.nvmrc`. |
| `SHADOW_DATABASE_URL` | no | `postgresql://…/shadow` | Only for `pnpm db:check-migrations`. Never point it at real data. |

Keep real values in Render's environment settings and in your own `.env`, never in the repository.

## Render

Current service settings:

- **Build:** `NODE_ENV=development corepack pnpm install --frozen-lockfile && corepack pnpm prisma generate && corepack pnpm prisma db push && corepack pnpm build`
- **Start:** `node dist/src/main.js` (same as `pnpm start:prod`)
- **Health check path:** `/health`

`NODE_ENV=development` on install keeps the dev dependencies that the build needs. The app itself runs
with `NODE_ENV=production`.

### Moving production from `db push` to migrations

The schema has been tracked as migrations since `20261106025336_init`, and CI fails when the schema and
the migrations differ. Production still applies the schema with `prisma db push`, which applies changes
without recording them and can drop columns without asking. Switch it once, from a shell whose
`DATABASE_URL` is the production database:

1. Check that production matches the committed migrations. This only reads the database:

   ```bash
   pnpm exec prisma migrate diff --from-config-datasource --to-migrations prisma/migrations --exit-code
   ```

   It should print `No difference detected.` If it lists changes, stop and sort them out first.
2. Mark the baseline as already applied, so Prisma does not try to recreate existing tables:

   ```bash
   pnpm exec prisma migrate resolve --applied 20261106025336_init
   ```

   Do the same for any later migration that step 1 showed is already in the database.
3. In the Render build command, replace `corepack pnpm prisma db push` with `corepack pnpm db:deploy`.
4. Redeploy and check the smoke list below.

From then on, every schema change ships as a migration and Render applies it on deploy.

## Demo data

`pnpm db:seed:dev` adds fixed demo rows. Rows have fixed ids, so running it again leaves existing data
alone. It refuses to run when `NODE_ENV=production`, so set `NODE_ENV=development` for that one command
when seeding the hosted database on purpose.

Every account uses the password `password123`:

| Role | Email | What it has |
| --- | --- | --- |
| Student | `student@dath261.dev` | Enrolled in Algorithms; owns the "Algorithms study group" workspace |
| Student | `classmate@dath261.dev` | Member of the study group, for collaboration demos |
| Lecturer | `lecturer@dath261.dev` | Owns Algorithms, Databases (published) and Compilers (draft) |
| Admin | `admin@dath261.dev` | Admin screens only; admins have no workspace |

## Resetting a local database

`pnpm db:reset:dev` drops every table in the `DATABASE_URL` database, reapplies the migrations and
reseeds it. Because a `.env` can point at the hosted database, it only runs when the database host is
`localhost`, `127.0.0.1` or `::1`. To reset another throwaway database, set `ALLOW_DB_RESET=true` for
that one command. Never use it on production.

## Smoke checklist after a deploy

1. `GET https://<backend>/health` returns `{"status":"ok"}`.
2. `https://<backend>/docs` loads when `SWAGGER_ENABLED=true`.
3. On the frontend, sign in as each demo account; the admin lands on `/admin`.
4. As the student, open a page in the study group workspace, and open the same page as the classmate in
   another browser. Edits show up on both sides within a few seconds, which shows `VITE_COLLAB_URL`
   (`wss://<backend>/api/collab`) is right.
5. Sign out and back in; the session refresh works (the refresh cookie lives on `/api/auth`).
