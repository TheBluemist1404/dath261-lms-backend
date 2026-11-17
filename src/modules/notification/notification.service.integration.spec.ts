// notification.service.integration.spec.ts
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BlockType,
  CourseStatus,
  EnrollmentStatus,
  NotificationType,
  QuizAttemptStatus,
  QuizScoringMode,
  UserRole,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { NOTIFICATION_TARGET_TYPE } from './notification.constants.js';
import { NotificationService } from './notification.service.js';

const PREFIX = 'notif-integration-';

describe('NotificationService - integration', () => {
  let service: NotificationService;
  let prisma: PrismaService;
  let moduleRef: TestingModule;

  let lecturer: { id: string };
  let student1: { id: string };
  let student2: { id: string };
  let studentLeft: { id: string };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env',
        }),
      ],
      providers: [PrismaService, NotificationService],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(NotificationService);

    await prisma.$connect();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await moduleRef.close();
  });

  async function cleanup() {
    const userEmailStartsWith = { email: { startsWith: PREFIX } };

    await prisma.auditEntry.deleteMany({
      where: { actor: userEmailStartsWith },
    });
    await prisma.notification.deleteMany({
      where: { user: userEmailStartsWith },
    });
    await prisma.quizAttempt.deleteMany({
      where: { enrollment: { user: userEmailStartsWith } },
    });
    await prisma.enrollment.deleteMany({
      where: {
        OR: [{ user: userEmailStartsWith }, { course: { lecturer: userEmailStartsWith } }],
      },
    });
    await prisma.courseBlock.deleteMany({
      where: { course: { lecturer: userEmailStartsWith } },
    });
    await prisma.course.deleteMany({
      where: { lecturer: userEmailStartsWith },
    });
    await prisma.user.deleteMany({ where: userEmailStartsWith });
  }

  beforeEach(async () => {
    await cleanup();

    lecturer = await prisma.user.create({
      data: {
        email: `${PREFIX}lecturer@example.com`,
        passwordHash: 'hash',
        role: UserRole.LECTURER,
      },
    });
    student1 = await prisma.user.create({
      data: {
        email: `${PREFIX}student1@example.com`,
        passwordHash: 'hash',
        role: UserRole.STUDENT,
      },
    });
    student2 = await prisma.user.create({
      data: {
        email: `${PREFIX}student2@example.com`,
        passwordHash: 'hash',
        role: UserRole.STUDENT,
      },
    });
    studentLeft = await prisma.user.create({
      data: {
        email: `${PREFIX}student-left@example.com`,
        passwordHash: 'hash',
        role: UserRole.STUDENT,
      },
    });
  });

  async function createCourse(
    overrides: { status?: CourseStatus; isSuspended?: boolean; title?: string } = {},
  ) {
    return prisma.course.create({
      data: {
        title: overrides.title ?? 'Course',
        lecturerId: lecturer.id,
        ...(overrides.status !== undefined && { status: overrides.status }),
        ...(overrides.isSuspended !== undefined && { isSuspended: overrides.isSuspended }),
      },
    });
  }

  async function enroll(userId: string, courseId: string, status: EnrollmentStatus) {
    return prisma.enrollment.create({
      data: { userId, courseId, status },
    });
  }

  // ---------------------------------------------------------------------------
  // notifyNewContentOnPublish
  // ---------------------------------------------------------------------------
  describe('notifyNewContentOnPublish', () => {
    it('should create one notification per ACTIVE enrollee and skip LEFT', async () => {
      const course = await createCourse({ status: CourseStatus.PUBLISHED });
      await enroll(student1.id, course.id, EnrollmentStatus.ACTIVE);
      await enroll(student2.id, course.id, EnrollmentStatus.ACTIVE);
      await enroll(studentLeft.id, course.id, EnrollmentStatus.LEFT);

      const result = await prisma.$transaction((tx) =>
        service.notifyNewContentOnPublish(tx, { id: course.id, title: course.title }),
      );

      expect(result).toEqual({ created: 2 });

      const notifs = await prisma.notification.findMany({
        where: { targetType: NOTIFICATION_TARGET_TYPE.COURSE, targetId: course.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(notifs).toHaveLength(2);
      expect(notifs.map((n) => n.userId).sort()).toEqual([student1.id, student2.id].sort());
      expect(notifs.every((n) => n.type === NotificationType.NEW_CONTENT)).toBe(true);
    });

    it('should create nothing when the course has no enrollees', async () => {
      const course = await createCourse({ status: CourseStatus.PUBLISHED });

      const result = await prisma.$transaction((tx) =>
        service.notifyNewContentOnPublish(tx, { id: course.id, title: course.title }),
      );

      expect(result).toEqual({ created: 0 });
      const count = await prisma.notification.count({
        where: { targetType: NOTIFICATION_TARGET_TYPE.COURSE, targetId: course.id },
      });
      expect(count).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // notifyNewContentOnBlockAdded
  // ---------------------------------------------------------------------------
  describe('notifyNewContentOnBlockAdded', () => {
    it('should notify ACTIVE enrollees with COURSE_BLOCK target', async () => {
      const course = await createCourse({ status: CourseStatus.PUBLISHED });
      const block = await prisma.courseBlock.create({
        data: { courseId: course.id, type: BlockType.TEXT, title: 'Lesson', position: 0 },
      });
      await enroll(student1.id, course.id, EnrollmentStatus.ACTIVE);
      await enroll(studentLeft.id, course.id, EnrollmentStatus.LEFT);

      const result = await prisma.$transaction((tx) =>
        service.notifyNewContentOnBlockAdded(
          tx,
          { id: course.id, title: course.title },
          { id: block.id, title: block.title },
        ),
      );

      expect(result).toEqual({ created: 1 });
      const notifs = await prisma.notification.findMany({
        where: { targetType: NOTIFICATION_TARGET_TYPE.COURSE_BLOCK, targetId: block.id },
      });
      expect(notifs).toHaveLength(1);
      expect(notifs[0].userId).toBe(student1.id);
    });
  });

  // ---------------------------------------------------------------------------
  // notifyResultReleased
  // ---------------------------------------------------------------------------
  describe('notifyResultReleased', () => {
    async function setupQuiz(courseId: string) {
      return prisma.courseBlock.create({
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

    it('should notify only students with a graded attempt (one notif per student)', async () => {
      const course = await createCourse({ status: CourseStatus.PUBLISHED });
      const block = await setupQuiz(course.id);
      const e1 = await enroll(student1.id, course.id, EnrollmentStatus.ACTIVE);
      /*const e2 = await enroll(student2.id, course.id, EnrollmentStatus.ACTIVE);*/
      const eLeft = await enroll(studentLeft.id, course.id, EnrollmentStatus.LEFT);

      // student1: two graded attempts (should collapse to one notification)
      await prisma.quizAttempt.create({
        data: {
          enrollmentId: e1.id,
          courseBlockId: block.id,
          attemptNumber: 1,
          status: QuizAttemptStatus.SUBMITTED,
          answers: [],
          score: 8,
          startedAt: new Date(),
          submittedAt: new Date(),
          gradedAt: new Date(),
          isLate: false,
        },
      });
      await prisma.quizAttempt.create({
        data: {
          enrollmentId: e1.id,
          courseBlockId: block.id,
          attemptNumber: 2,
          status: QuizAttemptStatus.GRADED,
          answers: [],
          score: 9,
          startedAt: new Date(),
          submittedAt: new Date(),
          gradedAt: new Date(),
          isLate: false,
        },
      });

      // student2: no attempt → no notification
      // studentLeft: graded attempt but LEFT → no notification
      await prisma.quizAttempt.create({
        data: {
          enrollmentId: eLeft.id,
          courseBlockId: block.id,
          attemptNumber: 1,
          status: QuizAttemptStatus.SUBMITTED,
          answers: [],
          score: 5,
          startedAt: new Date(),
          submittedAt: new Date(),
          gradedAt: new Date(),
          isLate: false,
        },
      });

      const result = await prisma.$transaction((tx) =>
        service.notifyResultReleased(
          tx,
          { id: course.id, title: course.title },
          { id: block.id, title: block.title },
        ),
      );

      expect(result).toEqual({ created: 1 });
      const notifs = await prisma.notification.findMany({
        where: { type: NotificationType.RESULT_RELEASED, targetId: block.id },
      });
      expect(notifs).toHaveLength(1);
      expect(notifs[0].userId).toBe(student1.id);
    });

    it('should create nothing when there are no graded attempts', async () => {
      const course = await createCourse({ status: CourseStatus.PUBLISHED });
      const block = await setupQuiz(course.id);

      const result = await prisma.$transaction((tx) =>
        service.notifyResultReleased(
          tx,
          { id: course.id, title: course.title },
          { id: block.id, title: block.title },
        ),
      );

      expect(result).toEqual({ created: 0 });
    });
  });

  // ---------------------------------------------------------------------------
  // listMyNotifications
  // ---------------------------------------------------------------------------
  describe('listMyNotifications', () => {
    it('should return notifications for the user, newest first, with unreadCount', async () => {
      const course = await createCourse({ status: CourseStatus.PUBLISHED });
      await prisma.notification.createMany({
        data: [
          {
            userId: student1.id,
            type: NotificationType.NEW_CONTENT,
            title: 'n1',
            message: 'm1',
            targetType: NOTIFICATION_TARGET_TYPE.COURSE,
            targetId: course.id,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          },
          {
            userId: student1.id,
            type: NotificationType.NEW_CONTENT,
            title: 'n2',
            message: 'm2',
            targetType: NOTIFICATION_TARGET_TYPE.COURSE,
            targetId: course.id,
            readAt: new Date('2026-01-02T00:00:00.000Z'),
            createdAt: new Date('2026-01-02T00:00:00.000Z'),
          },
        ],
      });

      const result = await service.listMyNotifications(student1.id, {});

      expect(result.data.map((d) => d.title)).toEqual(['n2', 'n1']);
      expect(result.meta.unreadCount).toBe(1);
      expect(result.data[0].courseId).toBe(course.id);
    });

    it('should filter unread=true', async () => {
      const course = await createCourse({ status: CourseStatus.PUBLISHED });
      await prisma.notification.createMany({
        data: [
          {
            userId: student1.id,
            type: NotificationType.NEW_CONTENT,
            title: 'read',
            message: 'm',
            targetType: NOTIFICATION_TARGET_TYPE.COURSE,
            targetId: course.id,
            readAt: new Date(),
          },
          {
            userId: student1.id,
            type: NotificationType.NEW_CONTENT,
            title: 'unread',
            message: 'm',
            targetType: NOTIFICATION_TARGET_TYPE.COURSE,
            targetId: course.id,
          },
        ],
      });

      const result = await service.listMyNotifications(student1.id, { unread: 'true' });

      expect(result.data.map((d) => d.title)).toEqual(['unread']);
      // unreadCount is still the global unread count.
      expect(result.meta.unreadCount).toBe(1);
    });

    it('should not return other users\u2019 notifications', async () => {
      const course = await createCourse({ status: CourseStatus.PUBLISHED });
      await prisma.notification.create({
        data: {
          userId: student2.id,
          type: NotificationType.NEW_CONTENT,
          title: 'other',
          message: 'm',
          targetType: NOTIFICATION_TARGET_TYPE.COURSE,
          targetId: course.id,
        },
      });

      const result = await service.listMyNotifications(student1.id, {});
      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });

    it('should derive courseId from a COURSE_BLOCK target via the block', async () => {
      const course = await createCourse({ status: CourseStatus.PUBLISHED });
      const block = await prisma.courseBlock.create({
        data: { courseId: course.id, type: BlockType.TEXT, title: 'B', position: 0 },
      });
      await prisma.notification.create({
        data: {
          userId: student1.id,
          type: NotificationType.NEW_CONTENT,
          title: 'n',
          message: 'm',
          targetType: NOTIFICATION_TARGET_TYPE.COURSE_BLOCK,
          targetId: block.id,
        },
      });

      const result = await service.listMyNotifications(student1.id, {});
      expect(result.data[0].courseId).toBe(course.id);
    });
  });

  // ---------------------------------------------------------------------------
  // markRead / markAllRead
  // ---------------------------------------------------------------------------
  describe('markRead', () => {
    it('should set readAt on own notification', async () => {
      const course = await createCourse({ status: CourseStatus.PUBLISHED });
      const notif = await prisma.notification.create({
        data: {
          userId: student1.id,
          type: NotificationType.NEW_CONTENT,
          title: 'n',
          message: 'm',
          targetType: NOTIFICATION_TARGET_TYPE.COURSE,
          targetId: course.id,
        },
      });

      const result = await service.markRead(student1.id, notif.id);

      expect(result.readAt).not.toBeNull();
      const persisted = await prisma.notification.findUniqueOrThrow({ where: { id: notif.id } });
      expect(persisted.readAt).not.toBeNull();
    });

    it('should throw NotFoundException for another user\u2019s notification', async () => {
      const course = await createCourse({ status: CourseStatus.PUBLISHED });
      const notif = await prisma.notification.create({
        data: {
          userId: student2.id,
          type: NotificationType.NEW_CONTENT,
          title: 'n',
          message: 'm',
          targetType: NOTIFICATION_TARGET_TYPE.COURSE,
          targetId: course.id,
        },
      });

      await expect(service.markRead(student1.id, notif.id)).rejects.toThrow(
        'Notification not found.',
      );

      const persisted = await prisma.notification.findUniqueOrThrow({ where: { id: notif.id } });
      expect(persisted.readAt).toBeNull();
    });

    it('should throw NotFoundException for a non-existent notification', async () => {
      await expect(service.markRead(student1.id, 'does-not-exist')).rejects.toThrow(
        'Notification not found.',
      );
    });
  });

  describe('markAllRead', () => {
    it('should mark only unread notifications of the user', async () => {
      const course = await createCourse({ status: CourseStatus.PUBLISHED });
      await prisma.notification.createMany({
        data: [
          {
            userId: student1.id,
            type: NotificationType.NEW_CONTENT,
            title: 'a',
            message: 'm',
            targetType: NOTIFICATION_TARGET_TYPE.COURSE,
            targetId: course.id,
          },
          {
            userId: student1.id,
            type: NotificationType.NEW_CONTENT,
            title: 'b',
            message: 'm',
            targetType: NOTIFICATION_TARGET_TYPE.COURSE,
            targetId: course.id,
          },
          {
            userId: student1.id,
            type: NotificationType.NEW_CONTENT,
            title: 'c',
            message: 'm',
            targetType: NOTIFICATION_TARGET_TYPE.COURSE,
            targetId: course.id,
            readAt: new Date(),
          },
          {
            userId: student2.id,
            type: NotificationType.NEW_CONTENT,
            title: 'd',
            message: 'm',
            targetType: NOTIFICATION_TARGET_TYPE.COURSE,
            targetId: course.id,
          },
        ],
      });

      const result = await service.markAllRead(student1.id);
      expect(result).toEqual({ updated: 2 });

      const student1Unread = await prisma.notification.count({
        where: { userId: student1.id, readAt: null },
      });
      expect(student1Unread).toBe(0);

      // student2 untouched
      const student2Unread = await prisma.notification.count({
        where: { userId: student2.id, readAt: null },
      });
      expect(student2Unread).toBe(1);
    });

    it('should return updated=0 when nothing is unread', async () => {
      const result = await service.markAllRead(student1.id);
      expect(result).toEqual({ updated: 0 });
    });
  });
});
