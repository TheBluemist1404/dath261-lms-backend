import * as bcrypt from 'bcrypt';
import { UserRole } from '../../src/generated/prisma/enums.js';
import type { TestApp } from './test-app.js';

export interface TestUser {
  id: string;
  email: string;
  role: UserRole;
  accessToken: string;
  auth: { Authorization: string };
}

const PASSWORD = 'correct-horse-battery';

let sequence = 0;

function nextEmail(role: UserRole) {
  sequence += 1;
  return `${role.toLowerCase()}-${sequence}-${Date.now()}@example.com`;
}

async function login(testApp: TestApp, email: string) {
  const response = await testApp
    .http()
    .post('/api/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);

  return response.body.accessToken as string;
}

function toTestUser(id: string, email: string, role: UserRole, accessToken: string): TestUser {
  return { id, email, role, accessToken, auth: { Authorization: `Bearer ${accessToken}` } };
}

/** Registers a Student or Lecturer through the real auth endpoints and logs in. */
export async function registerUser(
  testApp: TestApp,
  role: 'STUDENT' | 'LECTURER' = 'STUDENT',
  overrides: { email?: string; firstName?: string; lastName?: string } = {},
): Promise<TestUser> {
  const email = overrides.email ?? nextEmail(UserRole[role]);

  const response = await testApp
    .http()
    .post('/api/auth/register')
    .send({
      email,
      password: PASSWORD,
      role,
      firstName: overrides.firstName ?? 'Test',
      lastName: overrides.lastName ?? (role === 'STUDENT' ? 'Student' : 'Lecturer'),
    })
    .expect(201);

  return toTestUser(response.body.user.id, email, UserRole[role], await login(testApp, email));
}

/** Public registration cannot create Admins, so they are inserted directly. */
export async function createAdmin(testApp: TestApp): Promise<TestUser> {
  const email = nextEmail(UserRole.ADMIN);
  const user = await testApp.prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      role: UserRole.ADMIN,
      firstName: 'Test',
      lastName: 'Admin',
    },
  });

  return toTestUser(user.id, email, UserRole.ADMIN, await login(testApp, email));
}
