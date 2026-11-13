// enrollment.service.ts
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BlockType,
  CourseStatus,
  EnrollmentStatus,
  Prisma,
  QuizAttemptStatus,
  QuizScoringMode,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { loadProgressForEnrollments, roundHalfUp } from '../progress/progress.util.js';
import { EnrollmentRosterQueryDto } from './dto/enrollment-roster-query.dto.js';
import type { EnrollmentRosterItemDto } from './dto/enrollment-roster-response.dto.js';
import { MyEnrollmentsQueryDto } from './dto/my-enrollments-query.dto.js';
import type { PaginatedEnrollmentRosterResponseDto } from './dto/paginated-enrollment-roster-response.dto.js';
import { MyEnrollmentState } from './enums/my-enrollment-state.enum.js';

type EnrollmentAccessClient = Pick<Prisma.TransactionClient, 'course' | 'enrollment'>;

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const QUIZ_SCORE_DECIMALS = 2;

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
    const { page, limit, state } = query;
    const skip = (page - 1) * limit;

    const where = this.buildMyEnrollmentsWhere(userId, state);

    const [total, enrollments] = await Promise.all([
      this.prisma.enrollment.count({ where }),

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
      const courseAvailable = this.isCourseAvailable(enrollment.course);

      return {
        enrollmentId: enrollment.id,
        courseId: enrollment.courseId,
        status: enrollment.status,
        state: this.deriveMyEnrollmentState(enrollment.status, courseAvailable),
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

  private buildMyEnrollmentsWhere(
    userId: string,
    state?: MyEnrollmentState,
  ): Prisma.EnrollmentWhereInput {
    switch (state) {
      case MyEnrollmentState.IN_PROGRESS:
        return {
          userId,
          status: EnrollmentStatus.ACTIVE,
          course: {
            is: {
              status: CourseStatus.PUBLISHED,
              isSuspended: false,
            },
          },
        };

      case MyEnrollmentState.UNAVAILABLE:
        return {
          userId,
          status: EnrollmentStatus.ACTIVE,
          course: {
            is: {
              OR: [
                {
                  status: {
                    not: CourseStatus.PUBLISHED,
                  },
                },
                {
                  isSuspended: true,
                },
              ],
            },
          },
        };

      case MyEnrollmentState.COMPLETED:
        return {
          userId,
          status: EnrollmentStatus.COMPLETED,
        };

      default:
        return {
          userId,
          status: {
            not: EnrollmentStatus.LEFT,
          },
        };
    }
  }

  private deriveMyEnrollmentState(
    status: EnrollmentStatus,
    courseAvailable: boolean,
  ): MyEnrollmentState {
    if (status === EnrollmentStatus.COMPLETED) {
      return MyEnrollmentState.COMPLETED;
    }

    if (status === EnrollmentStatus.ACTIVE) {
      return courseAvailable ? MyEnrollmentState.IN_PROGRESS : MyEnrollmentState.UNAVAILABLE;
    }

    throw new Error(`Unexpected enrollment status in My Courses: ${status}`);
  }

  /**
   * Get the current student's enrollment and access state.
   * Returns null enrollment fields if they have never enrolled.
   */
  async getCourseEnrollmentState(
    userId: string,
    courseId: string,
    db: EnrollmentAccessClient = this.prisma,
  ) {
    const course = await db.course.findUnique({
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

    const enrollment = await db.enrollment.findUnique({
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
  async assertCanAccessCourse(
    userId: string,
    courseId: string,
    db: EnrollmentAccessClient = this.prisma,
  ) {
    const state = await this.getCourseEnrollmentState(userId, courseId, db);

    if (!state.canAccessCourse || state.enrollmentId === null || state.enrollmentStatus === null) {
      throw new ForbiddenException('You do not have access to this course.');
    }

    return {
      id: state.enrollmentId,
      status: state.enrollmentStatus,
    };
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

  async assertLecturerCanAccessEnrollment(
    tx: Prisma.TransactionClient,
    lecturerId: string,
    courseId: string,
    enrollmentId: string,
  ) {
    const enrollment = await tx.enrollment.findUnique({
      where: { id: enrollmentId },
      include: {
        course: { select: { lecturerId: true } },
        user: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
      },
    });

    if (!enrollment || enrollment.courseId !== courseId) {
      throw new NotFoundException('Enrollment not found in this course.');
    }

    if (enrollment.course.lecturerId !== lecturerId) {
      throw new ForbiddenException('You do not own this course.');
    }

    return enrollment;
  }

  async completeEnrollment(lecturerId: string, courseId: string, enrollmentId: string) {
    return this.prisma.$transaction(async (tx) => {
      const enrollment = await tx.enrollment.findUnique({
        where: { id: enrollmentId },
        select: {
          id: true,
          courseId: true,
          status: true,
          course: { select: { lecturerId: true } },
        },
      });

      if (!enrollment || enrollment.courseId !== courseId) {
        throw new NotFoundException('Enrollment not found in this course.');
      }

      if (enrollment.course.lecturerId !== lecturerId) {
        throw new ForbiddenException('You do not own this course.');
      }

      if (enrollment.status !== EnrollmentStatus.ACTIVE) {
        throw new ConflictException('Only ACTIVE enrollments can be completed.');
      }

      const now = new Date();
      const result = await tx.enrollment.updateMany({
        where: {
          id: enrollmentId,
          courseId,
          status: EnrollmentStatus.ACTIVE,
        },
        data: {
          status: EnrollmentStatus.COMPLETED,
          completedAt: now,
        },
      });

      if (result.count !== 1) {
        throw new ConflictException('The enrollment state changed. Please retry.');
      }

      return {
        enrollmentId,
        status: EnrollmentStatus.COMPLETED,
        completedAt: now,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Lecturer: course roster
  // ---------------------------------------------------------------------------

  /**
   * Return the roster of a course for its owning Lecturer:
   * every enrollment with the student, progress (same counting as the student
   * endpoint) and the mean quiz final score.
   *
   * FR-EN-07: this deliberately does NOT check the course status. A course moved
   * back to DRAFT (or suspended) keeps its enrollments and learning data, and the
   * owning Lecturer must still be able to review them to grade completion.
   */
  async listCourseRoster(
    lecturerId: string,
    courseId: string,
    query: EnrollmentRosterQueryDto,
  ): Promise<PaginatedEnrollmentRosterResponseDto> {
    await this.assertLecturerOwnsCourse(courseId, lecturerId);

    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const skip = (page - 1) * limit;

    const where = this.buildRosterWhere(courseId, query);

    const [total, enrollments] = await Promise.all([
      this.prisma.enrollment.count({ where }),
      this.prisma.enrollment.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ enrolledAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          status: true,
          enrolledAt: true,
          completedAt: true,
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      }),
    ]);

    const enrollmentIds = enrollments.map((enrollment) => enrollment.id);

    const [progressByEnrollment, quizScoreByEnrollment] = await Promise.all([
      loadProgressForEnrollments(this.prisma, courseId, enrollmentIds),
      this.aggregateQuizScores(courseId, enrollmentIds),
    ]);

    const data: EnrollmentRosterItemDto[] = enrollments.map((enrollment) => {
      const progress = progressByEnrollment.get(enrollment.id) ?? {
        completedBlocks: 0,
        totalBlocks: 0,
        percent: 0,
      };

      return {
        enrollmentId: enrollment.id,
        status: enrollment.status,
        enrolledAt: enrollment.enrolledAt,
        completedAt: enrollment.completedAt,
        student: {
          id: enrollment.user.id,
          firstName: enrollment.user.firstName,
          lastName: enrollment.user.lastName,
          email: enrollment.user.email,
        },
        progress,
        quizScore: quizScoreByEnrollment.get(enrollment.id) ?? null,
      };
    });

    return {
      data,
      meta: this.buildRosterMeta(total, page, limit),
    };
  }

  private async assertLecturerOwnsCourse(courseId: string, lecturerId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, lecturerId: true },
    });

    if (!course) {
      throw new NotFoundException('Course not found.');
    }

    if (course.lecturerId !== lecturerId) {
      throw new ForbiddenException('You do not own this course.');
    }

    return course;
  }

  private buildRosterWhere(
    courseId: string,
    query: EnrollmentRosterQueryDto,
  ): Prisma.EnrollmentWhereInput {
    const where: Prisma.EnrollmentWhereInput = { courseId };

    if (query.status) {
      where.status = query.status;
    } else {
      // Default: ACTIVE + COMPLETED. LEFT students are excluded unless requested.
      where.status = {
        in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED],
      };
    }

    const search = query.search?.trim();
    if (search) {
      where.user = {
        is: {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        },
      };
    }

    return where;
  }

  private buildRosterMeta(total: number, page: number, limit: number) {
    const totalPages = Math.ceil(total / limit) || 0;

    return {
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    };
  }

  /**
   * For each enrollment, compute the mean of each quiz's final score (per its
   * scoringMode) over quizzes with at least one graded attempt. Null when the
   * student has no graded attempt in the course.
   *
   * Two fixed queries (quiz blocks + attempts), no N+1.
   */
  private async aggregateQuizScores(
    courseId: string,
    enrollmentIds: string[],
  ): Promise<Map<string, number | null>> {
    const result = new Map<string, number | null>();
    for (const enrollmentId of enrollmentIds) {
      result.set(enrollmentId, null);
    }

    if (enrollmentIds.length === 0) {
      return result;
    }

    const quizBlocks = await this.prisma.courseBlock.findMany({
      where: {
        courseId,
        type: BlockType.QUIZ,
      },
      select: {
        id: true,
        quizConfig: {
          select: { scoringMode: true },
        },
      },
    });

    if (quizBlocks.length === 0) {
      return result;
    }

    const scoringModeByBlock = new Map<string, QuizScoringMode>();
    for (const block of quizBlocks) {
      if (block.quizConfig) {
        scoringModeByBlock.set(block.id, block.quizConfig.scoringMode);
      }
    }

    const attempts = await this.prisma.quizAttempt.findMany({
      where: {
        enrollmentId: { in: enrollmentIds },
        courseBlockId: { in: quizBlocks.map((block) => block.id) },
        status: { in: [QuizAttemptStatus.SUBMITTED, QuizAttemptStatus.GRADED] },
        score: { not: null },
      },
      select: {
        enrollmentId: true,
        courseBlockId: true,
        attemptNumber: true,
        score: true,
        submittedAt: true,
      },
    });

    // Group attempts per (enrollmentId, blockId).
    const attemptsByEnrollmentAndBlock = new Map<string, Map<string, typeof attempts>>();

    for (const attempt of attempts) {
      let byBlock = attemptsByEnrollmentAndBlock.get(attempt.enrollmentId);
      if (!byBlock) {
        byBlock = new Map();
        attemptsByEnrollmentAndBlock.set(attempt.enrollmentId, byBlock);
      }

      const list = byBlock.get(attempt.courseBlockId) ?? [];
      list.push(attempt);
      byBlock.set(attempt.courseBlockId, list);
    }

    for (const enrollmentId of enrollmentIds) {
      const byBlock = attemptsByEnrollmentAndBlock.get(enrollmentId);
      if (!byBlock || byBlock.size === 0) {
        continue;
      }

      const finalScores: number[] = [];

      for (const [blockId, blockAttempts] of byBlock.entries()) {
        const scoringMode = scoringModeByBlock.get(blockId);
        if (!scoringMode) {
          continue;
        }

        const finalScore = this.pickFinalQuizScore(blockAttempts, scoringMode);
        if (finalScore !== null) {
          finalScores.push(finalScore);
        }
      }

      if (finalScores.length === 0) {
        continue;
      }

      const mean = finalScores.reduce((sum, value) => sum + value, 0) / finalScores.length;
      result.set(enrollmentId, roundHalfUp(mean, QUIZ_SCORE_DECIMALS));
    }

    return result;
  }

  /**
   * Pick the final score of one quiz given its scoring mode.
   * Only graded attempts with a non-null score are passed in.
   */
  private pickFinalQuizScore(
    attempts: Array<{
      attemptNumber: number;
      score: Prisma.Decimal | null;
      submittedAt: Date | null;
    }>,
    scoringMode: QuizScoringMode,
  ): number | null {
    if (attempts.length === 0) {
      return null;
    }

    if (scoringMode === QuizScoringMode.HIGHEST) {
      const scores = attempts
        .map((attempt) => this.toScoreNumber(attempt.score))
        .filter((score): score is number => score !== null);

      if (scores.length === 0) {
        return null;
      }

      return Math.max(...scores);
    }

    if (scoringMode === QuizScoringMode.LATEST) {
      const latest = [...attempts].sort((a, b) => {
        if (b.attemptNumber !== a.attemptNumber) {
          return b.attemptNumber - a.attemptNumber;
        }
        const aTime = a.submittedAt?.getTime() ?? 0;
        const bTime = b.submittedAt?.getTime() ?? 0;
        return bTime - aTime;
      })[0];

      return this.toScoreNumber(latest.score);
    }

    if (scoringMode === QuizScoringMode.AVERAGE) {
      const scores = attempts
        .map((attempt) => this.toScoreNumber(attempt.score))
        .filter((score): score is number => score !== null);

      if (scores.length === 0) {
        return null;
      }

      const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
      return roundHalfUp(mean, QUIZ_SCORE_DECIMALS);
    }

    // Defensive: unknown scoring mode → no score.
    return null;
  }

  private toScoreNumber(score: Prisma.Decimal | null): number | null {
    if (score === null) {
      return null;
    }

    const parsed = Number(score.toString());
    return Number.isFinite(parsed) ? parsed : null;
  }

  /**
   * Identify Prisma unique-constraint violations (P2002),
   * including a concurrent first-enrollment attempt.
   */
  private isUniqueConstraintError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}
