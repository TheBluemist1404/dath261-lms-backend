import { Injectable } from '@nestjs/common';
import type { Course, CourseBlock, Prisma } from '../../generated/prisma/client.js';
import { CourseStatus, EnrollmentStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import type { ReferenceStatus } from './dto/responses/course-reference-response.dto.js';

export type BlockWithCourse = CourseBlock & { course: Course };

/**
 * Course access for referenced blocks (FR-RR-05): the viewer must be the
 * course's lecturer or hold an enrollment that is not LEFT, and the course must
 * be Published and not suspended. Workspace membership never grants it.
 */
@Injectable()
export class CourseBlockAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** The courses among `courseIds` the user is enrolled in (any status but LEFT). */
  async enrolledCourseIds(userId: string, courseIds: string[]): Promise<Set<string>> {
    if (courseIds.length === 0) {
      return new Set();
    }

    const enrollments = await this.prisma.enrollment.findMany({
      where: { userId, courseId: { in: courseIds }, status: { not: EnrollmentStatus.LEFT } },
      select: { courseId: true },
    });
    return new Set(enrollments.map((enrollment) => enrollment.courseId));
  }

  status(block: BlockWithCourse, userId: string, enrolled: Set<string>): ReferenceStatus {
    const { course } = block;

    if (course.lecturerId !== userId && !enrolled.has(course.id)) {
      return 'LOCKED';
    }
    if (course.status !== CourseStatus.PUBLISHED || course.isSuspended) {
      return 'UNAVAILABLE';
    }
    return 'AVAILABLE';
  }

  /** Prisma filter for courses whose blocks the user can currently open. */
  accessibleCourses(userId: string): Prisma.CourseWhereInput {
    return {
      status: CourseStatus.PUBLISHED,
      isSuspended: false,
      OR: [
        { lecturerId: userId },
        { enrollments: { some: { userId, status: { not: EnrollmentStatus.LEFT } } } },
      ],
    };
  }
}

/** Video length stored by the course module in the block's JSON payload. */
export function durationSeconds(block: CourseBlock): number | null {
  const content = block.content;
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const value = (content as Record<string, unknown>).durationSeconds;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return null;
}
