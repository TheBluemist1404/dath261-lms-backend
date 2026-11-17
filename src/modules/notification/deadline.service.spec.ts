// deadline.service.spec.ts

import { Test, type TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { BlockType, CourseStatus, EnrollmentStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { DeadlineService } from './deadline.service.js';

describe('DeadlineService - listMyDeadlines', () => {
  let service: DeadlineService;

  const mockPrisma = {
    enrollment: { findMany: vi.fn() },
    quizConfig: { findMany: vi.fn() },
    quizAttempt: { groupBy: vi.fn() },
  };

  const userId = 'user-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DeadlineService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<DeadlineService>(DeadlineService);
    vi.clearAllMocks();
  });

  it('should return [] when the student has no active enrollments', async () => {
    mockPrisma.enrollment.findMany.mockResolvedValue([]);

    const result = await service.listMyDeadlines(userId, {});

    expect(result).toEqual([]);
    expect(mockPrisma.quizConfig.findMany).not.toHaveBeenCalled();
  });

  it('should query enrollments filtered by ACTIVE + PUBLISHED + non-suspended', async () => {
    mockPrisma.enrollment.findMany.mockResolvedValue([]);

    await service.listMyDeadlines(userId, {});

    expect(mockPrisma.enrollment.findMany).toHaveBeenCalledWith({
      where: {
        userId,
        status: EnrollmentStatus.ACTIVE,
        course: { status: CourseStatus.PUBLISHED, isSuspended: false },
      },
      select: { id: true, courseId: true },
    });
  });

  it('should default days to 14 and query a deadline window', async () => {
    mockPrisma.enrollment.findMany.mockResolvedValue([{ id: 'enr-1', courseId: 'course-1' }]);
    mockPrisma.quizConfig.findMany.mockResolvedValue([]);

    await service.listMyDeadlines(userId, {});

    const arg = mockPrisma.quizConfig.findMany.mock.calls[0][0];
    const { gte, lte } = arg.where.deadline;
    expect(gte).toBeInstanceOf(Date);
    expect(lte).toBeInstanceOf(Date);
    const windowMs = (lte as Date).getTime() - (gte as Date).getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    // 14 days ± small skew from "now" being captured slightly later.
    expect(windowMs).toBeGreaterThanOrEqual(14 * dayMs - 1000);
    expect(windowMs).toBeLessThanOrEqual(14 * dayMs + 1000);
  });

  it('should use the provided days value', async () => {
    mockPrisma.enrollment.findMany.mockResolvedValue([{ id: 'enr-1', courseId: 'course-1' }]);
    mockPrisma.quizConfig.findMany.mockResolvedValue([]);

    await service.listMyDeadlines(userId, { days: 3 });

    const arg = mockPrisma.quizConfig.findMany.mock.calls[0][0];
    const windowMs =
      (arg.where.deadline.lte as Date).getTime() - (arg.where.deadline.gte as Date).getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    expect(windowMs).toBeGreaterThanOrEqual(3 * dayMs - 1000);
    expect(windowMs).toBeLessThanOrEqual(3 * dayMs + 1000);
  });

  it('should filter quizConfigs by QUIZ type and course ids from enrollments', async () => {
    mockPrisma.enrollment.findMany.mockResolvedValue([
      { id: 'enr-1', courseId: 'course-1' },
      { id: 'enr-2', courseId: 'course-2' },
    ]);
    mockPrisma.quizConfig.findMany.mockResolvedValue([]);

    await service.listMyDeadlines(userId, {});

    expect(mockPrisma.quizConfig.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deadline: { gte: expect.any(Date), lte: expect.any(Date) },
          courseBlock: {
            type: BlockType.QUIZ,
            courseId: { in: ['course-1', 'course-2'] },
          },
        },
        orderBy: { deadline: 'asc' },
      }),
    );
  });

  it('should count attemptsUsed via groupBy and default to 0', async () => {
    mockPrisma.enrollment.findMany.mockResolvedValue([{ id: 'enr-1', courseId: 'course-1' }]);
    mockPrisma.quizConfig.findMany.mockResolvedValue([
      {
        deadline: new Date('2026-03-01T00:00:00.000Z'),
        allowLate: false,
        maxAttempts: 3,
        courseBlock: {
          id: 'block-1',
          title: 'Quiz 1',
          courseId: 'course-1',
          course: { title: 'NestJS' },
        },
      },
      {
        deadline: new Date('2026-03-02T00:00:00.000Z'),
        allowLate: true,
        maxAttempts: 1,
        courseBlock: {
          id: 'block-2',
          title: 'Quiz 2',
          courseId: 'course-1',
          course: { title: 'NestJS' },
        },
      },
    ]);
    mockPrisma.quizAttempt.groupBy.mockResolvedValue([
      { courseBlockId: 'block-1', enrollmentId: 'enr-1', _count: { _all: 2 } },
    ]);

    const result = await service.listMyDeadlines(userId, {});

    expect(result).toEqual([
      {
        courseId: 'course-1',
        courseTitle: 'NestJS',
        blockId: 'block-1',
        title: 'Quiz 1',
        deadline: new Date('2026-03-01T00:00:00.000Z'),
        allowLate: false,
        attemptsUsed: 2,
        maxAttempts: 3,
      },
      {
        courseId: 'course-1',
        courseTitle: 'NestJS',
        blockId: 'block-2',
        title: 'Quiz 2',
        deadline: new Date('2026-03-02T00:00:00.000Z'),
        allowLate: true,
        attemptsUsed: 0,
        maxAttempts: 1,
      },
    ]);
  });
});
