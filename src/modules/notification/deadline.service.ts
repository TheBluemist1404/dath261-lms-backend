import { Injectable } from '@nestjs/common';
import { BlockType, CourseStatus, EnrollmentStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { DEFAULT_DEADLINE_DAYS, DeadlineQueryDto } from './dto/deadline-query.dto.js';
import { DeadlineResponseDto } from './dto/deadline-response.dto.js';

@Injectable()
export class DeadlineService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Return upcoming quiz deadlines for the current student.
   *
   * Only quizzes inside ACTIVE enrollments, in PUBLISHED non-suspended
   * courses, with a deadline in [now, now + days] are included.
   * Sorted soonest first.
   */
  async listMyDeadlines(userId: string, query: DeadlineQueryDto): Promise<DeadlineResponseDto[]> {
    const days = query.days ?? DEFAULT_DEADLINE_DAYS;

    const now = new Date();
    const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    // 1. Active enrollments of the user in PUBLISHED, non-suspended courses.
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        userId,
        status: EnrollmentStatus.ACTIVE,
        course: {
          status: CourseStatus.PUBLISHED,
          isSuspended: false,
        },
      },
      select: {
        id: true,
        courseId: true,
      },
    });

    if (enrollments.length === 0) {
      return [];
    }

    const enrollmentIdByCourse = new Map<string, string>();
    for (const e of enrollments) {
      enrollmentIdByCourse.set(e.courseId, e.id);
    }
    const courseIds = enrollments.map((e) => e.courseId);

    // 2. Quiz configs in those courses with a deadline in the window.
    const configs = await this.prisma.quizConfig.findMany({
      where: {
        deadline: { gte: now, lte: until },
        courseBlock: {
          type: BlockType.QUIZ,
          courseId: { in: courseIds },
        },
      },
      select: {
        deadline: true,
        allowLate: true,
        maxAttempts: true,
        courseBlock: {
          select: {
            id: true,
            title: true,
            courseId: true,
            course: { select: { title: true } },
          },
        },
      },
      orderBy: { deadline: 'asc' },
    });

    if (configs.length === 0) {
      return [];
    }

    // 3. Attempts already used by the student, per quiz block.
    const blockIds = configs.map((c) => c.courseBlock.id);
    const attemptCounts = await this.prisma.quizAttempt.groupBy({
      by: ['courseBlockId', 'enrollmentId'],
      where: {
        courseBlockId: { in: blockIds },
        enrollmentId: { in: enrollments.map((e) => e.id) },
      },
      _count: { _all: true },
    });

    const attemptsUsedByBlock = new Map<string, number>();
    for (const row of attemptCounts) {
      // The enrollmentId is redundant here because (blockId, enrollmentId) is
      // unique per pair, but map by blockId for the common case where the
      // student has exactly one enrollment per course.
      attemptsUsedByBlock.set(row.courseBlockId, row._count._all);
    }

    // 4. Build response, keeping the orderBy: deadline asc from step 2.
    return configs.map((config) => {
      const block = config.courseBlock;
      return {
        courseId: block.courseId,
        courseTitle: block.course.title,
        blockId: block.id,
        title: block.title,
        // Non-null: filtered by `deadline: { gte, lte }` above.
        deadline: config.deadline as Date,
        allowLate: config.allowLate,
        attemptsUsed: attemptsUsedByBlock.get(block.id) ?? 0,
        maxAttempts: config.maxAttempts,
      };
    });
  }
}
