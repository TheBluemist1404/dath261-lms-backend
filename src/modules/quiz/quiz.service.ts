// quiz.service.ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  BlockType,
  QuestionType,
  QuizAttemptStatus,
  QuizScoringMode,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { EnrollmentService } from '../enrollments/enrollment.service.js';
import { CreateQuizDto } from './dto/create-quiz.dto.js';
import { PaginatedQuizAttemptResponseDto } from './dto/paginated-quiz-attempt-response.dto.js';
import { QuizAttemptDetailResponseDto } from './dto/quiz-attempt-detail-response.dto.js';
import { QuizAttemptListQueryDto } from './dto/quiz-attempt-list-query.dto.js';
import {
  QuizAttemptResponseDto,
  StudentAttemptAnswerResultDto,
} from './dto/quiz-attempt-response.dto.js';
import { QuizQuestionInputDto } from './dto/quiz-question-input.dto.js';
import { QuizQuestionResponseDto, QuizResponseDto } from './dto/quiz-response.dto.js';
import {
  QuizStudentResponseDto,
  StudentQuizQuestionResponseDto,
} from './dto/quiz-student-response.dto.js';
import { SubmitAnswerDto, SubmitQuizAttemptDto } from './dto/submit-quiz-attempt.dto.js';
import { UpdateQuizConfigDto } from './dto/update-quiz-config.dto.js';
import {
  type AttemptGradingResult,
  type GradableQuestion,
  QuizGradingService,
  type SubmittedAnswer,
} from './quiz-grading.service.js';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

/**
 * Prisma include used when loading a quiz definition for either view.
 */
const quizDefinitionInclude = {
  quizConfig: true,
  quizQuestions: {
    orderBy: { position: 'asc' },
    include: {
      options: { orderBy: { position: 'asc' } },
    },
  },
} satisfies Prisma.CourseBlockInclude;

type QuizDefinitionBlock = Prisma.CourseBlockGetPayload<{
  include: typeof quizDefinitionInclude;
}>;

