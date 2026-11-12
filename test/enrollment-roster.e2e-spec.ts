// test/enrollment-roster.e2e-spec.ts
import { CourseStatus, EnrollmentStatus } from '../src/generated/prisma/enums.js';
import { createTestApp, resetDatabase, type TestApp } from './support/test-app.js';
import { registerUser, type TestUser } from './support/users.js';

describe('Enrollment roster (e2e)', () => {
  let testApp: TestApp;
  let lecturer: TestUser;
  let otherLecturer: TestUser;
  let student: TestUser;
  let courseId: string;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  beforeEach(async () => {
    await resetDatabase(testApp.prisma);

    lecturer = await registerUser(testApp, 'LECTURER');
    otherLecturer = await registerUser(testApp, 'LECTURER');
    student = await registerUser(testApp, 'STUDENT');

    await testApp.prisma.user.update({
      where: { id: lecturer.id },
      data: { firstName: 'Lec', lastName: 'Owner' },
    });
    await testApp.prisma.user.update({
      where: { id: otherLecturer.id },
      data: { firstName: 'Lec', lastName: 'Other' },
    });
    await testApp.prisma.user.update({
      where: { id: student.id },
      data: { firstName: 'An', lastName: 'Nguyen' },
    });

    const course = await testApp.prisma.course.create({
      data: {
        title: 'Roster Course',
        lecturerId: lecturer.id,
        status: CourseStatus.PUBLISHED,
      },
    });
    courseId = course.id;

    await testApp.prisma.enrollment.create({
      data: {
        userId: student.id,
        courseId,
        status: EnrollmentStatus.ACTIVE,
      },
    });
  });

  const basePath = () => `/api/courses/${courseId}/enrollments`;

  // ===========================================================================
  // Auth
  // ===========================================================================
  describe('auth', () => {
    it('should return 401 for a guest', async () => {
      await testApp.http().get(basePath()).expect(401);
    });

    it('should return 403 for a Student', async () => {
      await testApp.http().get(basePath()).set(student.auth).expect(403);
    });

    it('should return 403 for a Lecturer who does not own the course', async () => {
      await testApp.http().get(basePath()).set(otherLecturer.auth).expect(403);
    });

    it('should return 404 for an unknown course', async () => {
      await testApp
        .http()
        .get('/api/courses/non-existent/enrollments')
        .set(lecturer.auth)
        .expect(404);
    });
  });

  // ===========================================================================
  // Happy path
  // ===========================================================================
  describe('GET /api/courses/:courseId/enrollments', () => {
    it('should return the roster for the owning Lecturer', async () => {
      const res = await testApp.http().get(basePath()).set(lecturer.auth).expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta).toEqual({
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      });

      const row = res.body.data[0];
      expect(row.enrollmentId).toBeTruthy();
      expect(row.status).toBe(EnrollmentStatus.ACTIVE);
      expect(row.enrolledAt).toBeTruthy();
      expect(row.completedAt).toBeNull();
      expect(row.student).toEqual({
        id: student.id,
        firstName: 'An',
        lastName: 'Nguyen',
        email: student.email,
      });
      expect(row.progress).toEqual({
        completedBlocks: 0,
        totalBlocks: 0,
        percent: 0,
      });
      expect(row.quizScore).toBeNull();
    });

    it('should filter LEFT enrollments only when status=LEFT', async () => {
      const leftStudent = await registerUser(testApp, 'STUDENT');
      await testApp.prisma.enrollment.create({
        data: { userId: leftStudent.id, courseId, status: EnrollmentStatus.LEFT },
      });

      const defaultRes = await testApp.http().get(basePath()).set(lecturer.auth).expect(200);
      const defaultEmails = defaultRes.body.data.map(
        (r: { student: { email: string } }) => r.student.email,
      );
      expect(defaultEmails).not.toContain(leftStudent.email);

      const leftRes = await testApp
        .http()
        .get(basePath())
        .query({ status: EnrollmentStatus.LEFT })
        .set(lecturer.auth)
        .expect(200);

      expect(leftRes.body.data).toHaveLength(1);
      expect(leftRes.body.data[0].student.email).toBe(leftStudent.email);
    });

    it('should search by name/email (case-insensitive)', async () => {
      const res = await testApp
        .http()
        .get(basePath())
        .query({ search: 'AN' })
        .set(lecturer.auth)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].student.email).toBe(student.email);

      const none = await testApp
        .http()
        .get(basePath())
        .query({ search: 'zzz-nope' })
        .set(lecturer.auth)
        .expect(200);

      expect(none.body.data).toHaveLength(0);
      expect(none.body.meta.total).toBe(0);
    });

    it('should paginate', async () => {
      const extra = await registerUser(testApp, 'STUDENT');
      await testApp.prisma.enrollment.create({
        data: { userId: extra.id, courseId, status: EnrollmentStatus.ACTIVE },
      });

      const page1 = await testApp
        .http()
        .get(basePath())
        .query({ limit: 1, page: 1 })
        .set(lecturer.auth)
        .expect(200);
      expect(page1.body.data).toHaveLength(1);
      expect(page1.body.meta).toEqual({
        total: 2,
        page: 1,
        limit: 1,
        totalPages: 2,
        hasNextPage: true,
        hasPrevPage: false,
      });

      const page2 = await testApp
        .http()
        .get(basePath())
        .query({ limit: 1, page: 2 })
        .set(lecturer.auth)
        .expect(200);
      expect(page2.body.data).toHaveLength(1);
      expect(page2.body.meta.hasPrevPage).toBe(true);
      expect(page2.body.meta.hasNextPage).toBe(false);
    });

    it('should return the roster for a DRAFT course (FR-EN-07)', async () => {
      await testApp.prisma.course.update({
        where: { id: courseId },
        data: { status: CourseStatus.DRAFT },
      });

      const res = await testApp.http().get(basePath()).set(lecturer.auth).expect(200);
      expect(res.body.data).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Query validation
  // ===========================================================================
  describe('query validation', () => {
    it('should reject limit > 100 with 400', async () => {
      await testApp.http().get(basePath()).query({ limit: 101 }).set(lecturer.auth).expect(400);
    });

    it('should reject page < 1 with 400', async () => {
      await testApp.http().get(basePath()).query({ page: 0 }).set(lecturer.auth).expect(400);
    });

    it('should reject an unknown status with 400', async () => {
      await testApp
        .http()
        .get(basePath())
        .query({ status: 'INVALID' })
        .set(lecturer.auth)
        .expect(400);
    });
  });
});
