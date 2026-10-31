import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  AssignmentSubmissionStatus,
  BlockType,
  CourseStatus,
  EnrollmentStatus,
  Prisma,
  QuizAttemptStatus,
} from '../../generated/prisma/client.js';

import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { EnrollmentService } from '../enrollments/enrollment.service.js';
import type { UpdateBlockCompletionDto } from './dto/update-block-completion.dto.js';
import type { UpdateLearningPositionDto } from './dto/update-learning-position.dto.js';
import type { ResumeData } from './types/resume-data.type.js';

const TRACKED_BLOCK_TYPES: BlockType[] = [
  BlockType.TEXT,
  BlockType.FILE,
  BlockType.VIDEO,
  BlockType.QUIZ,
  BlockType.ASSIGNMENT,
];

const MANUALLY_COMPLETABLE_TYPES: BlockType[] = [BlockType.TEXT, BlockType.FILE, BlockType.VIDEO];

const RESUMABLE_BLOCK_TYPES = TRACKED_BLOCK_TYPES;

@Injectable()
export class ProgressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enrollmentService: EnrollmentService,
  ) {}

  // Student: Update completion

  async updateBlockCompletion(
    userId: string,
    courseId: string,
    blockId: string,
    dto: UpdateBlockCompletionDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const enrollment = await this.getStudentContext(tx, userId, courseId, true);

      const block = await tx.courseBlock.findFirst({
        where: {
          id: blockId,
          courseId,
        },
        select: {
          id: true,
          type: true,
        },
      });

      if (!block) {
        throw new NotFoundException('Course block not found.');
      }

      if (!MANUALLY_COMPLETABLE_TYPES.includes(block.type)) {
        throw new BadRequestException(
          'Only TEXT, FILE, and VIDEO blocks can be manually completed.',
        );
      }

      const now = new Date();

      return tx.blockProgress.upsert({
        where: {
          enrollmentId_courseBlockId: {
            enrollmentId: enrollment.id,
            courseBlockId: block.id,
          },
        },
        create: {
          enrollmentId: enrollment.id,
          courseBlockId: block.id,
          completed: dto.completed,
          completedAt: dto.completed ? now : null,
        },
        update: {
          completed: dto.completed,
          completedAt: dto.completed ? now : null,
        },
      });
    });
  }

  // -----------------------------------------------
  // Student: Save last visited position
  // -----------------------------------------------

  async updateLearningPosition(
    userId: string,
    courseId: string,
    blockId: string,
    dto: UpdateLearningPositionDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const enrollment = await this.getStudentContext(tx, userId, courseId, true);

      const block = await tx.courseBlock.findFirst({
        where: {
          id: blockId,
          courseId,
        },
        select: {
          id: true,
          type: true,
        },
      });

      if (!block) {
        throw new NotFoundException('Course block not found.');
      }

      if (!RESUMABLE_BLOCK_TYPES.includes(block.type)) {
        throw new BadRequestException('Modules cannot have a resume position.');
      }

      if (dto.resumeData != null) {
        this.validateResumeData(block.type, dto.resumeData);
      }

      const now = new Date();

      let resumeWrite = {};

      if (dto.resumeData === null) {
        resumeWrite = {
          resumeData: Prisma.JsonNull,
        };
      } else if (dto.resumeData !== undefined) {
        const resumeJson: Prisma.InputJsonValue = {
          version: dto.resumeData.version,
          type: dto.resumeData.type,
          data: dto.resumeData.data,
        };

        resumeWrite = {
          resumeData: resumeJson,
        };
      }

      return tx.blockProgress.upsert({
        where: {
          enrollmentId_courseBlockId: {
            enrollmentId: enrollment.id,
            courseBlockId: block.id,
          },
        },
        create: {
          enrollmentId: enrollment.id,
          courseBlockId: block.id,
          lastVisitedAt: now,
          ...resumeWrite,
        },
        update: {
          lastVisitedAt: now,
          ...resumeWrite,
        },
      });
    });
  }

  // -----------------------------------------------
  // Student: Read progress
  // -----------------------------------------------

  async getStudentProgress(userId: string, courseId: string) {
    return this.prisma.$transaction(async (tx) => {
      const enrollment = await this.getStudentContext(tx, userId, courseId, false);

      const snapshot = await this.getProgressSnapshot(tx, courseId, enrollment.id);

      return {
        enrollmentId: enrollment.id,
        enrollmentStatus: enrollment.status,
        progress: snapshot.progress,
        items: snapshot.items,
      };
    });
  }

  // -----------------------------------------------
  // Student: Get resume position
  // -----------------------------------------------

  async getResumePosition(userId: string, courseId: string) {
    return this.prisma.$transaction(async (tx) => {
      const enrollment = await this.getStudentContext(tx, userId, courseId, false);

      const lastVisited = await tx.blockProgress.findFirst({
        where: {
          enrollmentId: enrollment.id,
          lastVisitedAt: {
            not: null,
          },
          courseBlock: {
            is: {
              courseId,
              type: {
                in: RESUMABLE_BLOCK_TYPES,
              },
            },
          },
        },
        orderBy: [{ lastVisitedAt: 'desc' }, { id: 'desc' }],
        select: {
          lastVisitedAt: true,
          resumeData: true,
          courseBlock: {
            select: {
              id: true,
              type: true,
              title: true,
              position: true,
              parentModuleId: true,
            },
          },
        },
      });

      if (!lastVisited) {
        return {
          hasResumePosition: false,
          lastVisitedAt: null,
          block: null,
          resumeData: null,
        };
      }

      return {
        hasResumePosition: true,
        lastVisitedAt: lastVisited.lastVisitedAt,
        block: lastVisited.courseBlock,
        resumeData: lastVisited.resumeData as ResumeData | null,
      };
    });
  }

  // -----------------------------------------------
  // Lecturer: Read learner progress
  // -----------------------------------------------

  async getLecturerStudentProgress(lecturerId: string, courseId: string, enrollmentId: string) {
    return this.prisma.$transaction(async (tx) => {
      const enrollment = await this.enrollmentService.assertLecturerCanAccessEnrollment(
        tx,
        lecturerId,
        courseId,
        enrollmentId,
      );

      const snapshot = await this.getProgressSnapshot(tx, courseId, enrollment.id);

      const quizAttempts = await tx.quizAttempt.findMany({
        where: {
          enrollmentId,
          quizBlock: { is: { courseId } },
        },
        orderBy: { startedAt: 'desc' },
        select: {
          id: true,
          courseBlockId: true,
          attemptNumber: true,
          status: true,
          answers: true,
          score: true,
          startedAt: true,
          submittedAt: true,
          gradedAt: true,
          quizBlock: { select: { title: true } },
        },
      });

      const assignmentSubmissions = await tx.assignmentSubmission.findMany({
        where: {
          enrollmentId,
          assignmentBlock: { is: { courseId } },
        },
        orderBy: { submittedAt: 'desc' },
        select: {
          id: true,
          courseBlockId: true,
          attemptNumber: true,
          textContent: true,
          fileMetadata: true,
          status: true,
          score: true,
          feedback: true,
          submittedAt: true,
          gradedAt: true,
          assignmentBlock: { select: { title: true } },
        },
      });

      return {
        enrollment: {
          id: enrollment.id,
          status: enrollment.status,
          enrolledAt: enrollment.enrolledAt,
          leftAt: enrollment.leftAt,
          completedAt: enrollment.completedAt,
        },
        student: enrollment.user,
        progress: snapshot.progress,
        items: snapshot.items,
        quizAttempts: quizAttempts.map((attempt) => ({
          ...attempt,
          score: attempt.score?.toString() ?? null,
        })),
        assignmentSubmissions: assignmentSubmissions.map((submission) => ({
          ...submission,
          score: submission.score?.toString() ?? null,
        })),
      };
    });
  }

  async markAssessmentBlockCompleted(
    tx: Prisma.TransactionClient,
    userId: string,
    courseId: string,
    courseBlockId: string,
    expectedType: typeof BlockType.QUIZ | typeof BlockType.ASSIGNMENT,
  ): Promise<void> {
    const enrollment = await this.getStudentContext(tx, userId, courseId, true);
    const block = await tx.courseBlock.findUnique({
      where: { id: courseBlockId },
      select: { id: true, courseId: true, type: true },
    });

    if (!block) {
      throw new NotFoundException('Course block not found.');
    }

    if (block.courseId !== courseId || block.type !== expectedType) {
      throw new BadRequestException(
        'The assessment block does not belong to this enrollment course.',
      );
    }

    if (expectedType === BlockType.QUIZ) {
      const submittedAttempt = await tx.quizAttempt.findFirst({
        where: {
          enrollmentId: enrollment.id,
          courseBlockId,
          status: {
            in: [QuizAttemptStatus.SUBMITTED, QuizAttemptStatus.GRADED],
          },
        },
        select: { id: true },
      });

      if (!submittedAttempt) {
        throw new BadRequestException(
          'A submitted quiz attempt is required to complete this block.',
        );
      }
    } else {
      const submittedAssignment = await tx.assignmentSubmission.findFirst({
        where: {
          enrollmentId: enrollment.id,
          courseBlockId,
          status: {
            in: [AssignmentSubmissionStatus.SUBMITTED, AssignmentSubmissionStatus.GRADED],
          },
        },
        select: { id: true },
      });

      if (!submittedAssignment) {
        throw new BadRequestException('A submitted assignment is required to complete this block.');
      }
    }

    const existing = await tx.blockProgress.findUnique({
      where: {
        enrollmentId_courseBlockId: {
          enrollmentId: enrollment.id,
          courseBlockId,
        },
      },
      select: { completed: true },
    });

    if (existing?.completed) {
      return;
    }

    const now = new Date();
    await tx.blockProgress.upsert({
      where: {
        enrollmentId_courseBlockId: {
          enrollmentId: enrollment.id,
          courseBlockId,
        },
      },
      create: {
        enrollmentId: enrollment.id,
        courseBlockId,
        completed: true,
        completedAt: now,
      },
      update: {
        completed: true,
        completedAt: now,
      },
    });
  }

  private async getStudentContext(
    tx: Prisma.TransactionClient,
    userId: string,
    courseId: string,
    write: boolean,
  ) {
    const context = await this.enrollmentService.assertCanAccessCourse(userId, courseId, tx);

    if (write && context.status !== EnrollmentStatus.ACTIVE) {
      throw new ForbiddenException('Only ACTIVE enrollments can update progress.');
    }
    return context;
  }

  private async getProgressSnapshot(
    tx: Prisma.TransactionClient,
    courseId: string,
    enrollmentId: string,
  ) {
    const blocks = await tx.courseBlock.findMany({
      where: {
        courseId,
        type: {
          in: TRACKED_BLOCK_TYPES,
        },
      },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        type: true,
        title: true,
        position: true,
        parentModuleId: true,
        progressEntries: {
          where: {
            enrollmentId,
          },
          select: {
            completed: true,
            completedAt: true,
          },
        },
      },
    });

    const items = blocks.map((block) => {
      const progress = block.progressEntries[0];

      return {
        courseBlockId: block.id,
        type: block.type,
        title: block.title,
        position: block.position,
        parentModuleId: block.parentModuleId,
        completed: progress?.completed ?? false,
        completedAt: progress?.completedAt ?? null,
      };
    });

    const totalItems = items.length;

    const completedItems = items.filter((item) => item.completed).length;

    const quizzes = items.filter((item) => item.type === BlockType.QUIZ);

    const completedQuizzes = quizzes.filter((item) => item.completed).length;

    return {
      progress: {
        totalItems,
        completedItems,
        learningProgressPercentage: this.percentage(completedItems, totalItems),
        totalQuizzes: quizzes.length,
        completedQuizzes,
        quizCompletionPercentage: this.percentage(completedQuizzes, quizzes.length),
      },
      items,
    };
  }

  private percentage(completed: number, total: number): number {
    if (total === 0) {
      return 0;
    }

    return Math.round((completed / total) * 10_000) / 100;
  }

  private validateResumeData(blockType: BlockType, value: ResumeData): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('resumeData must be an object.');
    }

    if (value.version !== 1) {
      throw new BadRequestException('Unsupported resumeData version.');
    }

    if (value.type !== blockType) {
      throw new BadRequestException('resumeData type must match the CourseBlock type.');
    }

    if (!value.data || typeof value.data !== 'object' || Array.isArray(value.data)) {
      throw new BadRequestException('resumeData.data must be an object.');
    }
  }
}