@Injectable()
export class QuizService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enrollmentService: EnrollmentService,
    private readonly gradingService: QuizGradingService,
  ) {}

  // ---------------------------------------------------------------------------
  // Lecturer — authoring
  // ---------------------------------------------------------------------------

  async createQuiz(
    courseId: string,
    lecturerId: string,
    dto: CreateQuizDto,
  ): Promise<QuizResponseDto> {
    await this.checkCourseOwnership(courseId, lecturerId);

    this.assertValidQuestions(dto.questions);
    const availableFrom = dto.availableFrom ? new Date(dto.availableFrom) : null;
    const deadline = dto.deadline ? new Date(dto.deadline) : null;
    this.assertValidWindow(availableFrom, deadline);

    const created = await this.prisma.$transaction(async (tx) => {
      const position = await this.nextBlockPosition(tx, courseId, null);

      const block = await tx.courseBlock.create({
        data: {
          courseId,
          type: BlockType.QUIZ,
          title: dto.title,
          position,
          parentModuleId: null,
          quizConfig: {
            create: {
              maxAttempts: dto.maxAttempts ?? 1,
              scoringMode: dto.scoringMode ?? QuizScoringMode.HIGHEST,
              availableFrom,
              deadline,
              allowLate: dto.allowLate ?? false,
            },
          },
          quizQuestions: {
            create: dto.questions.map((question, index) => ({
              type: question.type,
              text: question.text,
              points: question.points ?? 1,
              position: index,
              acceptedAnswers:
                question.type === QuestionType.FILL_IN_BLANK
                  ? (question.acceptedAnswers as Prisma.InputJsonValue)
                  : undefined,
              correctBoolean:
                question.type === QuestionType.TRUE_FALSE ? question.correctBoolean : undefined,
              options:
                question.options && question.options.length > 0
                  ? {
                      create: question.options.map((option, optionIndex) => ({
                        text: option.text,
                        isCorrect: option.isCorrect,
                        position: optionIndex,
                      })),
                    }
                  : undefined,
            })),
          },
        },
        include: quizDefinitionInclude,
      });

      return block;
    });

    return this.toLecturerQuizResponse(created);
  }

  async getQuizForLecturer(
    courseId: string,
    blockId: string,
    lecturerId: string,
  ): Promise<QuizResponseDto> {
    await this.checkCourseOwnership(courseId, lecturerId);
    const block = await this.loadQuizBlock(courseId, blockId);
    return this.toLecturerQuizResponse(block);
  }

  async updateConfig(
    courseId: string,
    blockId: string,
    lecturerId: string,
    dto: UpdateQuizConfigDto,
  ): Promise<QuizResponseDto> {
    await this.checkCourseOwnership(courseId, lecturerId);
    const block = await this.loadQuizBlock(courseId, blockId);

    const currentConfig = block.quizConfig;
    if (!currentConfig) {
      throw new NotFoundException('Quiz config not found.');
    }

    const nextAvailableFrom =
      dto.availableFrom !== undefined
        ? dto.availableFrom
          ? new Date(dto.availableFrom)
          : null
        : currentConfig.availableFrom;
    const nextDeadline =
      dto.deadline !== undefined
        ? dto.deadline
          ? new Date(dto.deadline)
          : null
        : currentConfig.deadline;

    this.assertValidWindow(nextAvailableFrom, nextDeadline);

    const updated = await this.prisma.courseBlock.update({
      where: { id: blockId },
      data: {
        quizConfig: {
          update: {
            ...(dto.maxAttempts !== undefined && { maxAttempts: dto.maxAttempts }),
            ...(dto.scoringMode !== undefined && { scoringMode: dto.scoringMode }),
            ...(dto.availableFrom !== undefined && { availableFrom: nextAvailableFrom }),
            ...(dto.deadline !== undefined && { deadline: nextDeadline }),
            ...(dto.allowLate !== undefined && { allowLate: dto.allowLate }),
          },
        },
      },
      include: quizDefinitionInclude,
    });

    return this.toLecturerQuizResponse(updated);
  }

  async replaceQuestions(
    courseId: string,
    blockId: string,
    lecturerId: string,
    questions: QuizQuestionInputDto[],
  ): Promise<QuizResponseDto> {
    await this.checkCourseOwnership(courseId, lecturerId);
    await this.loadQuizBlock(courseId, blockId);

    this.assertValidQuestions(questions);

    const updated = await this.prisma.$transaction(async (tx) => {
      // Replace-all: delete existing questions (cascade removes options).
      await tx.quizQuestion.deleteMany({ where: { courseBlockId: blockId } });

      await tx.quizQuestion.createMany({
        data: questions.map((question, index) => ({
          courseBlockId: blockId,
          type: question.type,
          text: question.text,
          points: question.points ?? 1,
          position: index,
          acceptedAnswers:
            question.type === QuestionType.FILL_IN_BLANK
              ? (question.acceptedAnswers as Prisma.InputJsonValue)
              : undefined,
          correctBoolean:
            question.type === QuestionType.TRUE_FALSE ? question.correctBoolean : undefined,
        })),
      });

      // Options must be created per-question because we need question IDs.
      // Re-fetch questions to map position -> id.
      const createdQuestions = await tx.quizQuestion.findMany({
        where: { courseBlockId: blockId },
        orderBy: { position: 'asc' },
        select: { id: true, position: true },
      });

      for (let i = 0; i < questions.length; i++) {
        const input = questions[i];
        if (!input.options || input.options.length === 0) {
          continue;
        }
        const created = createdQuestions.find((q) => q.position === i);
        if (!created) {
          continue;
        }
        await tx.quizOption.createMany({
          data: input.options.map((option, optionIndex) => ({
            questionId: created.id,
            text: option.text,
            isCorrect: option.isCorrect,
            position: optionIndex,
          })),
        });
      }

      return tx.courseBlock.findUniqueOrThrow({
        where: { id: blockId },
        include: quizDefinitionInclude,
      });
    });

    return this.toLecturerQuizResponse(updated);
  }

  async releaseResults(
    courseId: string,
    blockId: string,
    lecturerId: string,
  ): Promise<QuizResponseDto> {
    await this.checkCourseOwnership(courseId, lecturerId);
    const block = await this.loadQuizBlock(courseId, blockId);

    if (!block.quizConfig) {
      throw new NotFoundException('Quiz config not found.');
    }

    const updated = await this.prisma.courseBlock.update({
      where: { id: blockId },
      data: {
        quizConfig: {
          update: {
            resultsReleasedAt: block.quizConfig.resultsReleasedAt ?? new Date(),
          },
        },
      },
      include: quizDefinitionInclude,
    });

    return this.toLecturerQuizResponse(updated);
  }

  // ---------------------------------------------------------------------------
  // Student — taking
  // ---------------------------------------------------------------------------

  async getQuizForStudent(
    courseId: string,
    blockId: string,
    userId: string,
  ): Promise<QuizStudentResponseDto> {
    await this.enrollmentService.assertCanAccessCourse(userId, courseId);

    const block = await this.loadQuizBlock(courseId, blockId);
    const config = block.quizConfig;
    if (!config) {
      throw new NotFoundException('Quiz config not found.');
    }

    const now = new Date();
    if (config.availableFrom && now < config.availableFrom) {
      throw new ForbiddenException('Quiz is not available yet.');
    }

    return this.toStudentQuizResponse(block);
  }

  async submitAttempt(
    courseId: string,
    blockId: string,
    userId: string,
    dto: SubmitQuizAttemptDto,
  ): Promise<QuizAttemptResponseDto> {
    const enrollment = await this.enrollmentService.assertCanAccessCourse(userId, courseId);
    const block = await this.loadQuizBlock(courseId, blockId);

    const config = block.quizConfig;
    if (!config) {
      throw new NotFoundException('Quiz config not found.');
    }

    const now = new Date();

    if (config.availableFrom && now < config.availableFrom) {
      throw new ForbiddenException('Quiz is not available yet.');
    }

    const isLate = config.deadline !== null && now > config.deadline;
    if (isLate && !config.allowLate) {
      throw new ForbiddenException('The deadline has passed and late submissions are not allowed.');
    }

    // Enforce attempt limit using the attempt counter inside a transaction
    // to avoid races that could exceed maxAttempts.
    const attempt = await this.prisma.$transaction(async (tx) => {
      const count = await tx.quizAttempt.count({
        where: { enrollmentId: enrollment.id, courseBlockId: blockId },
      });

      if (count >= config.maxAttempts) {
        throw new ConflictException(
          `Maximum number of attempts (${config.maxAttempts}) has been reached.`,
        );
      }

      const grading = this.gradeSubmit(block, dto.answers);

      return tx.quizAttempt.create({
        data: {
          enrollmentId: enrollment.id,
          courseBlockId: blockId,
          attemptNumber: count + 1,
          status: QuizAttemptStatus.SUBMITTED,
          answers: dto.answers as unknown as Prisma.InputJsonValue,
          score: grading.score,
          startedAt: now,
          submittedAt: now,
          gradedAt: now,
          isLate,
        },
      });
    });

    return this.toStudentAttemptResponse(
      attempt,
      block.quizConfig?.resultsReleasedAt ?? null,
      block,
    );
  }

  async listMyAttempts(
    courseId: string,
    blockId: string,
    userId: string,
    query: QuizAttemptListQueryDto,
  ): Promise<PaginatedQuizAttemptResponseDto> {
    const enrollment = await this.enrollmentService.assertCanAccessCourse(userId, courseId);
    const block = await this.loadQuizBlock(courseId, blockId);

    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const skip = (page - 1) * limit;

    const [total, attempts] = await Promise.all([
      this.prisma.quizAttempt.count({
        where: { enrollmentId: enrollment.id, courseBlockId: blockId },
      }),
      this.prisma.quizAttempt.findMany({
        where: { enrollmentId: enrollment.id, courseBlockId: blockId },
        orderBy: { attemptNumber: 'desc' },
        skip,
        take: limit,
        include: {
          enrollment: {
            select: {
              user: { select: { id: true, email: true, firstName: true, lastName: true } },
            },
          },
        },
      }),
    ]);

    const totalPages = Math.ceil(total / limit) || 0;

    return {
      data: attempts.map((attempt) => this.toLecturerAttemptDetailResponse(attempt, block)),
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };
  }

  async getMyLatestAttempt(
    courseId: string,
    blockId: string,
    userId: string,
  ): Promise<QuizAttemptResponseDto | null> {
    const enrollment = await this.enrollmentService.assertCanAccessCourse(userId, courseId);
    const block = await this.loadQuizBlock(courseId, blockId);

    const attempt = await this.prisma.quizAttempt.findFirst({
      where: { enrollmentId: enrollment.id, courseBlockId: blockId },
      orderBy: { attemptNumber: 'desc' },
    });

    if (!attempt) {
      return null;
    }

    return this.toStudentAttemptResponse(
      attempt,
      block.quizConfig?.resultsReleasedAt ?? null,
      block,
    );
  }

  // ---------------------------------------------------------------------------
  // Lecturer — inspect attempts
  // ---------------------------------------------------------------------------

  async listAttemptsForLecturer(
    courseId: string,
    blockId: string,
    lecturerId: string,
    query: QuizAttemptListQueryDto,
  ): Promise<PaginatedQuizAttemptResponseDto> {
    await this.checkCourseOwnership(courseId, lecturerId);
    const block = await this.loadQuizBlock(courseId, blockId);

    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const skip = (page - 1) * limit;

    const [total, attempts] = await Promise.all([
      this.prisma.quizAttempt.count({ where: { courseBlockId: blockId } }),
      this.prisma.quizAttempt.findMany({
        where: { courseBlockId: blockId },
        orderBy: [{ submittedAt: 'desc' }, { attemptNumber: 'desc' }],
        skip,
        take: limit,
        include: {
          enrollment: {
            select: {
              user: { select: { id: true, email: true, firstName: true, lastName: true } },
            },
          },
        },
      }),
    ]);

    const totalPages = Math.ceil(total / limit) || 0;

    return {
      data: attempts.map((attempt) => this.toLecturerAttemptDetailResponse(attempt, block)),
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };
  }

  async getAttemptForLecturer(
    courseId: string,
    blockId: string,
    attemptId: string,
    lecturerId: string,
  ): Promise<QuizAttemptDetailResponseDto> {
    await this.checkCourseOwnership(courseId, lecturerId);
    const block = await this.loadQuizBlock(courseId, blockId);

    const attempt = await this.prisma.quizAttempt.findFirst({
      where: { id: attemptId, courseBlockId: blockId },
      include: {
        enrollment: {
          select: {
            user: { select: { id: true, email: true, firstName: true, lastName: true } },
          },
        },
      },
    });

    if (!attempt) {
      throw new NotFoundException('Attempt not found.');
    }

    return this.toLecturerAttemptDetailResponse(attempt, block);
  }

  // ---------------------------------------------------------------------------
  // Ownership / existence helpers
  // ---------------------------------------------------------------------------

  private async checkCourseOwnership(courseId: string, lecturerId: string) {
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

  private async loadQuizBlock(courseId: string, blockId: string): Promise<QuizDefinitionBlock> {
    const block = await this.prisma.courseBlock.findFirst({
      where: { id: blockId, courseId },
      include: quizDefinitionInclude,
    });

    if (!block) {
      throw new NotFoundException('Quiz not found.');
    }

    if (block.type !== BlockType.QUIZ) {
      throw new NotFoundException('Quiz not found.');
    }

    return block;
  }

  private async nextBlockPosition(
    tx: Prisma.TransactionClient,
    courseId: string,
    parentModuleId: string | null,
  ): Promise<number> {
    const aggregate = await tx.courseBlock.aggregate({
      where: { courseId, parentModuleId },
      _max: { position: true },
    });
    return (aggregate._max.position ?? -1) + 1;
  }

  // ---------------------------------------------------------------------------
  // Validation helpers
  // ---------------------------------------------------------------------------

  private assertValidQuestions(questions: QuizQuestionInputDto[]): void {
    if (!questions || questions.length === 0) {
      throw new BadRequestException('Quiz must contain at least one question.');
    }

    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      this.assertValidQuestion(question, i);
    }
  }

  private assertValidQuestion(question: QuizQuestionInputDto, index: number): void {
    const where = `questions[${index}]`;

    if (question.type === QuestionType.SINGLE_CHOICE) {
      if (!question.options || question.options.length < 2) {
        throw new BadRequestException(`${where}: SINGLE_CHOICE requires at least 2 options.`);
      }
      const correctCount = question.options.filter((o) => o.isCorrect).length;
      if (correctCount !== 1) {
        throw new BadRequestException(
          `${where}: SINGLE_CHOICE requires exactly one correct option.`,
        );
      }
      if (question.correctBoolean !== undefined) {
        throw new BadRequestException(`${where}: correctBoolean is not allowed for this type.`);
      }
      if (question.acceptedAnswers !== undefined) {
        throw new BadRequestException(`${where}: acceptedAnswers is not allowed for this type.`);
      }
      return;
    }

    if (question.type === QuestionType.MULTIPLE_CHOICE) {
      if (!question.options || question.options.length < 2) {
        throw new BadRequestException(`${where}: MULTIPLE_CHOICE requires at least 2 options.`);
      }
      const correctCount = question.options.filter((o) => o.isCorrect).length;
      if (correctCount < 1) {
        throw new BadRequestException(
          `${where}: MULTIPLE_CHOICE requires at least one correct option.`,
        );
      }
      if (question.correctBoolean !== undefined) {
        throw new BadRequestException(`${where}: correctBoolean is not allowed for this type.`);
      }
      if (question.acceptedAnswers !== undefined) {
        throw new BadRequestException(`${where}: acceptedAnswers is not allowed for this type.`);
      }
      return;
    }

    if (question.type === QuestionType.TRUE_FALSE) {
      if (typeof question.correctBoolean !== 'boolean') {
        throw new BadRequestException(`${where}: TRUE_FALSE requires correctBoolean.`);
      }
      if (question.options !== undefined) {
        throw new BadRequestException(`${where}: options are not allowed for TRUE_FALSE.`);
      }
      if (question.acceptedAnswers !== undefined) {
        throw new BadRequestException(`${where}: acceptedAnswers is not allowed for this type.`);
      }
      return;
    }

    if (question.type === QuestionType.FILL_IN_BLANK) {
      if (!question.acceptedAnswers || question.acceptedAnswers.length === 0) {
        throw new BadRequestException(
          `${where}: FILL_IN_BLANK requires at least one accepted answer.`,
        );
      }
      if (question.options !== undefined) {
        throw new BadRequestException(`${where}: options are not allowed for FILL_IN_BLANK.`);
      }
      if (question.correctBoolean !== undefined) {
        throw new BadRequestException(`${where}: correctBoolean is not allowed for this type.`);
      }
      return;
    }
  }

  private assertValidWindow(availableFrom: Date | null, deadline: Date | null): void {
    if (!availableFrom || !deadline) {
      return;
    }
    if (availableFrom >= deadline) {
      throw new BadRequestException('availableFrom must be before deadline.');
    }
  }

  // ---------------------------------------------------------------------------
  // Grading
  // ---------------------------------------------------------------------------

  private gradeSubmit(
    block: QuizDefinitionBlock,
    answers: SubmitAnswerDto[],
  ): AttemptGradingResult {
    const questions: GradableQuestion[] = block.quizQuestions.map((q) => ({
      id: q.id,
      type: q.type,
      points: Number(q.points),
      acceptedAnswers: Array.isArray(q.acceptedAnswers) ? (q.acceptedAnswers as string[]) : null,
      correctBoolean: q.correctBoolean ?? null,
      options: q.options.map((o) => ({ id: o.id, isCorrect: o.isCorrect })),
    }));

    const submitted: SubmittedAnswer[] = answers.map((a) => ({
      questionId: a.questionId,
      selectedOptionIds: a.selectedOptionIds,
      textAnswer: a.textAnswer,
      booleanAnswer: a.booleanAnswer,
    }));

    return this.gradingService.gradeAttempt(questions, submitted);
  }

  // ---------------------------------------------------------------------------
  // Response mapping
  // ---------------------------------------------------------------------------

  private toLecturerQuizResponse(block: QuizDefinitionBlock): QuizResponseDto {
    const config = block.quizConfig;
    if (!config) {
      throw new NotFoundException('Quiz config not found.');
    }

    return {
      id: block.id,
      courseId: block.courseId,
      title: block.title,
      maxAttempts: config.maxAttempts,
      scoringMode: config.scoringMode,
      availableFrom: config.availableFrom,
      deadline: config.deadline,
      allowLate: config.allowLate,
      resultsReleasedAt: config.resultsReleasedAt,
      questions: block.quizQuestions.map((question) => this.toLecturerQuestionResponse(question)),
      createdAt: block.createdAt,
      updatedAt: block.updatedAt,
    };
  }

  private toLecturerQuestionResponse(
    question: QuizDefinitionBlock['quizQuestions'][number],
  ): QuizQuestionResponseDto {
    return {
      id: question.id,
      type: question.type,
      text: question.text,
      points: Number(question.points),
      position: question.position,
      options:
        question.type === QuestionType.SINGLE_CHOICE ||
        question.type === QuestionType.MULTIPLE_CHOICE
          ? question.options.map((o) => ({
              id: o.id,
              text: o.text,
              isCorrect: o.isCorrect,
              position: o.position,
            }))
          : null,
      correctBoolean:
        question.type === QuestionType.TRUE_FALSE ? (question.correctBoolean ?? null) : null,
      acceptedAnswers:
        question.type === QuestionType.FILL_IN_BLANK
          ? Array.isArray(question.acceptedAnswers)
            ? (question.acceptedAnswers as string[])
            : []
          : null,
    };
  }

  private toStudentQuizResponse(block: QuizDefinitionBlock): QuizStudentResponseDto {
    const config = block.quizConfig;
    if (!config) {
      throw new NotFoundException('Quiz config not found.');
    }

    return {
      id: block.id,
      courseId: block.courseId,
      title: block.title,
      maxAttempts: config.maxAttempts,
      scoringMode: config.scoringMode,
      availableFrom: config.availableFrom,
      deadline: config.deadline,
      allowLate: config.allowLate,
      resultsReleasedAt: config.resultsReleasedAt,
      questions: block.quizQuestions.map((question) => this.toStudentQuestionResponse(question)),
    };
  }

  private toStudentQuestionResponse(
    question: QuizDefinitionBlock['quizQuestions'][number],
  ): StudentQuizQuestionResponseDto {
    // Deliberately strip correctBoolean, acceptedAnswers, isCorrect.
    return {
      id: question.id,
      type: question.type,
      text: question.text,
      points: Number(question.points),
      position: question.position,
      options:
        question.type === QuestionType.SINGLE_CHOICE ||
        question.type === QuestionType.MULTIPLE_CHOICE
          ? question.options.map((o) => ({
              id: o.id,
              text: o.text,
              position: o.position,
            }))
          : null,
    };
  }

  private toStudentAttemptResponse(
    attempt: Prisma.QuizAttemptGetPayload<object>,
    resultsReleasedAt: Date | null,
    block: QuizDefinitionBlock,
  ): QuizAttemptResponseDto {
    const released = resultsReleasedAt !== null;

    return {
      id: attempt.id,
      courseBlockId: attempt.courseBlockId,
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      score: attempt.score !== null ? Number(attempt.score) : null,
      isLate: attempt.isLate,
      submittedAt: attempt.submittedAt,
      resultsReleased: released,
      answers: released ? this.buildStudentAnswerResults(attempt, block) : null,
    };
  }

  private toLecturerAttemptDetailResponse(
    attempt: Prisma.QuizAttemptGetPayload<{
      include: {
        enrollment: {
          select: {
            user: { select: { id: true; email: true; firstName: true; lastName: true } };
          };
        };
      };
    }>,
    block: QuizDefinitionBlock,
  ): QuizAttemptDetailResponseDto {
    return {
      id: attempt.id,
      courseBlockId: attempt.courseBlockId,
      enrollmentId: attempt.enrollmentId,
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      score: attempt.score !== null ? Number(attempt.score) : null,
      isLate: attempt.isLate,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      gradedAt: attempt.gradedAt,
      student: {
        userId: attempt.enrollment.user.id,
        email: attempt.enrollment.user.email,
        firstName: attempt.enrollment.user.firstName,
        lastName: attempt.enrollment.user.lastName,
      },
      answers: this.buildStudentAnswerResults(attempt, block),
    };
  }

  private buildStudentAnswerResults(
    attempt: Prisma.QuizAttemptGetPayload<object>,
    block: QuizDefinitionBlock | null,
  ): StudentAttemptAnswerResultDto[] {
    const submittedAnswers = this.parseAnswersJson(attempt.answers);

    // Lecturer view has the block; student view (when released) needs the block too.
    // If no block was provided, return an empty array — a defensive fallback so we
    // never leak correct answers without context.
    if (!block) {
      return [];
    }

    // Recompute per-question grading against the snapshot answers.
    const questions: GradableQuestion[] = block.quizQuestions.map((q) => ({
      id: q.id,
      type: q.type,
      points: Number(q.points),
      acceptedAnswers: Array.isArray(q.acceptedAnswers) ? (q.acceptedAnswers as string[]) : null,
      correctBoolean: q.correctBoolean ?? null,
      options: q.options.map((o) => ({ id: o.id, isCorrect: o.isCorrect })),
    }));

    const submitted: SubmittedAnswer[] = submittedAnswers.map((a) => ({
      questionId: a.questionId,
      selectedOptionIds: a.selectedOptionIds,
      textAnswer: a.textAnswer,
      booleanAnswer: a.booleanAnswer,
    }));

    const grading = this.gradingService.gradeAttempt(questions, submitted);

    const answerByQuestion = new Map<string, SubmitAnswerDto>();
    for (const a of submittedAnswers) {
      answerByQuestion.set(a.questionId, a);
    }

    return grading.perQuestion.map((result) => {
      const question = block.quizQuestions.find((q) => q.id === result.questionId);
      const studentAnswer = answerByQuestion.get(result.questionId);
      return {
        questionId: result.questionId,
        points: result.points,
        earnedPoints: result.earnedPoints,
        isCorrect: result.isCorrect,
        correctAnswer: question ? this.extractCorrectAnswer(question) : null,
        studentAnswer: studentAnswer ?? null,
      };
    });
  }

  private parseAnswersJson(value: Prisma.JsonValue | null): SubmitAnswerDto[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value as unknown as SubmitAnswerDto[];
  }

  private extractCorrectAnswer(question: QuizDefinitionBlock['quizQuestions'][number]) {
    if (question.type === QuestionType.TRUE_FALSE) {
      return question.correctBoolean ?? null;
    }

    if (question.type === QuestionType.FILL_IN_BLANK) {
      return Array.isArray(question.acceptedAnswers) ? (question.acceptedAnswers as string[]) : [];
    }

    return question.options.filter((o) => o.isCorrect).map((o) => o.id);
  }
}
