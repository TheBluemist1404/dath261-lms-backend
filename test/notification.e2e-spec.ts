// test/notification.e2e-spec.ts
import {
  BlockType,
  CourseStatus,
  EnrollmentStatus,
  NotificationType,
  QuizAttemptStatus,
  QuizScoringMode,
} from '../src/generated/prisma/enums.js';
import { NOTIFICATION_TARGET_TYPE } from '../src/modules/notification/notification.constants.js';
import { createTestApp, resetDatabase, type TestApp } from './support/test-app.js';
import { registerUser, type TestUser } from './support/users.js';

describe('Notification (e2e)', () => {
  let testApp: TestApp;
  let lecturerA: TestUser;
  //let lecturerB: TestUser;
  let student1: TestUser;
  let student2: TestUser;
  let studentLeft: TestUser;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  beforeEach(async () => {
    await resetDatabase(testApp.prisma);

    lecturerA = await registerUser(testApp, 'LECTURER');
    //lecturerB = await registerUser(testApp, 'LECTURER');
    student1 = await registerUser(testApp, 'STUDENT');
    student2 = await registerUser(testApp, 'STUDENT');
    studentLeft = await registerUser(testApp, 'STUDENT');
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function createCourse(overrides: {
    lecturerId: string;
    title?: string;
    status?: CourseStatus;
    isSuspended?: boolean;
  }) {
    return testApp.prisma.course.create({
      data: {
        title: overrides.title ?? 'Course',
        lecturerId: overrides.lecturerId,
        ...(overrides.status !== undefined && { status: overrides.status }),
        ...(overrides.isSuspended !== undefined && { isSuspended: overrides.isSuspended }),
      },
    });
  }

  function enroll(userId: string, courseId: string, status: EnrollmentStatus) {
    return testApp.prisma.enrollment.create({
      data: { userId, courseId, status },
    });
  }

  function createNotification(overrides: {
    userId: string;
    title?: string;
    message?: string;
    targetType?: string | null;
    targetId?: string | null;
    readAt?: Date | null;
    createdAt?: Date;
  }) {
    return testApp.prisma.notification.create({
      data: {
        userId: overrides.userId,
        type: NotificationType.NEW_CONTENT,
        title: overrides.title ?? 'Title',
        message: overrides.message ?? 'Message',
        ...(overrides.targetType !== undefined && { targetType: overrides.targetType }),
        ...(overrides.targetId !== undefined && { targetId: overrides.targetId }),
        ...(overrides.readAt !== undefined && { readAt: overrides.readAt }),
        ...(overrides.createdAt !== undefined && { createdAt: overrides.createdAt }),
      },
    });
  }

  async function createQuizBlock(courseId: string) {
    return testApp.prisma.courseBlock.create({
      data: {
        courseId,
        type: BlockType.QUIZ,
        title: 'Quiz 1',
        position: 0,
        quizConfig: {
          create: {
            maxAttempts: 3,
            scoringMode: QuizScoringMode.HIGHEST,
          },
        },
      },
    });
  }

  async function createGradedAttempt(enrollmentId: string, blockId: string) {
    return testApp.prisma.quizAttempt.create({
      data: {
        enrollmentId,
        courseBlockId: blockId,
        attemptNumber: 1,
        status: QuizAttemptStatus.SUBMITTED,
        answers: [],
        score: 80,
        startedAt: new Date(),
        submittedAt: new Date(),
        gradedAt: new Date(),
        isLate: false,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------
  describe('auth', () => {
    it('should return 401 on GET /users/me/notifications without token', async () => {
      await testApp.http().get('/api/users/me/notifications').expect(401);
    });

    it('should return 401 on PATCH /users/me/notifications/read-all without token', async () => {
      await testApp.http().patch('/api/users/me/notifications/read-all').expect(401);
    });

    it('should return 401 on PATCH /users/me/notifications/:id/read without token', async () => {
      await testApp.http().patch('/api/users/me/notifications/some-id/read').expect(401);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /users/me/notifications
  // ---------------------------------------------------------------------------
  describe('GET /api/users/me/notifications', () => {
    it('should return only the caller own notifications, newest first', async () => {
      const course = await createCourse({ lecturerId: lecturerA.id });

      const mine1 = await createNotification({
        userId: student1.id,
        title: 'old',
        targetType: NOTIFICATION_TARGET_TYPE.COURSE,
        targetId: course.id,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      const mine2 = await createNotification({
        userId: student1.id,
        title: 'new',
        targetType: NOTIFICATION_TARGET_TYPE.COURSE,
        targetId: course.id,
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
      });
      await createNotification({
        userId: student2.id,
        title: 'other-user',
        targetType: NOTIFICATION_TARGET_TYPE.COURSE,
        targetId: course.id,
      });

      const res = await testApp
        .http()
        .get('/api/users/me/notifications')
        .set(student1.auth)
        .expect(200);

      expect(res.body.data.map((n: { id: string }) => n.id)).toEqual([mine2.id, mine1.id]);
      expect(res.body.meta.total).toBe(2);
      expect(res.body.meta.unreadCount).toBe(2);
      // Other user's notification must not leak.
      expect(res.body.data.every((n: { userId?: string }) => n.userId === undefined)).toBe(true);
    });

    it('should filter unread=true but keep unreadCount global', async () => {
      const course = await createCourse({ lecturerId: lecturerA.id });

      await createNotification({
        userId: student1.id,
        title: 'read',
        targetType: NOTIFICATION_TARGET_TYPE.COURSE,
        targetId: course.id,
        readAt: new Date(),
      });
      await createNotification({
        userId: student1.id,
        title: 'unread',
        targetType: NOTIFICATION_TARGET_TYPE.COURSE,
        targetId: course.id,
      });

      const res = await testApp
        .http()
        .get('/api/users/me/notifications')
        .query({ unread: 'true' })
        .set(student1.auth)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].title).toBe('unread');
      expect(res.body.meta.unreadCount).toBe(1);
    });

    it('should paginate with default page/limit', async () => {
      const course = await createCourse({ lecturerId: lecturerA.id });

      for (let i = 0; i < 5; i++) {
        await createNotification({
          userId: student1.id,
          title: `n-${i}`,
          targetType: NOTIFICATION_TARGET_TYPE.COURSE,
          targetId: course.id,
          createdAt: new Date(`2026-01-0${i + 1}T00:00:00.000Z`),
        });
      }

      const page1 = await testApp
        .http()
        .get('/api/users/me/notifications')
        .query({ page: 1, limit: 2 })
        .set(student1.auth)
        .expect(200);

      expect(page1.body.data.map((n: { title: string }) => n.title)).toEqual(['n-4', 'n-3']);
      expect(page1.body.meta).toMatchObject({
        total: 5,
        page: 1,
        limit: 2,
        totalPages: 3,
        hasNextPage: true,
        hasPrevPage: false,
        unreadCount: 5,
      });
    });

    it('should return an empty list when the user has no notifications', async () => {
      const res = await testApp
        .http()
        .get('/api/users/me/notifications')
        .set(student1.auth)
        .expect(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta.total).toBe(0);
      expect(res.body.meta.unreadCount).toBe(0);
    });

    it('should derive courseId for COURSE targets', async () => {
      const course = await createCourse({ lecturerId: lecturerA.id });
      await createNotification({
        userId: student1.id,
        targetType: NOTIFICATION_TARGET_TYPE.COURSE,
        targetId: course.id,
      });

      const res = await testApp
        .http()
        .get('/api/users/me/notifications')
        .set(student1.auth)
        .expect(200);
      expect(res.body.data[0].courseId).toBe(course.id);
    });

    it('should derive courseId for COURSE_BLOCK targets via the block', async () => {
      const course = await createCourse({ lecturerId: lecturerA.id });
      const block = await testApp.prisma.courseBlock.create({
        data: { courseId: course.id, type: BlockType.TEXT, title: 'B', position: 0 },
      });
      await createNotification({
        userId: student1.id,
        targetType: NOTIFICATION_TARGET_TYPE.COURSE_BLOCK,
        targetId: block.id,
      });

      const res = await testApp
        .http()
        .get('/api/users/me/notifications')
        .set(student1.auth)
        .expect(200);
      expect(res.body.data[0].courseId).toBe(course.id);
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /users/me/notifications/:id/read
  // ---------------------------------------------------------------------------
  describe('PATCH /api/users/me/notifications/:notificationId/read', () => {
    it('should set readAt on own notification and return the DTO', async () => {
      const course = await createCourse({ lecturerId: lecturerA.id });
      const notif = await createNotification({
        userId: student1.id,
        targetType: NOTIFICATION_TARGET_TYPE.COURSE,
        targetId: course.id,
      });

      const res = await testApp
        .http()
        .patch(`/api/users/me/notifications/${notif.id}/read`)
        .set(student1.auth)
        .expect(200);

      expect(res.body.id).toBe(notif.id);
      expect(res.body.readAt).not.toBeNull();

      const persisted = await testApp.prisma.notification.findUniqueOrThrow({
        where: { id: notif.id },
      });
      expect(persisted.readAt).not.toBeNull();
    });

    it('should return 404 for another user\u2019s notification', async () => {
      const course = await createCourse({ lecturerId: lecturerA.id });
      const notif = await createNotification({
        userId: student2.id,
        targetType: NOTIFICATION_TARGET_TYPE.COURSE,
        targetId: course.id,
      });

      await testApp
        .http()
        .patch(`/api/users/me/notifications/${notif.id}/read`)
        .set(student1.auth)
        .expect(404);

      const persisted = await testApp.prisma.notification.findUniqueOrThrow({
        where: { id: notif.id },
      });
      expect(persisted.readAt).toBeNull();
    });

    it('should return 404 for a non-existent notification', async () => {
      await testApp
        .http()
        .patch('/api/users/me/notifications/does-not-exist/read')
        .set(student1.auth)
        .expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /users/me/notifications/read-all
  // ---------------------------------------------------------------------------
  describe('PATCH /api/users/me/notifications/read-all', () => {
    it('should mark only the caller unread notifications and return count', async () => {
      const course = await createCourse({ lecturerId: lecturerA.id });

      await createNotification({
        userId: student1.id,
        targetType: NOTIFICATION_TARGET_TYPE.COURSE,
        targetId: course.id,
      });
      await createNotification({
        userId: student1.id,
        targetType: NOTIFICATION_TARGET_TYPE.COURSE,
        targetId: course.id,
      });
      await createNotification({
        userId: student1.id,
        targetType: NOTIFICATION_TARGET_TYPE.COURSE,
        targetId: course.id,
        readAt: new Date(),
      });
      await createNotification({
        userId: student2.id,
        targetType: NOTIFICATION_TARGET_TYPE.COURSE,
        targetId: course.id,
      });

      const res = await testApp
        .http()
        .patch('/api/users/me/notifications/read-all')
        .set(student1.auth)
        .expect(200);

      expect(res.body).toEqual({ updated: 2 });

      const student1Unread = await testApp.prisma.notification.count({
        where: { userId: student1.id, readAt: null },
      });
      expect(student1Unread).toBe(0);

      const student2Unread = await testApp.prisma.notification.count({
        where: { userId: student2.id, readAt: null },
      });
      expect(student2Unread).toBe(1);
    });

    it('should return updated: 0 when nothing is unread', async () => {
      const res = await testApp
        .http()
        .patch('/api/users/me/notifications/read-all')
        .set(student1.auth)
        .expect(200);
      expect(res.body).toEqual({ updated: 0 });
    });
  });

  // ---------------------------------------------------------------------------
  // Trigger — NEW_CONTENT on course publish (re-publish)
  // ---------------------------------------------------------------------------
  describe('trigger: course publish -> NEW_CONTENT', () => {
    it('should notify ACTIVE enrollees with COURSE target and skip LEFT', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.DRAFT,
      });
      await testApp.prisma.courseBlock.create({
        data: { courseId: course.id, type: BlockType.TEXT, title: 'B', position: 0 },
      });
      await enroll(student1.id, course.id, EnrollmentStatus.ACTIVE);
      await enroll(student2.id, course.id, EnrollmentStatus.ACTIVE);
      await enroll(studentLeft.id, course.id, EnrollmentStatus.LEFT);

      await testApp
        .http()
        .patch(`/api/courses/${course.id}/status`)
        .set(lecturerA.auth)
        .send({ status: CourseStatus.PUBLISHED })
        .expect(200);

      const notifs = await testApp.prisma.notification.findMany({
        where: { targetType: NOTIFICATION_TARGET_TYPE.COURSE, targetId: course.id },
        orderBy: { createdAt: 'asc' },
      });

      expect(notifs).toHaveLength(2);
      expect(notifs.map((n) => n.userId).sort()).toEqual([student1.id, student2.id].sort());
      expect(notifs.every((n) => n.type === NotificationType.NEW_CONTENT)).toBe(true);
    });

    it('should not notify anyone when the course has no enrollees', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.DRAFT,
      });
      await testApp.prisma.courseBlock.create({
        data: { courseId: course.id, type: BlockType.TEXT, title: 'B', position: 0 },
      });

      await testApp
        .http()
        .patch(`/api/courses/${course.id}/status`)
        .set(lecturerA.auth)
        .send({ status: CourseStatus.PUBLISHED })
        .expect(200);

      const count = await testApp.prisma.notification.count({
        where: { targetType: NOTIFICATION_TARGET_TYPE.COURSE, targetId: course.id },
      });
      expect(count).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Trigger — NEW_CONTENT on block added
  // ---------------------------------------------------------------------------
  describe('trigger: block added -> NEW_CONTENT', () => {
    it('should notify ACTIVE enrollees for a block in a PUBLISHED course', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.PUBLISHED,
      });
      await enroll(student1.id, course.id, EnrollmentStatus.ACTIVE);
      await enroll(studentLeft.id, course.id, EnrollmentStatus.LEFT);

      const res = await testApp
        .http()
        .post(`/api/courses/${course.id}/blocks`)
        .set(lecturerA.auth)
        .send({ type: BlockType.TEXT, title: 'New lesson' })
        .expect(201);

      const notifs = await testApp.prisma.notification.findMany({
        where: { targetType: NOTIFICATION_TARGET_TYPE.COURSE_BLOCK, targetId: res.body.id },
      });
      expect(notifs).toHaveLength(1);
      expect(notifs[0].userId).toBe(student1.id);
      expect(notifs[0].type).toBe(NotificationType.NEW_CONTENT);
    });

    it('should NOT notify when the course is DRAFT', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.DRAFT,
      });
      await enroll(student1.id, course.id, EnrollmentStatus.ACTIVE);

      const res = await testApp
        .http()
        .post(`/api/courses/${course.id}/blocks`)
        .set(lecturerA.auth)
        .send({ type: BlockType.TEXT, title: 'Draft lesson' })
        .expect(201);

      const count = await testApp.prisma.notification.count({
        where: { targetType: NOTIFICATION_TARGET_TYPE.COURSE_BLOCK, targetId: res.body.id },
      });
      expect(count).toBe(0);
    });

    it('should NOT notify when the course is suspended', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.PUBLISHED,
        isSuspended: true,
      });
      await enroll(student1.id, course.id, EnrollmentStatus.ACTIVE);

      const res = await testApp
        .http()
        .post(`/api/courses/${course.id}/blocks`)
        .set(lecturerA.auth)
        .send({ type: BlockType.TEXT, title: 'Suspended lesson' })
        .expect(201);

      const count = await testApp.prisma.notification.count({
        where: { targetType: NOTIFICATION_TARGET_TYPE.COURSE_BLOCK, targetId: res.body.id },
      });
      expect(count).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Trigger — RESULT_RELEASED
  // ---------------------------------------------------------------------------
  describe('trigger: release-results -> RESULT_RELEASED', () => {
    it('should notify only students with a graded attempt (one notif per student)', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.PUBLISHED,
      });
      const quiz = await createQuizBlock(course.id);

      const e1 = await enroll(student1.id, course.id, EnrollmentStatus.ACTIVE);
      await enroll(student2.id, course.id, EnrollmentStatus.ACTIVE);
      const eLeft = await enroll(studentLeft.id, course.id, EnrollmentStatus.LEFT);

      // student1 has a graded attempt
      await createGradedAttempt(e1.id, quiz.id);
      // studentLeft has a graded attempt but is LEFT → should be skipped
      await createGradedAttempt(eLeft.id, quiz.id);

      await testApp
        .http()
        .patch(`/api/courses/${course.id}/quizzes/${quiz.id}/release-results`)
        .set(lecturerA.auth)
        .expect(200);

      const notifs = await testApp.prisma.notification.findMany({
        where: { type: NotificationType.RESULT_RELEASED, targetId: quiz.id },
      });

      expect(notifs).toHaveLength(1);
      expect(notifs[0].userId).toBe(student1.id);
      expect(notifs[0].targetType).toBe(NOTIFICATION_TARGET_TYPE.COURSE_BLOCK);
    });

    it('should be idempotent: releasing twice does not create duplicate notifications', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.PUBLISHED,
      });
      const quiz = await createQuizBlock(course.id);
      const e1 = await enroll(student1.id, course.id, EnrollmentStatus.ACTIVE);
      await createGradedAttempt(e1.id, quiz.id);

      await testApp
        .http()
        .patch(`/api/courses/${course.id}/quizzes/${quiz.id}/release-results`)
        .set(lecturerA.auth)
        .expect(200);

      await testApp
        .http()
        .patch(`/api/courses/${course.id}/quizzes/${quiz.id}/release-results`)
        .set(lecturerA.auth)
        .expect(200);

      const count = await testApp.prisma.notification.count({
        where: { type: NotificationType.RESULT_RELEASED, targetId: quiz.id },
      });
      expect(count).toBe(1);
    });
  });
});
