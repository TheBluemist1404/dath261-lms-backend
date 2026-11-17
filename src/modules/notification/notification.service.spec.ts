// notification.service.spec.ts

import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import {
  EnrollmentStatus,
  NotificationType,
  QuizAttemptStatus,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { NOTIFICATION_TARGET_TYPE } from './notification.constants.js';
import { NotificationService } from './notification.service.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
const buildNotificationRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'notif-1',
  userId: 'user-1',
  type: NotificationType.NEW_CONTENT,
  title: 'Title',
  message: 'Message',
  targetType: NOTIFICATION_TARGET_TYPE.COURSE,
  targetId: 'course-1',
  readAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Internal triggers — notifyNewContentOnPublish
// ---------------------------------------------------------------------------
describe('NotificationService - notifyNewContentOnPublish', () => {
  let service: NotificationService;

  const mockTx = {
    enrollment: { findMany: vi.fn() },
    notification: { createMany: vi.fn() },
  };

  const mockPrisma = {}; // not used by this method

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
    vi.clearAllMocks();
  });

  it('should create one notification per ACTIVE enrollee with COURSE target', async () => {
    mockTx.enrollment.findMany.mockResolvedValue([
      { userId: 'student-1' },
      { userId: 'student-2' },
    ]);
    mockTx.notification.createMany.mockResolvedValue({ count: 2 });

    const result = await service.notifyNewContentOnPublish(mockTx as never, {
      id: 'course-1',
      title: 'NestJS',
    });

    expect(mockTx.enrollment.findMany).toHaveBeenCalledWith({
      where: { courseId: 'course-1', status: EnrollmentStatus.ACTIVE },
      select: { userId: true },
    });
    expect(mockTx.notification.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: 'student-1',
          type: NotificationType.NEW_CONTENT,
          title: 'Course published',
          message: 'NestJS is now available.',
          targetType: NOTIFICATION_TARGET_TYPE.COURSE,
          targetId: 'course-1',
        },
        {
          userId: 'student-2',
          type: NotificationType.NEW_CONTENT,
          title: 'Course published',
          message: 'NestJS is now available.',
          targetType: NOTIFICATION_TARGET_TYPE.COURSE,
          targetId: 'course-1',
        },
      ],
    });
    expect(result).toEqual({ created: 2 });
  });

  it('should return created=0 and skip createMany when there are no enrollees', async () => {
    mockTx.enrollment.findMany.mockResolvedValue([]);

    const result = await service.notifyNewContentOnPublish(mockTx as never, {
      id: 'course-1',
      title: 'NestJS',
    });

    expect(mockTx.notification.createMany).not.toHaveBeenCalled();
    expect(result).toEqual({ created: 0 });
  });
});

// ---------------------------------------------------------------------------
// Internal triggers — notifyNewContentOnBlockAdded
// ---------------------------------------------------------------------------
describe('NotificationService - notifyNewContentOnBlockAdded', () => {
  let service: NotificationService;

  const mockTx = {
    enrollment: { findMany: vi.fn() },
    notification: { createMany: vi.fn() },
  };

  const mockPrisma = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
    vi.clearAllMocks();
  });

  it('should create one notification per ACTIVE enrollee with COURSE_BLOCK target', async () => {
    mockTx.enrollment.findMany.mockResolvedValue([{ userId: 'student-1' }]);
    mockTx.notification.createMany.mockResolvedValue({ count: 1 });

    const result = await service.notifyNewContentOnBlockAdded(
      mockTx as never,
      { id: 'course-1', title: 'NestJS' },
      { id: 'block-1', title: 'Week 2' },
    );

    expect(mockTx.notification.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: 'student-1',
          type: NotificationType.NEW_CONTENT,
          title: 'New content in NestJS',
          message: 'Week 2 was added.',
          targetType: NOTIFICATION_TARGET_TYPE.COURSE_BLOCK,
          targetId: 'block-1',
        },
      ],
    });
    expect(result).toEqual({ created: 1 });
  });

  it('should return created=0 when there are no enrollees', async () => {
    mockTx.enrollment.findMany.mockResolvedValue([]);

    const result = await service.notifyNewContentOnBlockAdded(
      mockTx as never,
      { id: 'course-1', title: 'NestJS' },
      { id: 'block-1', title: 'Week 2' },
    );

    expect(mockTx.notification.createMany).not.toHaveBeenCalled();
    expect(result).toEqual({ created: 0 });
  });
});

