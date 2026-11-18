import {
  AccountStatus,
  AuditAction,
  AuditEntityType,
  BlockType,
  CourseStatus,
  EnrollmentStatus,
  QuestionType,
  QuizAttemptStatus,
  ReportStatus,
  ReportTargetType,
} from '../src/generated/prisma/enums.js';
import { createCourse, enroll } from './support/courses.js';
import { createTestApp, resetDatabase, type TestApp } from './support/test-app.js';
import { createAdmin, registerUser, type TestUser } from './support/users.js';

const PASSWORD = 'correct-horse-battery';

describe('Admin (e2e)', () => {
  let testApp: TestApp;
  let student: TestUser;
  let lecturer: TestUser;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  beforeEach(async () => {
    await resetDatabase(testApp.prisma);

    student = await registerUser(testApp, 'STUDENT');
    lecturer = await registerUser(testApp, 'LECTURER');
  });

  // ---------------------------------------------------------------------------
  // RBAC
  // ---------------------------------------------------------------------------

  describe('authorization', () => {
    it('should return 401 for unauthenticated requests to all four endpoints', async () => {
      await testApp.http().get('/api/admin/users').expect(401);

      await testApp
        .http()
        .patch('/api/admin/users/non-existent-user/status')
        .send({ status: AccountStatus.SUSPENDED })
        .expect(401);

      await testApp.http().get('/api/admin/courses').expect(401);

      await testApp
        .http()
        .patch('/api/admin/courses/non-existent-course/suspension')
        .send({ suspended: true })
        .expect(401);
    });

    it('should return 403 for students on all four endpoints', async () => {
      await testApp.http().get('/api/admin/users').set(student.auth).expect(403);

      await testApp
        .http()
        .patch(`/api/admin/users/${student.id}/status`)
        .set(student.auth)
        .send({ status: AccountStatus.SUSPENDED })
        .expect(403);

      await testApp.http().get('/api/admin/courses').set(student.auth).expect(403);

      await testApp
        .http()
        .patch('/api/admin/courses/non-existent-course/suspension')
        .set(student.auth)
        .send({ suspended: true })
        .expect(403);
    });

    it('should return 403 for lecturers on all four endpoints', async () => {
      await testApp.http().get('/api/admin/users').set(lecturer.auth).expect(403);

      await testApp
        .http()
        .patch(`/api/admin/users/${student.id}/status`)
        .set(lecturer.auth)
        .send({ status: AccountStatus.SUSPENDED })
        .expect(403);

      await testApp.http().get('/api/admin/courses').set(lecturer.auth).expect(403);

      await testApp
        .http()
        .patch('/api/admin/courses/non-existent-course/suspension')
        .set(lecturer.auth)
        .send({ suspended: true })
        .expect(403);
    });
  });

  // ---------------------------------------------------------------------------
  // User suspension lifecycle
  // ---------------------------------------------------------------------------

  describe('user suspension lifecycle', () => {
    it('should suspend, block login/refresh, reactivate, and allow login again', async () => {
      const admin = await createAdmin(testApp);
      const target = await registerUser(testApp, 'STUDENT');

      // Log in again to capture a refresh cookie for this test.
      const loginBeforeSuspension = await testApp
        .http()
        .post('/api/auth/login')
        .send({
          email: target.email,
          password: PASSWORD,
        })
        .expect(200);

      const setCookie = loginBeforeSuspension.headers['set-cookie'];
      const refreshCookie = setCookie?.[0]?.split(';', 1)[0];

      //expect(refreshCookie).toBeDefined();
      if (!refreshCookie) {
        throw new Error('Login response is missing the refresh cookie');
      }

      // Admin suspends the target account.
      const suspended = await testApp
        .http()
        .patch(`/api/admin/users/${target.id}/status`)
        .set(admin.auth)
        .send({ status: AccountStatus.SUSPENDED })
        .expect(200);

      expect(suspended.body).toMatchObject({
        id: target.id,
        status: AccountStatus.SUSPENDED,
      });

      // All refresh sessions have been revoked by the admin operation.
      const activeSessions = await testApp.prisma.authSession.count({
        where: {
          userId: target.id,
          revokedAt: null,
        },
      });

      expect(activeSessions).toBe(0);

      // Login is rejected because the account is suspended.
      await testApp
        .http()
        .post('/api/auth/login')
        .send({
          email: target.email,
          password: PASSWORD,
        })
        .expect(403);

      // The old refresh token is rejected because the admin already revoked it.
      await testApp.http().post('/api/auth/refresh').set('Cookie', refreshCookie).expect(401);

      // Admin reactivates the account.
      const reactivated = await testApp
        .http()
        .patch(`/api/admin/users/${target.id}/status`)
        .set(admin.auth)
        .send({ status: AccountStatus.ACTIVE })
        .expect(200);

      expect(reactivated.body).toMatchObject({
        id: target.id,
        status: AccountStatus.ACTIVE,
      });

      // A new login is allowed after reactivation.
      await testApp
        .http()
        .post('/api/auth/login')
        .send({
          email: target.email,
          password: PASSWORD,
        })
        .expect(200);
    });

    it('should reject an admin attempting to suspend their own account', async () => {
      const admin = await createAdmin(testApp);

      await testApp
        .http()
        .patch(`/api/admin/users/${admin.id}/status`)
        .set(admin.auth)
        .send({ status: AccountStatus.SUSPENDED })
        .expect(400);

      const persisted = await testApp.prisma.user.findUniqueOrThrow({
        where: { id: admin.id },
      });

      expect(persisted.status).toBe(AccountStatus.ACTIVE);
    });

    it('should return 404 when the target user does not exist', async () => {
      const admin = await createAdmin(testApp);

      await testApp
        .http()
        .patch('/api/admin/users/non-existent-user/status')
        .set(admin.auth)
        .send({ status: AccountStatus.SUSPENDED })
        .expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Course suspension lifecycle
  // ---------------------------------------------------------------------------

  describe('course suspension lifecycle', () => {
    it('should hide a suspended course and block/restore existing learner access', async () => {
      const admin = await createAdmin(testApp);

      const course = await createCourse(testApp, {
        lecturerId: lecturer.id,
        title: 'Admin suspension workflow course',
        status: CourseStatus.PUBLISHED,
        blocks: [
          {
            type: BlockType.TEXT,
            title: 'Introduction',
            content: { text: 'Course content' },
          },
        ],
      });

      // Student enrolls before course suspension.
      await enroll(testApp, student.id, course.id);

      const catalogBefore = await testApp
        .http()
        .get('/api/courses/catalog')
        .query({ search: 'Admin suspension workflow course' })
        .expect(200);

      expect(catalogBefore.body.data.some((item: { id: string }) => item.id === course.id)).toBe(
        true,
      );

      // Admin suspends the course.
      const suspended = await testApp
        .http()
        .patch(`/api/admin/courses/${course.id}/suspension`)
        .set(admin.auth)
        .send({ suspended: true })
        .expect(200);

      expect(suspended.body).toMatchObject({
        id: course.id,
        isSuspended: true,
      });

      // Suspended courses disappear from the student-facing catalog.
      const catalogAfter = await testApp
        .http()
        .get('/api/courses/catalog')
        .query({ search: 'Admin suspension workflow course' })
        .expect(200);

      expect(catalogAfter.body.data.some((item: { id: string }) => item.id === course.id)).toBe(
        false,
      );

      // Existing enrollment is retained, but learning access is blocked.
      const enrollment = await testApp.prisma.enrollment.findUniqueOrThrow({
        where: {
          userId_courseId: {
            userId: student.id,
            courseId: course.id,
          },
        },
      });

      expect(enrollment.status).toBe('ACTIVE');

      await testApp.http().get(`/api/courses/${course.id}/progress`).set(student.auth).expect(403);

      // Admin unsuspends the course.
      const unsuspended = await testApp
        .http()
        .patch(`/api/admin/courses/${course.id}/suspension`)
        .set(admin.auth)
        .send({ suspended: false })
        .expect(200);

      expect(unsuspended.body).toMatchObject({
        id: course.id,
        isSuspended: false,
      });

      // Existing learner access is restored without creating a new enrollment.
      await testApp.http().get(`/api/courses/${course.id}/progress`).set(student.auth).expect(200);

      const enrollmentAfter = await testApp.prisma.enrollment.findUniqueOrThrow({
        where: {
          userId_courseId: {
            userId: student.id,
            courseId: course.id,
          },
        },
      });

      expect(enrollmentAfter.id).toBe(enrollment.id);
      expect(enrollmentAfter.status).toBe('ACTIVE');
    });

    it('should return 404 when the course does not exist', async () => {
      const admin = await createAdmin(testApp);

      await testApp
        .http()
        .patch('/api/admin/courses/non-existent-course/suspension')
        .set(admin.auth)
        .send({ suspended: true })
        .expect(404);
    });
  });

  describe('report moderation', () => {
    it('should return 401 without authentication on all report endpoints', async () => {
      await testApp.http().get('/api/admin/reports').expect(401);

      await testApp.http().get('/api/admin/reports/non-existent-report').expect(401);

      await testApp
        .http()
        .patch('/api/admin/reports/non-existent-report/status')
        .send({
          status: ReportStatus.DISMISSED,
          reason: 'Not a violation',
        })
        .expect(401);
    });

    it.each([
      {
        role: 'student',
        auth: () => student.auth,
      },
      {
        role: 'lecturer',
        auth: () => lecturer.auth,
      },
    ])('should return 403 for a non-admin $role on every report endpoint', async ({ auth }) => {
      await testApp.http().get('/api/admin/reports').set(auth()).expect(403);

      await testApp.http().get('/api/admin/reports/non-existent-report').set(auth()).expect(403);

      await testApp
        .http()
        .patch('/api/admin/reports/non-existent-report/status')
        .set(auth())
        .send({
          status: ReportStatus.DISMISSED,
          reason: 'Not a violation',
        })
        .expect(403);
    });

    it('should filter reports, review a pending report, and persist its audit history', async () => {
      const admin = await createAdmin(testApp);

      const pendingReport = await testApp.prisma.report.create({
        data: {
          reporterId: student.id,
          targetType: ReportTargetType.USER,
          targetId: lecturer.id,
          reason: 'Harassment',
          description: 'Repeated inappropriate behavior',
          status: ReportStatus.PENDING,
        },
      });

      await testApp.prisma.report.create({
        data: {
          reporterId: student.id,
          targetType: ReportTargetType.USER,
          targetId: lecturer.id,
          reason: 'Already reviewed',
          status: ReportStatus.DISMISSED,
          reviewedAt: new Date(),
        },
      });

      // Filter by both status and target type.
      const listResponse = await testApp
        .http()
        .get('/api/admin/reports')
        .set(admin.auth)
        .query({
          status: ReportStatus.PENDING,
          targetType: ReportTargetType.USER,
          page: 1,
          pageSize: 20,
        })
        .expect(200);

      expect(listResponse.body).toMatchObject({
        page: 1,
        pageSize: 20,
        total: 1,
      });

      expect(listResponse.body.items).toHaveLength(1);

      expect(listResponse.body.items[0]).toMatchObject({
        id: pendingReport.id,
        status: ReportStatus.PENDING,
        reason: 'Harassment',
        description: 'Repeated inappropriate behavior',
        reporter: {
          id: student.id,
        },
        target: {
          type: ReportTargetType.USER,
          id: lecturer.id,
          available: true,
        },
      });

      // Review the pending report.
      const reviewResponse = await testApp
        .http()
        .patch(`/api/admin/reports/${pendingReport.id}/status`)
        .set(admin.auth)
        .send({
          status: ReportStatus.DISMISSED,
          reason: 'The report does not violate platform policy',
        })
        .expect(200);

      expect(reviewResponse.body).toMatchObject({
        id: pendingReport.id,
        status: ReportStatus.DISMISSED,
        reason: 'Harassment',
      });

      const persistedReport = await testApp.prisma.report.findUniqueOrThrow({
        where: { id: pendingReport.id },
      });

      expect(persistedReport.status).toBe(ReportStatus.DISMISSED);
      expect(persistedReport.reviewedAt).toBeInstanceOf(Date);

      // Verify audit entry and recorded review reason.
      const auditEntry = await testApp.prisma.auditEntry.findFirst({
        where: {
          actorId: admin.id,
          action: AuditAction.REPORT_REVIEWED,
          entityType: AuditEntityType.REPORT,
          entityId: pendingReport.id,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      expect(auditEntry).not.toBeNull();
      expect(auditEntry?.metadata).toMatchObject({
        status: ReportStatus.DISMISSED,
        reason: 'The report does not violate platform policy',
      });

      // The report cannot be reviewed a second time.
      await testApp
        .http()
        .patch(`/api/admin/reports/${pendingReport.id}/status`)
        .set(admin.auth)
        .send({
          status: ReportStatus.ACTION_TAKEN,
          reason: 'Another review attempt',
        })
        .expect(409);

      // The detail view contains the synthesized RECEIVED event and the
      // persisted DISMISSED audit event.
      const detailResponse = await testApp
        .http()
        .get(`/api/admin/reports/${pendingReport.id}`)
        .set(admin.auth)
        .expect(200);

      expect(detailResponse.body.history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: `received:${pendingReport.id}`,
            action: 'RECEIVED',
            actor: {
              id: student.id,
              name: expect.any(String),
            },
            reasonRecorded: 'Harassment',
          }),
          expect.objectContaining({
            id: auditEntry?.id,
            action: 'DISMISSED',
            actor: {
              id: admin.id,
              name: expect.any(String),
            },
            reasonRecorded: 'The report does not violate platform policy',
          }),
        ]),
      );

      // USER reports do not return MESSAGE context.
      expect(detailResponse.body).not.toHaveProperty('message');
    });

    it('should return 404 for a report that does not exist', async () => {
      const admin = await createAdmin(testApp);

      await testApp
        .http()
        .get('/api/admin/reports/non-existent-report')
        .set(admin.auth)
        .expect(404);

      await testApp
        .http()
        .patch('/api/admin/reports/non-existent-report/status')
        .set(admin.auth)
        .send({
          status: ReportStatus.DISMISSED,
          reason: 'Not a violation',
        })
        .expect(404);
    });
  });
  // ---------------------------------------------------------------------------
  // Platform statistics
  // ---------------------------------------------------------------------------

  describe('GET /api/admin/stats', () => {
    it('should return 401 when the caller is unauthenticated', async () => {
      await testApp.http().get('/api/admin/stats').expect(401);
    });

    it.each([
      {
        role: 'student',
        auth: () => student.auth,
      },
      {
        role: 'lecturer',
        auth: () => lecturer.auth,
      },
    ])('should return 403 for a non-admin $role', async ({ auth }) => {
      await testApp.http().get('/api/admin/stats').set(auth()).expect(403);
    });

    it('should return correct platform statistics for seeded data', async () => {
      const admin = await createAdmin(testApp);

      // -----------------------------------------------------------------------
      // Users
      // -----------------------------------------------------------------------

      const suspendedStudent = await registerUser(testApp, 'STUDENT');

      await testApp.prisma.user.update({
        where: {
          id: suspendedStudent.id,
        },
        data: {
          status: AccountStatus.SUSPENDED,
        },
      });

      // -----------------------------------------------------------------------
      // Courses
      // -----------------------------------------------------------------------

      const quizCourse = await createCourse(testApp, {
        lecturerId: lecturer.id,
        title: 'Statistics published quiz course',
        status: CourseStatus.PUBLISHED,
        blocks: [
          {
            type: BlockType.QUIZ,
            title: 'Quiz One',
          },
          {
            type: BlockType.QUIZ,
            title: 'Quiz Two',
          },
        ],
      });

      const draftCourse = await createCourse(testApp, {
        lecturerId: lecturer.id,
        title: 'Statistics draft course',
        status: CourseStatus.DRAFT,
      });

      const suspendedCourse = await createCourse(testApp, {
        lecturerId: lecturer.id,
        title: 'Statistics suspended course',
        status: CourseStatus.PUBLISHED,
        isSuspended: true,
      });

      // -----------------------------------------------------------------------
      // Enrollments
      // -----------------------------------------------------------------------

      const activeEnrollment = await enroll(
        testApp,
        student.id,
        quizCourse.id,
        EnrollmentStatus.ACTIVE,
      );

      await enroll(testApp, student.id, draftCourse.id, EnrollmentStatus.COMPLETED);

      await enroll(testApp, student.id, suspendedCourse.id, EnrollmentStatus.LEFT);

      // -----------------------------------------------------------------------
      // Quiz questions
      // -----------------------------------------------------------------------

      const quizOneId = quizCourse.blocks[0].id;
      const quizTwoId = quizCourse.blocks[1].id;

      await testApp.prisma.quizQuestion.createMany({
        data: [
          {
            courseBlockId: quizOneId,
            type: QuestionType.SINGLE_CHOICE,
            text: 'Question one',
            points: 4,
            position: 0,
          },
          {
            courseBlockId: quizOneId,
            type: QuestionType.SINGLE_CHOICE,
            text: 'Question two',
            points: 6,
            position: 1,
          },
          {
            courseBlockId: quizTwoId,
            type: QuestionType.SINGLE_CHOICE,
            text: 'Question three',
            points: 20,
            position: 0,
          },
        ],
      });

      // -----------------------------------------------------------------------
      // Graded quiz attempts
      // -----------------------------------------------------------------------

      await testApp.prisma.quizAttempt.createMany({
        data: [
          {
            enrollmentId: activeEnrollment.id,
            courseBlockId: quizOneId,
            attemptNumber: 1,
            status: QuizAttemptStatus.GRADED,
            score: 8,
          },
          {
            enrollmentId: activeEnrollment.id,
            courseBlockId: quizTwoId,
            attemptNumber: 1,
            status: QuizAttemptStatus.GRADED,
            score: 15,
          },
        ],
      });

      // -----------------------------------------------------------------------
      // Request statistics
      // -----------------------------------------------------------------------

      const response = await testApp.http().get('/api/admin/stats').set(admin.auth).expect(200);

      expect(response.body).toMatchObject({
        users: {
          total: 4,
          students: 2,
          lecturers: 1,
          admins: 1,
          suspended: 1,
        },
        courses: {
          total: 3,
          published: 2,
          draft: 1,
          suspended: 1,
        },
        enrollments: {
          total: 3,
          active: 1,
          completed: 1,
          left: 1,
        },
        completionRate: 0.5,
      });

      expect(response.body.averageQuizScore).toBeCloseTo(0.775, 10);

      expect(typeof response.body.generatedAt).toBe('string');
      expect(Number.isNaN(Date.parse(response.body.generatedAt))).toBe(false);
    });

    it('should return zero completion rate and null average score when there are no enrollments or graded attempts', async () => {
      const admin = await createAdmin(testApp);

      await createCourse(testApp, {
        lecturerId: lecturer.id,
        title: 'Statistics empty course',
        status: CourseStatus.DRAFT,
      });

      const response = await testApp.http().get('/api/admin/stats').set(admin.auth).expect(200);

      expect(response.body.completionRate).toBe(0);
      expect(response.body.averageQuizScore).toBeNull();

      expect(response.body.enrollments).toEqual({
        total: 0,
        active: 0,
        completed: 0,
        left: 0,
      });
    });
  });
});
