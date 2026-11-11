import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
    // Only needed by `pnpm db:check-migrations`, which replays the migrations into it.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
