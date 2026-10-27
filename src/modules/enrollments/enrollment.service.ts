import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { CourseStatus, EnrollmentStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { MyEnrollmentsQueryDto } from './dto/my-enrollments-query.dto.js';
@Injectable()
export class EnrollmentService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Enroll in a course for the first time, or reactivate
   * an existing LEFT enrollment.
   *
   * COMPLETED enrollments cannot be reactivated under the
   * current proposed policy.
   */
  async enroll(userId: string, courseId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const now = new Date();

        const course = await tx.course.findUnique({
          where: { id: courseId },
          select: {
            id: true,
            status: true,
            isSuspended: true,
            enrollmentStartAt: true,
            enrollmentEndAt: true,
          },
        });

        if (!course) {
          throw new NotFoundException('Course not found.');
        }

        this.assertEnrollmentEligible(course, now);

        const existing = await tx.enrollment.findUnique({
          where: {
            userId_courseId: {
              userId,
              courseId,
            },
          },
        });

        if (existing) {
          if (existing.status === EnrollmentStatus.ACTIVE) {
            throw new ConflictException('You are already enrolled in this course.');
          }

          if (existing.status === EnrollmentStatus.COMPLETED) {
            throw new ConflictException('You have already completed this course.');
          }

          const updated = await tx.enrollment.updateMany({
            where: {
              id: existing.id,
              userId,
              courseId,
              status: EnrollmentStatus.LEFT,
            },
            data: {
              status: EnrollmentStatus.ACTIVE,
              leftAt: null,
            },
          });

          if (updated.count !== 1) {
            throw new ConflictException('The enrollment state changed. Please retry.');
          }

          return tx.enrollment.findUniqueOrThrow({
            where: {
              userId_courseId: {
                userId,
                courseId,
              },
            },
          });
        }

        return tx.enrollment.create({
          data: {
            userId,
            courseId,
            status: EnrollmentStatus.ACTIVE,
          },
        });
      });
    } catch (error: unknown) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('An enrollment already exists or was created concurrently.');
      }

      throw error;
    }
  }

  /**
   * Leave a course without deleting the enrollment or
   * its BlockProgress, QuizAttempt, or AssignmentSubmission records.
   */
  async leave(userId: string, courseId: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.enrollment.findUnique({
        where: {
          userId_courseId: {
            userId,
            courseId,
          },
        },
      });

      if (!existing) {
        throw new NotFoundException('You do not have an enrollment for this course.');
      }

      if (existing.status === EnrollmentStatus.LEFT) {
        throw new ConflictException('You have already left this course.');
      }

      if (existing.status === EnrollmentStatus.COMPLETED) {
        throw new ConflictException('A completed enrollment cannot be left.');
      }

      const now = new Date();

      const updated = await tx.enrollment.updateMany({
        where: {
          id: existing.id,
          userId,
          courseId,
          status: EnrollmentStatus.ACTIVE,
        },
        data: {
          status: EnrollmentStatus.LEFT,
          leftAt: now,
        },
      });

      if (updated.count !== 1) {
        throw new ConflictException('The enrollment state changed. Please retry.');
      }

      return tx.enrollment.findUniqueOrThrow({
        where: {
          userId_courseId: {
            userId,
            courseId,
          },
        },
      });
    });
  }

  /**
   * List the current student's retained enrollments,
   * including LEFT and COMPLETED records.
   *
   * Course availability is evaluated using its current state,
   * not its state at the time of enrollment.
   */
  async getMyEnrollments(userId: string, query: MyEnrollmentsQueryDto) {
    const { page, limit } = query;
    const skip = (page - 1) * limit;

    const where = { userId };

    const [total, enrollments] = await Promise.all([
      this.prisma.enrollment.count({
        where,
      }),

      this.prisma.enrollment.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ enrolledAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          courseId: true,
          status: true,
          enrolledAt: true,
          leftAt: true,
          completedAt: true,
          course: {
            select: {
              id: true,
              title: true,
              status: true,
              isSuspended: true,
            },
          },
        },
      }),
    ]);

    const data = enrollments.map((enrollment) => {
      const courseAvailable =
        enrollment.course.status === CourseStatus.PUBLISHED && !enrollment.course.isSuspended;

      return {
        enrollmentId: enrollment.id,
        courseId: enrollment.courseId,
        status: enrollment.status,
        enrolledAt: enrollment.enrolledAt,
        leftAt: enrollment.leftAt,
        completedAt: enrollment.completedAt,
        course: enrollment.course,
        courseAvailable,
        canAccessCourse: courseAvailable && enrollment.status !== EnrollmentStatus.LEFT,
      };
    });

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  /**
   * Get the current student's enrollment and access state.
   * Returns null enrollment fields if they have never enrolled.
   */
  async getCourseEnrollmentState(userId: string, courseId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        status: true,
        isSuspended: true,
      },
    });

    if (!course) {
      throw new NotFoundException('Course not found.');
    }

    const enrollment = await this.prisma.enrollment.findUnique({
      where: {
        userId_courseId: {
          userId,
          courseId,
        },
      },
      select: {
        id: true,
        status: true,
        enrolledAt: true,
        leftAt: true,
        completedAt: true,
      },
    });

    const courseAvailable = this.isCourseAvailable(course);

    return {
      courseId,
      enrollmentId: enrollment?.id ?? null,
      enrollmentStatus: enrollment?.status ?? null,
      enrolledAt: enrollment?.enrolledAt ?? null,
      leftAt: enrollment?.leftAt ?? null,
      completedAt: enrollment?.completedAt ?? null,
      courseAvailable,
      canAccessCourse:
        courseAvailable && enrollment !== null && enrollment.status !== EnrollmentStatus.LEFT,
    };
  }

  /**
   * Reusable resource-level authorization.
   *
   * Call this before returning protected course content or
   * resolving a course resource reference for a student.
   */
  async assertCanAccessCourse(userId: string, courseId: string): Promise<void> {
    const state = await this.getCourseEnrollmentState(userId, courseId);

    if (!state.canAccessCourse) {
      throw new ForbiddenException('You do not have access to this course.');
    }
  }

  /**
   * Validate whether a student can enroll at the current time.
   * Expiry of the enrollment window does not revoke existing access.
   */
  private assertEnrollmentEligible(
    course: {
      status: CourseStatus;
      isSuspended: boolean;
      enrollmentStartAt: Date | null;
      enrollmentEndAt: Date | null;
    },
    now: Date,
  ): void {
    if (course.status !== CourseStatus.PUBLISHED || course.isSuspended) {
      throw new ConflictException('This course is not available for enrollment.');
    }

    if (course.enrollmentStartAt && now < course.enrollmentStartAt) {
      throw new ConflictException('The enrollment window has not opened.');
    }

    if (course.enrollmentEndAt && now > course.enrollmentEndAt) {
      throw new ConflictException('The enrollment window has closed.');
    }
  }

  /**
   * A course is available only if it is currently Published
   * and not suspended.
   */
  private isCourseAvailable(course: { status: CourseStatus; isSuspended: boolean }): boolean {
    return course.status === CourseStatus.PUBLISHED && !course.isSuspended;
  }

  /**
   * Identify Prisma unique-constraint violations (P2002),
   * including a concurrent first-enrollment attempt.
   */
  private isUniqueConstraintError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}
