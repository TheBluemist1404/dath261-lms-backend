// Wipes a local development database, reapplies every migration, then reseeds it.
// Usage: pnpm db:reset:dev (needs DATABASE_URL).
// It only runs against a database on this machine, because a .env that points at the
// hosted database would otherwise lose all of its data. Set ALLOW_DB_RESET=true to
// reset some other throwaway database on purpose.
import 'dotenv/config';
import { execSync } from 'node:child_process';

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to reset a production database.');
}
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required.');
}

const { hostname } = new URL(process.env.DATABASE_URL);
const isLocal = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);

if (!isLocal && process.env.ALLOW_DB_RESET !== 'true') {
  throw new Error(
    `Refusing to reset the database on "${hostname}". Point DATABASE_URL at a local database, or set ALLOW_DB_RESET=true if you really mean it.`,
  );
}

execSync('pnpm exec prisma migrate reset --force', { stdio: 'inherit' });
execSync('node scripts/seed-dev.mjs', { stdio: 'inherit' });
