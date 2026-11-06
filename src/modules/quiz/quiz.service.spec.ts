// quiz.service.spec.ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import {
  BlockType,
  QuestionType,
  QuizAttemptStatus,
  QuizScoringMode,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { EnrollmentService } from '../enrollments/enrollment.service.js';
import { CreateQuizDto } from './dto/create-quiz.dto.js';
import { QuizService } from './quiz.service.js';
import { QuizGradingService } from './quiz-grading.service.js';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------
const buildCourse = (overrides: Record<string, unknown> = {}) => ({
  id: 'course-1',
  lecturerId: 'lecturer-1',
  ...overrides,
});

const buildQuizBlock = (overrides: Record<string, unknown> = {}) => ({
  id: 'block-1',
  courseId: 'course-1',
  type: BlockType.QUIZ,
  title: 'Quiz',
  position: 0,
  parentModuleId: null,
  content: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  quizConfig: {
    id: 'cfg-1',
    courseBlockId: 'block-1',
    maxAttempts: 3,
    scoringMode: QuizScoringMode.HIGHEST,
    availableFrom: null,
    deadline: null,
    allowLate: false,
    resultsReleasedAt: null,
    metadata: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  },
  quizQuestions: [
    {
      id: 'q1',
      courseBlockId: 'block-1',
      type: QuestionType.TRUE_FALSE,
      text: 'HTTP is stateless?',
      points: 1,
      position: 0,
      acceptedAnswers: null,
      correctBoolean: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      options: [],
    },
  ],
  ...overrides,
});

const buildAttempt = (overrides: Record<string, unknown> = {}) => ({
  id: 'attempt-1',
  enrollmentId: 'enrollment-1',
  courseBlockId: 'block-1',
  attemptNumber: 1,
  status: QuizAttemptStatus.SUBMITTED,
  answers: [{ questionId: 'q1', booleanAnswer: true }],
  score: 100,
  startedAt: new Date('2026-01-01T00:00:00.000Z'),
  submittedAt: new Date('2026-01-01T00:00:00.000Z'),
  gradedAt: new Date('2026-01-01T00:00:00.000Z'),
  isLate: false,
  enrollment: {
    user: {
      id: 'student-1',
      email: 'student@example.com',
      firstName: 'A',
      lastName: 'B',
    },
  },
  ...overrides,
});

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------
const createMocks = () => {
  const mockPrisma = {
    course: { findUnique: vi.fn() },
    courseBlock: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      aggregate: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    quizQuestion: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(),
    },
    quizOption: { createMany: vi.fn() },
    quizAttempt: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  const mockEnrollment = {
    assertCanAccessCourse: vi.fn(),
  };

  return { mockPrisma, mockEnrollment };
};