// ---------------------------------------------------------------------------
// Internal triggers — notifyResultReleased
// ---------------------------------------------------------------------------
describe('NotificationService - notifyResultReleased', () => {
  let service: NotificationService;

  const mockTx = {
    quizAttempt: { findMany: vi.fn() },
    notification: { createMany: vi.fn() },
  };

  const mockPrisma = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
    vi.clearAllMocks();
  });

  it('should create one notification per user with a graded attempt (deduped)', async () => {
    // Two attempts from the same student (student-1) should collapse to one.
    mockTx.quizAttempt.findMany.mockResolvedValue([
      { enrollment: { userId: 'student-1' } },
      { enrollment: { userId: 'student-2' } },
    ]);
    mockTx.notification.createMany.mockResolvedValue({ count: 2 });

    const result = await service.notifyResultReleased(
      mockTx as never,
      { id: 'course-1', title: 'NestJS' },
      { id: 'quiz-1', title: 'Week 1 quiz' },
    );

    expect(mockTx.quizAttempt.findMany).toHaveBeenCalledWith({
      where: {
        courseBlockId: 'quiz-1',
        status: { in: [QuizAttemptStatus.SUBMITTED, QuizAttemptStatus.GRADED] },
        score: { not: null },
        enrollment: {
          courseId: 'course-1',
          status: EnrollmentStatus.ACTIVE,
        },
      },
      select: { enrollment: { select: { userId: true } } },
      distinct: ['enrollmentId'],
    });

    const createManyArg = mockTx.notification.createMany.mock.calls[0][0];
    expect(createManyArg.data).toHaveLength(2);
    expect(createManyArg.data[0]).toMatchObject({
      userId: 'student-1',
      type: NotificationType.RESULT_RELEASED,
      targetType: NOTIFICATION_TARGET_TYPE.COURSE_BLOCK,
      targetId: 'quiz-1',
    });
    expect(createManyArg.data[1]).toMatchObject({
      userId: 'student-2',
      type: NotificationType.RESULT_RELEASED,
    });
    expect(result).toEqual({ created: 2 });
  });

  it('should return created=0 when no graded attempts exist', async () => {
    mockTx.quizAttempt.findMany.mockResolvedValue([]);

    const result = await service.notifyResultReleased(
      mockTx as never,
      { id: 'course-1', title: 'NestJS' },
      { id: 'quiz-1', title: 'Week 1 quiz' },
    );

    expect(mockTx.notification.createMany).not.toHaveBeenCalled();
    expect(result).toEqual({ created: 0 });
  });
});

