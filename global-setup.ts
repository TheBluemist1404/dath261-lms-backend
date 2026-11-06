import { execSync } from 'node:child_process';
import { createGlobalSetup } from '@flefebvre/prisma-test-helper/global-setup';

export default createGlobalSetup({
  // Trỏ tới server Postgres của bạn (dùng quyền admin để tạo database con)
  // Lấy từ .env, mặc định là postgres local
  url: process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/postgres',

  // Hàm seed: Chạy Prisma migrate lên database mẫu
  seed: async (databaseUrl) => {
    console.log(`Applying migrations to template database...`);
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    });
  },
});