describe('QuizService', () => {
  let service: QuizService;
  let mockPrisma: ReturnType<typeof createMocks>['mockPrisma'];
  let mockEnrollment: ReturnType<typeof createMocks>['mockEnrollment'];

  beforeEach(async () => {
    const mocks = createMocks();
    mockPrisma = mocks.mockPrisma;
    mockEnrollment = mocks.mockEnrollment;

    // Default $transaction:
    // - array form: resolve all
    // - callback form: call with mockPrisma as tx
    mockPrisma.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: unknown) => unknown)(mockPrisma);
      }
      return Promise.all(arg as Promise<unknown>[]);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuizService,
        QuizGradingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EnrollmentService, useValue: mockEnrollment },
      ],
    }).compile();

    service = module.get(QuizService);
    vi.clearAllMocks();

    // Re-register $transaction after clearAllMocks (clearAllMocks resets impl).
    mockPrisma.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: unknown) => unknown)(mockPrisma);
      }
      return Promise.all(arg as Promise<unknown>[]);
    });
  });

  // -------------------------------------------------------------------------
  // checkCourseOwnership (indirect)
  // -------------------------------------------------------------------------
  describe('ownership', () => {
    it('throws NotFoundException when course does not exist', async () => {
      mockPrisma.course.findUnique.mockResolvedValue(null);

      await expect(service.getQuizForLecturer('c', 'b', 'l')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when lecturer does not own the course', async () => {
      mockPrisma.course.findUnique.mockResolvedValue(buildCourse({ lecturerId: 'other' }));

      await expect(service.getQuizForLecturer('c', 'b', 'l')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('throws NotFoundException when quiz block does not exist', async () => {
      mockPrisma.course.findUnique.mockResolvedValue(buildCourse());
      mockPrisma.courseBlock.findFirst.mockResolvedValue(null);

      await expect(service.getQuizForLecturer('c', 'b', 'lecturer-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws NotFoundException when block is not a QUIZ', async () => {
      mockPrisma.course.findUnique.mockResolvedValue(buildCourse());
      mockPrisma.courseBlock.findFirst.mockResolvedValue(buildQuizBlock({ type: BlockType.TEXT }));

      await expect(service.getQuizForLecturer('c', 'b', 'lecturer-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // createQuiz
  // -------------------------------------------------------------------------
  describe('createQuiz', () => {
    const buildDto = (overrides: Partial<CreateQuizDto> = {}): CreateQuizDto =>
      ({
        title: 'Quiz',
        questions: [
          {
            type: QuestionType.TRUE_FALSE,
            text: 'Q',
            correctBoolean: true,
          },
        ],
        ...overrides,
      }) as CreateQuizDto;

    beforeEach(() => {
      mockPrisma.course.findUnique.mockResolvedValue(buildCourse());
      mockPrisma.courseBlock.aggregate.mockResolvedValue({ _max: { position: null } });
      mockPrisma.courseBlock.create.mockResolvedValue(buildQuizBlock());
    });

    it('creates a QUIZ block with config and questions', async () => {
      await service.createQuiz('course-1', 'lecturer-1', buildDto());

      const call = mockPrisma.courseBlock.create.mock.calls[0][0];
      expect(call.data.type).toBe(BlockType.QUIZ);
      expect(call.data.quizConfig.create.maxAttempts).toBe(1);
      expect(call.data.quizConfig.create.scoringMode).toBe(QuizScoringMode.HIGHEST);
      expect(call.data.quizQuestions.create).toHaveLength(1);
    });

    it('rejects an empty questions array', async () => {
      await expect(
        service.createQuiz('course-1', 'lecturer-1', buildDto({ questions: [] })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects SINGLE_CHOICE with no options', async () => {
      await expect(
        service.createQuiz(
          'course-1',
          'lecturer-1',
          buildDto({
            questions: [{ type: QuestionType.SINGLE_CHOICE, text: 'Q' } as never],
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects SINGLE_CHOICE with more than one correct option', async () => {
      await expect(
        service.createQuiz(
          'course-1',
          'lecturer-1',
          buildDto({
            questions: [
              {
                type: QuestionType.SINGLE_CHOICE,
                text: 'Q',
                options: [
                  { text: 'A', isCorrect: true },
                  { text: 'B', isCorrect: true },
                ],
              } as never,
            ],
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects MULTIPLE_CHOICE with zero correct options', async () => {
      await expect(
        service.createQuiz(
          'course-1',
          'lecturer-1',
          buildDto({
            questions: [
              {
                type: QuestionType.MULTIPLE_CHOICE,
                text: 'Q',
                options: [
                  { text: 'A', isCorrect: false },
                  { text: 'B', isCorrect: false },
                ],
              } as never,
            ],
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects TRUE_FALSE with options', async () => {
      await expect(
        service.createQuiz(
          'course-1',
          'lecturer-1',
          buildDto({
            questions: [
              {
                type: QuestionType.TRUE_FALSE,
                text: 'Q',
                correctBoolean: true,
                options: [
                  { text: 'A', isCorrect: true },
                  { text: 'B', isCorrect: false },
                ],
              } as never,
            ],
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects FILL_IN_BLANK with no acceptedAnswers', async () => {
      await expect(
        service.createQuiz(
          'course-1',
          'lecturer-1',
          buildDto({
            questions: [{ type: QuestionType.FILL_IN_BLANK, text: 'Q' } as never],
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects availableFrom >= deadline', async () => {
      await expect(
        service.createQuiz(
          'course-1',
          'lecturer-1',
          buildDto({
            availableFrom: '2026-02-01T00:00:00.000Z',
            deadline: '2026-01-01T00:00:00.000Z',
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // -------------------------------------------------------------------------
  // getQuizForStudent — no answer key leak
  // -------------------------------------------------------------------------
  describe('getQuizForStudent', () => {
    beforeEach(() => {
      mockPrisma.courseBlock.findFirst.mockResolvedValue(buildQuizBlock());
      mockEnrollment.assertCanAccessCourse.mockResolvedValue({
        id: 'enrollment-1',
        status: 'ACTIVE',
      });
    });

    it('does not expose correctBoolean, acceptedAnswers, or isCorrect', async () => {
      const result = await service.getQuizForStudent('course-1', 'block-1', 'student-1');

      const question = result.questions[0] as unknown as Record<string, unknown>;
      expect(question).not.toHaveProperty('correctBoolean');
      expect(question).not.toHaveProperty('acceptedAnswers');
      expect(question.options).toBeNull();
    });

    it('strips isCorrect from options for SINGLE_CHOICE', async () => {
      mockPrisma.courseBlock.findFirst.mockResolvedValue(
        buildQuizBlock({
          quizQuestions: [
            {
              id: 'q1',
              courseBlockId: 'block-1',
              type: QuestionType.SINGLE_CHOICE,
              text: 'Q',
              points: 1,
              position: 0,
              acceptedAnswers: null,
              correctBoolean: null,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: new Date('2026-01-01T00:00:00.000Z'),
              options: [
                {
                  id: 'o1',
                  questionId: 'q1',
                  text: 'A',
                  isCorrect: true,
                  position: 0,
                },
                {
                  id: 'o2',
                  questionId: 'q1',
                  text: 'B',
                  isCorrect: false,
                  position: 1,
                },
              ],
            },
          ],
        }),
      );

      const result = await service.getQuizForStudent('course-1', 'block-1', 'student-1');
      const question = result.questions[0];

      expect(question.options).toHaveLength(2);
      expect(question.options?.[0]).not.toHaveProperty('isCorrect');
      expect(question.options?.[0]).toEqual({ id: 'o1', text: 'A', position: 0 });
    });

    it('calls assertCanAccessCourse', async () => {
      await service.getQuizForStudent('course-1', 'block-1', 'student-1');
      expect(mockEnrollment.assertCanAccessCourse).toHaveBeenCalledWith('student-1', 'course-1');
    });

    it('rejects when availableFrom is in the future', async () => {
      mockPrisma.courseBlock.findFirst.mockResolvedValue(
        buildQuizBlock({
          quizConfig: {
            ...buildQuizBlock().quizConfig,
            availableFrom: new Date('2099-01-01T00:00:00.000Z'),
          },
        }),
      );

      await expect(
        service.getQuizForStudent('course-1', 'block-1', 'student-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // -------------------------------------------------------------------------
  // submitAttempt
  // -------------------------------------------------------------------------
  describe('submitAttempt', () => {
    beforeEach(() => {
      mockPrisma.courseBlock.findFirst.mockResolvedValue(buildQuizBlock());
      mockEnrollment.assertCanAccessCourse.mockResolvedValue({
        id: 'enrollment-1',
        status: 'ACTIVE',
      });
      mockPrisma.quizAttempt.count.mockResolvedValue(0);
      mockPrisma.quizAttempt.create.mockResolvedValue(buildAttempt());
    });

    it('grades the attempt and stores score/submittedAt/gradedAt', async () => {
      await service.submitAttempt('course-1', 'block-1', 'student-1', {
        answers: [{ questionId: 'q1', booleanAnswer: true }],
      });

      const call = mockPrisma.quizAttempt.create.mock.calls[0][0];
      expect(call.data.score).toBe(100);
      expect(call.data.attemptNumber).toBe(1);
      expect(call.data.isLate).toBe(false);
      expect(call.data.status).toBe(QuizAttemptStatus.SUBMITTED);
      expect(call.data.submittedAt).toBeInstanceOf(Date);
      expect(call.data.gradedAt).toBeInstanceOf(Date);
    });

    it('rejects when attempt limit is reached', async () => {
      mockPrisma.quizAttempt.count.mockResolvedValue(3); // maxAttempts = 3

      await expect(
        service.submitAttempt('course-1', 'block-1', 'student-1', { answers: [] }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects when quiz is not yet available', async () => {
      mockPrisma.courseBlock.findFirst.mockResolvedValue(
        buildQuizBlock({
          quizConfig: {
            ...buildQuizBlock().quizConfig,
            availableFrom: new Date('2099-01-01T00:00:00.000Z'),
          },
        }),
      );

      await expect(
        service.submitAttempt('course-1', 'block-1', 'student-1', { answers: [] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects late submission when allowLate = false', async () => {
      mockPrisma.courseBlock.findFirst.mockResolvedValue(
        buildQuizBlock({
          quizConfig: {
            ...buildQuizBlock().quizConfig,
            deadline: new Date('2020-01-01T00:00:00.000Z'),
            allowLate: false,
          },
        }),
      );

      await expect(
        service.submitAttempt('course-1', 'block-1', 'student-1', { answers: [] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('accepts late submission and flags isLate = true when allowLate = true', async () => {
      mockPrisma.courseBlock.findFirst.mockResolvedValue(
        buildQuizBlock({
          quizConfig: {
            ...buildQuizBlock().quizConfig,
            deadline: new Date('2020-01-01T00:00:00.000Z'),
            allowLate: true,
          },
        }),
      );
      mockPrisma.quizAttempt.create.mockResolvedValue(buildAttempt({ isLate: true }));

      await service.submitAttempt('course-1', 'block-1', 'student-1', { answers: [] });

      const call = mockPrisma.quizAttempt.create.mock.calls[0][0];
      expect(call.data.isLate).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // getMyLatestAttempt — release gating
  // -------------------------------------------------------------------------
  describe('getMyLatestAttempt', () => {
    beforeEach(() => {
      mockEnrollment.assertCanAccessCourse.mockResolvedValue({
        id: 'enrollment-1',
        status: 'ACTIVE',
      });
      mockPrisma.courseBlock.findFirst.mockResolvedValue(buildQuizBlock());
      mockPrisma.quizAttempt.findFirst.mockResolvedValue(buildAttempt());
    });

    it('returns null when no attempt exists', async () => {
      mockPrisma.quizAttempt.findFirst.mockResolvedValue(null);

      const result = await service.getMyLatestAttempt('course-1', 'block-1', 'student-1');
      expect(result).toBeNull();
    });

    it('returns answers = null when results are not released', async () => {
      const result = await service.getMyLatestAttempt('course-1', 'block-1', 'student-1');

      expect(result?.resultsReleased).toBe(false);
      expect(result?.answers).toBeNull();
    });

    it('returns per-question results when results are released', async () => {
      mockPrisma.courseBlock.findFirst.mockResolvedValue(
        buildQuizBlock({
          quizConfig: {
            ...buildQuizBlock().quizConfig,
            resultsReleasedAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        }),
      );

      const result = await service.getMyLatestAttempt('course-1', 'block-1', 'student-1');

      expect(result?.resultsReleased).toBe(true);
      expect(result?.answers).toHaveLength(1);
      expect(result?.answers?.[0].isCorrect).toBe(true);
      expect(result?.answers?.[0].correctAnswer).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // listAttemptsForLecturer
  // -------------------------------------------------------------------------
  describe('listAttemptsForLecturer', () => {
    beforeEach(() => {
      mockPrisma.course.findUnique.mockResolvedValue(buildCourse());
      mockPrisma.courseBlock.findFirst.mockResolvedValue(buildQuizBlock());
    });

    it('returns paginated data with meta', async () => {
      mockPrisma.quizAttempt.count.mockResolvedValue(1);
      mockPrisma.quizAttempt.findMany.mockResolvedValue([buildAttempt()]);

      const result = await service.listAttemptsForLecturer('course-1', 'block-1', 'lecturer-1', {});

      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      });
      expect(result.data[0].student.email).toBe('student@example.com');
    });
  });

  // -------------------------------------------------------------------------
  // getAttemptForLecturer
  // -------------------------------------------------------------------------
  describe('getAttemptForLecturer', () => {
    beforeEach(() => {
      mockPrisma.course.findUnique.mockResolvedValue(buildCourse());
      mockPrisma.courseBlock.findFirst.mockResolvedValue(buildQuizBlock());
    });

    it('throws NotFoundException when attempt does not exist', async () => {
      mockPrisma.quizAttempt.findFirst.mockResolvedValue(null);

      await expect(
        service.getAttemptForLecturer('course-1', 'block-1', 'a', 'lecturer-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the full attempt detail with correct answers', async () => {
      mockPrisma.quizAttempt.findFirst.mockResolvedValue(buildAttempt());

      const result = await service.getAttemptForLecturer(
        'course-1',
        'block-1',
        'attempt-1',
        'lecturer-1',
      );

      expect(result.answers).toHaveLength(1);
      expect(result.answers[0].correctAnswer).toBe(true);
      expect(result.student.email).toBe('student@example.com');
    });
  });
});