// ---------------------------------------------------------------------------
// listMyNotifications
// ---------------------------------------------------------------------------
describe('NotificationService - listMyNotifications', () => {
  let service: NotificationService;

  const mockPrisma = {
    notification: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    courseBlock: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  const userId = 'user-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
  });

  it('should default to page 1, limit 20, newest first and return unreadCount', async () => {
    mockPrisma.notification.count
      .mockResolvedValueOnce(1) // total
      .mockResolvedValueOnce(1); // unreadCount
    mockPrisma.notification.findMany.mockResolvedValue([buildNotificationRow()]);
    mockPrisma.courseBlock.findMany.mockResolvedValue([]);

    const result = await service.listMyNotifications(userId, {});

    expect(mockPrisma.notification.count).toHaveBeenNthCalledWith(1, {
      where: { userId },
    });
    expect(mockPrisma.notification.count).toHaveBeenNthCalledWith(2, {
      where: { userId, readAt: null },
    });
    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 20,
    });
    expect(result.data).toHaveLength(1);
    expect(result.meta).toEqual({
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
      hasNextPage: false,
      hasPrevPage: false,
      unreadCount: 1,
    });
  });

  it('should filter to unread only when unread=true', async () => {
    mockPrisma.notification.count.mockResolvedValue(0);
    mockPrisma.notification.findMany.mockResolvedValue([]);

    await service.listMyNotifications(userId, { unread: 'true' });

    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId, readAt: null },
      }),
    );
  });

  it('should apply pagination', async () => {
    mockPrisma.notification.count.mockResolvedValue(42);
    mockPrisma.notification.findMany.mockResolvedValue([]);

    const result = await service.listMyNotifications(userId, { page: 3, limit: 10 });

    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
    expect(result.meta).toEqual({
      total: 42,
      page: 3,
      limit: 10,
      totalPages: 5,
      hasNextPage: true,
      hasPrevPage: true,
      unreadCount: 42,
    });
  });

  it('should always report unreadCount from the unread query regardless of filter', async () => {
    mockPrisma.notification.count
      .mockResolvedValueOnce(0) // total under filter
      .mockResolvedValueOnce(7); // total unread
    mockPrisma.notification.findMany.mockResolvedValue([]);

    const result = await service.listMyNotifications(userId, { unread: 'true' });

    expect(result.meta.unreadCount).toBe(7);
  });

  it('should derive courseId for COURSE targets directly from targetId', async () => {
    mockPrisma.notification.count.mockResolvedValue(1);
    mockPrisma.notification.findMany.mockResolvedValue([
      buildNotificationRow({
        targetType: NOTIFICATION_TARGET_TYPE.COURSE,
        targetId: 'course-1',
      }),
    ]);

    const result = await service.listMyNotifications(userId, {});

    expect(result.data[0].courseId).toBe('course-1');
    expect(mockPrisma.courseBlock.findMany).not.toHaveBeenCalled();
  });

  it('should batch-resolve courseId for COURSE_BLOCK targets', async () => {
    mockPrisma.notification.count.mockResolvedValue(2);
    mockPrisma.notification.findMany.mockResolvedValue([
      buildNotificationRow({
        id: 'notif-1',
        targetType: NOTIFICATION_TARGET_TYPE.COURSE_BLOCK,
        targetId: 'block-1',
      }),
      buildNotificationRow({
        id: 'notif-2',
        targetType: NOTIFICATION_TARGET_TYPE.COURSE_BLOCK,
        targetId: 'block-2',
      }),
    ]);
    mockPrisma.courseBlock.findMany.mockResolvedValue([
      { id: 'block-1', courseId: 'course-1' },
      { id: 'block-2', courseId: 'course-2' },
    ]);

    const result = await service.listMyNotifications(userId, {});

    expect(mockPrisma.courseBlock.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['block-1', 'block-2'] } },
      select: { id: true, courseId: true },
    });
    expect(result.data.map((d) => d.courseId)).toEqual(['course-1', 'course-2']);
  });

  it('should set courseId=null when the block no longer exists', async () => {
    mockPrisma.notification.count.mockResolvedValue(1);
    mockPrisma.notification.findMany.mockResolvedValue([
      buildNotificationRow({
        targetType: NOTIFICATION_TARGET_TYPE.COURSE_BLOCK,
        targetId: 'deleted-block',
      }),
    ]);
    mockPrisma.courseBlock.findMany.mockResolvedValue([]);

    const result = await service.listMyNotifications(userId, {});

    expect(result.data[0].courseId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// markRead
// ---------------------------------------------------------------------------
describe('NotificationService - markRead', () => {
  let service: NotificationService;

  const mockPrisma = {
    notification: {
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    courseBlock: {
      findMany: vi.fn(),
    },
  };

  const userId = 'user-1';
  const notificationId = 'notif-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
    vi.clearAllMocks();
    mockPrisma.courseBlock.findMany.mockResolvedValue([]);
  });

  it('should set readAt and return the updated notification', async () => {
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 1 });
    const readAt = new Date('2026-02-01T00:00:00.000Z');
    mockPrisma.notification.findUniqueOrThrow.mockResolvedValue(buildNotificationRow({ readAt }));

    const result = await service.markRead(userId, notificationId);

    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: notificationId, userId },
      data: { readAt: expect.any(Date) },
    });
    expect(result.readAt).toEqual(readAt);
  });

  it('should throw NotFoundException when notification does not exist or belongs to another user', async () => {
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.markRead(userId, notificationId)).rejects.toThrow(
      new NotFoundException('Notification not found.'),
    );
    expect(mockPrisma.notification.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// markAllRead
// ---------------------------------------------------------------------------
describe('NotificationService - markAllRead', () => {
  let service: NotificationService;

  const mockPrisma = {
    notification: { updateMany: vi.fn() },
  };

  const userId = 'user-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
    vi.clearAllMocks();
  });

  it('should update only unread notifications of the user and return count', async () => {
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 7 });

    const result = await service.markAllRead(userId);

    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId, readAt: null },
      data: { readAt: expect.any(Date) },
    });
    expect(result).toEqual({ updated: 7 });
  });

  it('should return updated=0 when nothing is unread', async () => {
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.markAllRead(userId);

    expect(result).toEqual({ updated: 0 });
  });
});
