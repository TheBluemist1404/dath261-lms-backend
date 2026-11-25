import { createTestApp, resetDatabase, type TestApp } from './support/test-app.js';
import { createAdmin, registerUser } from './support/users.js';

// IT-01: the public auth endpoints end to end, including the refresh cookie lifecycle.

const PASSWORD = 'correct-horse-battery';

function refreshCookieOf(response: { headers: Record<string, unknown> }) {
  const header = response.headers['set-cookie'] as string[] | undefined;
  const cookie = header?.find((value) => value.startsWith('refresh_token='));
  if (!cookie) throw new Error('Response has no refresh_token cookie');
  return cookie;
}

function tokenPayload(accessToken: string) {
  const [, payload] = accessToken.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('Auth (e2e)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  beforeEach(async () => {
    await resetDatabase(testApp.prisma);
  });

  const register = (body: Record<string, unknown>) =>
    testApp.http().post('/api/auth/register').send(body);
  const login = (email: string, password = PASSWORD) =>
    testApp.http().post('/api/auth/login').send({ email, password });

  describe('POST /api/auth/register', () => {
    const valid = {
      email: 'new.student@example.com',
      password: PASSWORD,
      role: 'STUDENT',
      firstName: 'Lan',
      lastName: 'Pham',
    };

    it('creates a Student with separate first and last names and no password in the body', async () => {
      const response = await register(valid).expect(201);

      expect(response.body.user).toMatchObject({
        email: valid.email,
        role: 'STUDENT',
        status: 'ACTIVE',
        firstName: 'Lan',
        lastName: 'Pham',
      });
      expect(JSON.stringify(response.body)).not.toMatch(/password/i);

      const stored = await testApp.prisma.user.findUniqueOrThrow({ where: { email: valid.email } });
      expect(stored.passwordHash).not.toBe(PASSWORD);
    });

    it('creates a Lecturer', async () => {
      const response = await register({ ...valid, role: 'LECTURER' }).expect(201);
      expect(response.body.user.role).toBe('LECTURER');
    });

    it('refuses to create an Admin through public registration', async () => {
      await register({ ...valid, role: 'ADMIN' }).expect(400);
      expect(await testApp.prisma.user.count()).toBe(0);
    });

    it('returns 409 for an email that is already registered', async () => {
      await register(valid).expect(201);
      await register({ ...valid, firstName: 'Other' }).expect(409);
    });

    it.each([
      ['an invalid email', { email: 'not-an-email' }],
      ['a short password', { password: 'short' }],
      ['a missing first name', { firstName: '' }],
      ['a missing last name', { lastName: undefined }],
    ])('returns 400 for %s', async (_label, override) => {
      await register({ ...valid, ...override }).expect(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('returns an access token carrying the role and sets an HttpOnly refresh cookie on /api/auth', async () => {
      const lecturer = await registerUser(testApp, 'LECTURER');

      const response = await login(lecturer.email).expect(200);

      expect(typeof response.body.accessToken).toBe('string');
      expect(response.body.refreshToken).toBeUndefined();
      expect(tokenPayload(response.body.accessToken)).toMatchObject({ role: 'LECTURER' });

      const cookie = refreshCookieOf(response);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Path=\/api\/auth/);
      expect(cookie).toMatch(/SameSite=Strict/i);
    });

    it('returns 401 for a wrong password and for an unknown email, with the same message', async () => {
      const student = await registerUser(testApp, 'STUDENT');

      const wrongPassword = await login(student.email, 'wrong-password-123').expect(401);
      const unknownEmail = await login('nobody@example.com').expect(401);

      expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
    });

    it('lets a seeded Admin log in', async () => {
      const admin = await createAdmin(testApp);
      expect(tokenPayload(admin.accessToken)).toMatchObject({ role: 'ADMIN' });
    });
  });

  describe('refresh and logout', () => {
    it('rotates the refresh token and rejects the old one afterwards', async () => {
      const student = await registerUser(testApp, 'STUDENT');
      const first = refreshCookieOf(await login(student.email).expect(200));

      const refreshed = await testApp
        .http()
        .post('/api/auth/refresh')
        .set('Cookie', first.split(';', 1)[0])
        .expect(200);
      const second = refreshCookieOf(refreshed);

      expect(typeof refreshed.body.accessToken).toBe('string');
      expect(second.split(';', 1)[0]).not.toBe(first.split(';', 1)[0]);

      // The rotated-out token no longer works; the new one does.
      await testApp
        .http()
        .post('/api/auth/refresh')
        .set('Cookie', first.split(';', 1)[0])
        .expect(401);
      await testApp
        .http()
        .post('/api/auth/refresh')
        .set('Cookie', second.split(';', 1)[0])
        .expect(200);
    });

    it('returns 401 without a refresh cookie or with a forged one', async () => {
      await testApp.http().post('/api/auth/refresh').expect(401);
      await testApp
        .http()
        .post('/api/auth/refresh')
        .set('Cookie', 'refresh_token=forged')
        .expect(401);
    });

    it('logout revokes the session and clears the cookie', async () => {
      const student = await registerUser(testApp, 'STUDENT');
      const cookie = refreshCookieOf(await login(student.email).expect(200)).split(';', 1)[0];

      const response = await testApp
        .http()
        .post('/api/auth/logout')
        .set('Cookie', cookie)
        .expect(204);

      expect(refreshCookieOf(response)).toMatch(/refresh_token=;/);
      await testApp.http().post('/api/auth/refresh').set('Cookie', cookie).expect(401);
    });

    it('logout without a cookie still succeeds', async () => {
      await testApp.http().post('/api/auth/logout').expect(204);
    });
  });

  describe('access tokens on protected routes', () => {
    it('returns 401 without a token and with a malformed token', async () => {
      await testApp.http().get('/api/users/me/enrollments').expect(401);
      await testApp
        .http()
        .get('/api/users/me/enrollments')
        .set('Authorization', 'Bearer not-a-jwt')
        .expect(401);
    });

    it('returns 403 when the role does not match the route', async () => {
      const student = await registerUser(testApp, 'STUDENT');
      await testApp.http().get('/api/admin/users').set(student.auth).expect(403);
    });
  });
});
