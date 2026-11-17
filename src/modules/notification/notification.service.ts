import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  EnrollmentStatus,
  NotificationType,
  QuizAttemptStatus,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { NotificationQueryDto } from './dto/notification-query.dto.js';
import { NotificationResponseDto } from './dto/notification-response.dto.js';
import { PaginatedNotificationResponseDto } from './dto/paginated-notification-response.dto.js';
import { ReadAllResponseDto } from './dto/read-all-response.dto.js';
import { NOTIFICATION_TARGET_TYPE, type NotificationTargetType } from './notification.constants.js';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

/**
 * Minimal shape of a course needed to build notification messages.
 * Kept structural so callers can pass either a full `Course` row or a partial
 * loaded for a different purpose.
 */
export interface NotificationCourseRef {
  id: string;
  title: string;
}

/**
 * Minimal shape of a block needed to build notification messages.
 */
export interface NotificationBlockRef {
  id: string;
  title: string;
}

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}
  /**
   * NEW_CONTENT — course published.
   *
   * Notifies every ACTIVE enrollee of the course. When the course has no
   * enrollees (the common case on first publish), no rows are created.
   */
  async notifyNewContentOnPublish(
    tx: Prisma.TransactionClient,
    course: NotificationCourseRef,
  ): Promise<{ created: number }> {
    const recipients = await tx.enrollment.findMany({
      where: {
        courseId: course.id,
        status: EnrollmentStatus.ACTIVE,
      },
      select: { userId: true },
    });

    if (recipients.length === 0) {
      return { created: 0 };
    }

    const title = 'Course published';
    const message = `${course.title} is now available.`;

    const result = await tx.notification.createMany({
      data: recipients.map((r) => ({
        userId: r.userId,
        type: NotificationType.NEW_CONTENT,
        title,
        message,
        targetType: NOTIFICATION_TARGET_TYPE.COURSE,
        targetId: course.id,
      })),
    });

    return { created: result.count };
  }

  /**
   * NEW_CONTENT — block added to a published course.
   *
   * Notifies every ACTIVE enrollee of the course. Caller must ensure the course
   * is currently PUBLISHED and not suspended; this service does not re-check.
   */
  async notifyNewContentOnBlockAdded(
    tx: Prisma.TransactionClient,
    course: NotificationCourseRef,
    block: NotificationBlockRef,
  ): Promise<{ created: number }> {
    const recipients = await tx.enrollment.findMany({
      where: {
        courseId: course.id,
        status: EnrollmentStatus.ACTIVE,
      },
      select: { userId: true },
    });

    if (recipients.length === 0) {
      return { created: 0 };
    }

    const title = `New content in ${course.title}`;
    const message = `${block.title} was added.`;

    const result = await tx.notification.createMany({
      data: recipients.map((r) => ({
        userId: r.userId,
        type: NotificationType.NEW_CONTENT,
        title,
        message,
        targetType: NOTIFICATION_TARGET_TYPE.COURSE_BLOCK,
        targetId: block.id,
      })),
    });

    return { created: result.count };
  }

  /**
   * RESULT_RELEASED — quiz results released.
   *
   * Notifies each student with at least one graded attempt in the quiz.
   * "Graded" = status SUBMITTED or GRADED with a non-null score (same definition
   * used by EnrollmentService.aggregateQuizScores). Multiple attempts by the same
   * student collapse into one notification.
   */
  async notifyResultReleased(
    tx: Prisma.TransactionClient,
    course: NotificationCourseRef,
    block: NotificationBlockRef,
  ): Promise<{ created: number }> {
    const attempts = await tx.quizAttempt.findMany({
      where: {
        courseBlockId: block.id,
        status: { in: [QuizAttemptStatus.SUBMITTED, QuizAttemptStatus.GRADED] },
        score: { not: null },
        enrollment: {
          courseId: course.id,
          status: EnrollmentStatus.ACTIVE,
        },
      },
      select: {
        enrollment: { select: { userId: true } },
      },
      distinct: ['enrollmentId'],
    });

    if (attempts.length === 0) {
      return { created: 0 };
    }

    // De-duplicate userIds defensively (distinct is on enrollmentId, and each
    // enrollment belongs to exactly one user, so this is already unique — but
    // belt-and-braces in case the model ever allows multiple enrollments).
    const userIds = Array.from(new Set(attempts.map((a) => a.enrollment.userId)));

    const title = 'Results released';
    const message = `Results for ${block.title} in ${course.title} are now available.`;

    const result = await tx.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        type: NotificationType.RESULT_RELEASED,
        title,
        message,
        targetType: NOTIFICATION_TARGET_TYPE.COURSE_BLOCK,
        targetId: block.id,
      })),
    });

    return { created: result.count };
  }

  // ---------------------------------------------------------------------------
  // Public — user-facing queries
  // ---------------------------------------------------------------------------

  async listMyNotifications(
    userId: string,
    query: NotificationQueryDto,
  ): Promise<PaginatedNotificationResponseDto> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const skip = (page - 1) * limit;

    const where: Prisma.NotificationWhereInput = { userId };
    if (query.unread === 'true') {
      where.readAt = null;
    }

    const [total, unreadCount, rows] = await this.prisma.$transaction([
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const courseIdByNotification = await this.deriveCourseIds(rows);

    const totalPages = Math.ceil(total / limit) || 0;

    return {
      data: rows.map((row) => this.toResponseDto(row, courseIdByNotification.get(row.id) ?? null)),
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
        unreadCount,
      },
    };
  }

  async markRead(userId: string, notificationId: string): Promise<NotificationResponseDto> {
    const now = new Date();

    const result = await this.prisma.notification.updateMany({
      where: {
        id: notificationId,
        userId,
      },
      data: { readAt: now },
    });

    // 404 for both "not found" and "belongs to another user" so a notification
    // id does not reveal that it exists.
    if (result.count === 0) {
      throw new NotFoundException('Notification not found.');
    }

    const row = await this.prisma.notification.findUniqueOrThrow({
      where: { id: notificationId },
    });

    const courseIdByNotification = await this.deriveCourseIds([row]);

    return this.toResponseDto(row, courseIdByNotification.get(row.id) ?? null);
  }

  async markAllRead(userId: string): Promise<ReadAllResponseDto> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });

    return { updated: result.count };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async deriveCourseIds(
    rows: Array<{
      id: string;
      targetType: string | null;
      targetId: string | null;
    }>,
  ): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    if (rows.length === 0) {
      return result;
    }

    const blockTargetIds = rows
      .filter((r) => r.targetType === NOTIFICATION_TARGET_TYPE.COURSE_BLOCK && r.targetId !== null)
      .map((r) => r.targetId as string);

    const blockCourseById = new Map<string, string>();
    if (blockTargetIds.length > 0) {
      const blocks = await this.prisma.courseBlock.findMany({
        where: { id: { in: blockTargetIds } },
        select: { id: true, courseId: true },
      });
      for (const block of blocks) {
        blockCourseById.set(block.id, block.courseId);
      }
    }

    for (const row of rows) {
      if (row.targetType === NOTIFICATION_TARGET_TYPE.COURSE && row.targetId !== null) {
        result.set(row.id, row.targetId);
        continue;
      }

      if (row.targetType === NOTIFICATION_TARGET_TYPE.COURSE_BLOCK && row.targetId !== null) {
        result.set(row.id, blockCourseById.get(row.targetId) ?? null);
        continue;
      }

      result.set(row.id, null);
    }

    return result;
  }

  private toResponseDto(
    row: {
      id: string;
      type: NotificationType;
      title: string;
      message: string;
      targetType: string | null;
      targetId: string | null;
      readAt: Date | null;
      createdAt: Date;
    },
    courseId: string | null,
  ): NotificationResponseDto {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      message: row.message,
      targetType: row.targetType as NotificationTargetType | null,
      targetId: row.targetId,
      courseId,
      readAt: row.readAt,
      createdAt: row.createdAt,
    };
  }
}
