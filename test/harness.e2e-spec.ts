import { createCourse, enroll } from './support/courses.js';
import { createTestApp, resetDatabase, type TestApp } from './support/test-app.js';
import { createAdmin, registerUser } from './support/users.js';

function claims(accessToken: string) {
  const [, payload] = accessToken.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

describe('E2E harness', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(testApp.prisma);
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it('serves application routes under /api with validation', async () => {
    await testApp.http().post('/api/auth/login').send({}).expect(400);
  });

  it('issues access tokens carrying the user id and role', async () => {
    const student = await registerUser(testApp);
    const admin = await createAdmin(testApp);

    expect(claims(student.accessToken)).toMatchObject({ sub: student.id, role: 'STUDENT' });
    expect(claims(admin.accessToken)).toMatchObject({ sub: admin.id, role: 'ADMIN' });
  });

  it('creates courses with ordered blocks and enrollments', async () => {
    const lecturer = await registerUser(testApp, 'LECTURER');
    const student = await registerUser(testApp);
    const course = await createCourse(testApp, {
      lecturerId: lecturer.id,
      blocks: [
        { type: 'FILE', title: 'Slides' },
        { type: 'VIDEO', title: 'Lecture', content: { durationSeconds: 600 } },
      ],
    });
    await enroll(testApp, student.id, course.id);

    expect(course.blocks.map((block) => block.position)).toEqual([0, 1]);
    expect(await testApp.prisma.enrollment.count()).toBe(1);
  });

  it('resets every table between suites', async () => {
    await registerUser(testApp);
    await resetDatabase(testApp.prisma);

    expect(await testApp.prisma.user.count()).toBe(0);
  });
});
