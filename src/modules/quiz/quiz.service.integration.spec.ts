// quiz.service.integration.spec.ts
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BlockType,
  CourseStatus,
  EnrollmentStatus,
  QuestionType,
  QuizAttemptStatus,
  QuizScoringMode,
  UserRole,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { EnrollmentService } from '../enrollments/enrollment.service.js';
import { QuizGradingService } from './quiz-grading.service.js';
import { QuizService } from './quiz.service.js';

const PREFIX = 'quiz-integration-';

describe('QuizService - integration', () => {
  let service: QuizService;
  let prisma: PrismaService;
  let moduleRef: TestingModule;

  let lecturer: { id: string };
  let otherLecturer: { id: string };
  let student: { id: string };
  let otherStudent: { id: string };
  let courseId: string;
  let enrollmentStudent: { id: string };
  let enrollmentOther: { id: string };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env',
        }),
      ],
      providers: [PrismaService, EnrollmentService, QuizService, QuizGradingService],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(QuizService);

    await prisma.$connect();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await moduleRef.close();
  });

  async function cleanup() {
    // Cascade order matters: attempts/submissions -> questions -> config -> blocks -> enrollments -> courses -> users.
    await prisma.quizAttempt.deleteMany({
      where: { enrollment: { course: { lecturer: { email: { startsWith: PREFIX } } } } },
    });

    await prisma.quizOption.deleteMany({
      where: { question: { courseBlock: { course: { lecturer: { email: { startsWith: PREFIX } } } } } },
    });

    await prisma.quizQuestion.deleteMany({
      where: { courseBlock: { course: { lecturer: { email: { startsWith: PREFIX } } } } },
    });

    await prisma.quizConfig.deleteMany({
      where: { courseBlock: { course: { lecturer: { email: { startsWith: PREFIX } } } } },
    });

    await prisma.courseBlock.deleteMany({
      where: { course: { lecturer: { email: { startsWith: PREFIX } } } },
    });

    await prisma.enrollment.deleteMany({
      where: {
        OR: [
          { course: { lecturer: { email: { startsWith: PREFIX } } } },
          { user: { email: { startsWith: PREFIX } } },
        ],
      },
    });

    await prisma.course.deleteMany({
      where: { lecturer: { email: { startsWith: PREFIX } } },
    });

    await prisma.user.deleteMany({
      where: { email: { startsWith: PREFIX } },
    });
  }

  beforeEach(async () => {
    await cleanup();

    lecturer = await prisma.user.create({
      data: {
        email: `${PREFIX}lecturer@example.com`,
        passwordHash: 'hash',
        firstName: 'Lec',
        lastName: 'One',
        role: UserRole.LECTURER,
      },
    });

    otherLecturer = await prisma.user.create({
      data: {
        email: `${PREFIX}lecturer-other@example.com`,
        passwordHash: 'hash',
        firstName: 'Lec',
        lastName: 'Two',
        role: UserRole.LECTURER,
      },
    });

    student = await prisma.user.create({
      data: {
        email: `${PREFIX}student@example.com`,
        passwordHash: 'hash',
        firstName: 'Stu',
        lastName: 'One',
        role: UserRole.STUDENT,
      },
    });

    otherStudent = await prisma.user.create({
      data: {
        email: `${PREFIX}student-other@example.com`,
        passwordHash: 'hash',
        firstName: 'Stu',
        lastName: 'Two',
        role: UserRole.STUDENT,
      },
    });

    const course = await prisma.course.create({
      data: {
        title: 'Integration Course',
        lecturerId: lecturer.id,
        status: CourseStatus.PUBLISHED,
      },
    });
    courseId = course.id;

    const e1 = await prisma.enrollment.create({
      data: { userId: student.id, courseId, status: EnrollmentStatus.ACTIVE },
    });
    enrollmentStudent = { id: e1.id };

    const e2 = await prisma.enrollment.create({
      data: { userId: otherStudent.id, courseId, status: EnrollmentStatus.ACTIVE },
    });
    enrollmentOther = { id: e2.id };
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const singleChoiceQuestion = (overrides: Record<string, unknown> = {}) => ({
    type: QuestionType.SINGLE_CHOICE,
    text: 'Capital of France?',
    points: 1,
    options: [
      { text: 'Paris', isCorrect: true },
      { text: 'London', isCorrect: false },
    ],
    ...overrides,
  });

  const trueFalseQuestion = (overrides: Record<string, unknown> = {}) => ({
    type: QuestionType.TRUE_FALSE,
    text: 'HTTP is stateless?',
    points: 1,
    correctBoolean: true,
    ...overrides,
  });

  const fillInQuestion = (overrides: Record<string, unknown> = {}) => ({
    type: QuestionType.FILL_IN_BLANK,
    text: '1+1 = ___',
    points: 2,
    acceptedAnswers: ['2', 'two'],
    ...overrides,
  });

  async function createQuiz(questions: unknown[] = [trueFalseQuestion()]) {
    return service.createQuiz(courseId, lecturer.id, {
      title: 'Midterm',
      maxAttempts: 3,
      scoringMode: QuizScoringMode.HIGHEST,
      questions: questions as never,
    });
  }

  // ===========================================================================
  // createQuiz
  // ===========================================================================
  describe('createQuiz', () => {
    it('creates a QUIZ block with config and questions in DB', async () => {
      const result = await createQuiz([
        singleChoiceQuestion(),
        trueFalseQuestion(),
        fillInQuestion(),
      ]);

      expect(result.id).toBeDefined();
      expect(result.questions).toHaveLength(3);

      const block = await prisma.courseBlock.findUniqueOrThrow({
        where: { id: result.id },
        include: {
          quizConfig: true,
          quizQuestions: { include: { options: true } },
        },
      });

      expect(block.type).toBe(BlockType.QUIZ);
      expect(block.quizConfig).not.toBeNull();
      expect(block.quizConfig?.maxAttempts).toBe(3);
      expect(block.quizConfig?.scoringMode).toBe(QuizScoringMode.HIGHEST);
      expect(block.quizQuestions).toHaveLength(3);

      const single = block.quizQuestions.find((q) => q.type === QuestionType.SINGLE_CHOICE);
      expect(single?.options).toHaveLength(2);
      expect(single?.options.filter((o) => o.isCorrect)).toHaveLength(1);
    });

    it('rejects when course does not belong to the lecturer', async () => {
      await expect(
        service.createQuiz(courseId, otherLecturer.id, {
          title: 'X',
          questions: [trueFalseQuestion()] as never,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects unknown course', async () => {
      await expect(
        service.createQuiz('nonexistent', lecturer.id, {
          title: 'X',
          questions: [trueFalseQuestion()] as never,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ===========================================================================
  // getQuizForStudent
  // ===========================================================================
  describe('getQuizForStudent', () => {
    it('does not leak answer keys to Students', async () => {
      const quiz = await createQuiz([
        singleChoiceQuestion(),
        trueFalseQuestion(),
        fillInQuestion(),
      ]);

      const result = await service.getQuizForStudent(courseId, quiz.id, student.id);

      const raw = JSON.stringify(result);
      expect(raw).not.toContain('isCorrect');
      expect(raw).not.toContain('correctBoolean');
      expect(raw).not.toContain('acceptedAnswers');
    });

    it('rejects a non-enrolled Student', async () => {
      const quiz = await createQuiz();
      const outsider = await prisma.user.create({
        data: {
          email: `${PREFIX}outsider@example.com`,
          passwordHash: 'hash',
          role: UserRole.STUDENT,
        },
      });

      await expect(
        service.getQuizForStudent(courseId, quiz.id, outsider.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ===========================================================================
  // submitAttempt — grading, attempt limit, deadline, late
  // ===========================================================================
  describe('submitAttempt', () => {
    it('grades a fully correct single-choice attempt with score 100', async () => {
      const quiz = await createQuiz([singleChoiceQuestion()]);
      const fetched = await service.getQuizForStudent(courseId, quiz.id, student.id);
      const q = fetched.questions[0];
      const correctOption = quiz.questions[0].options?.find((o) => o.isCorrect);

      const attempt = await service.submitAttempt(courseId, quiz.id, student.id, {
        answers: [{ questionId: q.id, selectedOptionIds: [correctOption!.id] }],
      });

      expect(attempt.score).toBe(100);
      expect(attempt.isLate).toBe(false);
      expect(attempt.status).toBe(QuizAttemptStatus.SUBMITTED);
      expect(attempt.answers).toBeNull(); // results not released yet

      const persisted = await prisma.quizAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      });
      expect(Number(persisted.score)).toBe(100);
      expect(persisted.submittedAt).not.toBeNull();
      expect(persisted.gradedAt).not.toBeNull();
    });

    it('grades a wrong answer with score 0', async () => {
      const quiz = await createQuiz([trueFalseQuestion()]);
      const q = quiz.questions[0];

      const attempt = await service.submitAttempt(courseId, quiz.id, student.id, {
        answers: [{ questionId: q.id, booleanAnswer: false }],
      });

      expect(attempt.score).toBe(0);
    });

    it('grades fill-in-the-blank case-insensitively after trimming', async () => {
      const quiz = await createQuiz([fillInQuestion()]);
      const q = quiz.questions[0];

      const attempt = await service.submitAttempt(courseId, quiz.id, student.id, {
        answers: [{ questionId: q.id, textAnswer: '  TWO  ' }],
      });

      expect(attempt.score).toBe(100);
    });

    it('grades multiple-choice all-or-nothing', async () => {
      const quiz = await createQuiz([
        {
          type: QuestionType.MULTIPLE_CHOICE,
          text: 'OOP?',
          points: 2,
          options: [
            { text: 'Java', isCorrect: true },
            { text: 'Python', isCorrect: true },
            { text: 'C', isCorrect: false },
          ],
        },
      ]);
      const q = quiz.questions[0];
      const correctIds = quiz.questions[0].options
        ?.filter((o) => o.isCorrect)
        .map((o) => o.id)!;

      // Wrong: missing one correct
      const partial = await service.submitAttempt(courseId, quiz.id, student.id, {
        answers: [{ questionId: q.id, selectedOptionIds: [correctIds[0]] }],
      });
      expect(partial.score).toBe(0);

      // Correct: exact set
      const full = await service.submitAttempt(courseId, quiz.id, student.id, {
        answers: [{ questionId: q.id, selectedOptionIds: correctIds }],
      });
      expect(full.score).toBe(100);
    });

    it('enforces attempt limit', async () => {
      const quiz = await createQuiz();
      const q = quiz.questions[0];

      for (let i = 0; i < 3; i++) {
        await service.submitAttempt(courseId, quiz.id, student.id, {
          answers: [{ questionId: q.id, booleanAnswer: true }],
        });
      }

      await expect(
        service.submitAttempt(courseId, quiz.id, student.id, {
          answers: [{ questionId: q.id, booleanAnswer: true }],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects when quiz is not yet available (availableFrom in future)', async () => {
      const quiz = await createQuiz();
      await prisma.quizConfig.update({
        where: { courseBlockId: quiz.id },
        data: { availableFrom: new Date('2099-01-01T00:00:00.000Z') },
      });

      await expect(
        service.submitAttempt(courseId, quiz.id, student.id, { answers: [] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects late submission when allowLate = false', async () => {
      const quiz = await createQuiz();
      await prisma.quizConfig.update({
        where: { courseBlockId: quiz.id },
        data: {
          deadline: new Date('2020-01-01T00:00:00.000Z'),
          allowLate: false,
        },
      });

      await expect(
        service.submitAttempt(courseId, quiz.id, student.id, { answers: [] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('accepts late submission when allowLate = true and flags isLate', async () => {
      const quiz = await createQuiz();
      const q = quiz.questions[0];
      await prisma.quizConfig.update({
        where: { courseBlockId: quiz.id },
        data: {
          deadline: new Date('2020-01-01T00:00:00.000Z'),
          allowLate: true,
        },
      });

      const attempt = await service.submitAttempt(courseId, quiz.id, student.id, {
        answers: [{ questionId: q.id, booleanAnswer: true }],
      });

      expect(attempt.isLate).toBe(true);

      const persisted = await prisma.quizAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      });
      expect(persisted.isLate).toBe(true);
    });

    it('rejects a non-enrolled Student', async () => {
      const quiz = await createQuiz();
      const outsider = await prisma.user.create({
        data: {
          email: `${PREFIX}outsider@example.com`,
          passwordHash: 'hash',
          role: UserRole.STUDENT,
        },
      });

      await expect(
        service.submitAttempt(courseId, quiz.id, outsider.id, { answers: [] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ===========================================================================
  // Attempt limit boundary — submit exactly at maxAttempts
  // ===========================================================================
  describe('attempt limit boundary', () => {
    it('allows exactly maxAttempts attempts', async () => {
      const quiz = await service.createQuiz(courseId, lecturer.id, {
        title: 'Limit',
        maxAttempts: 2,
        questions: [trueFalseQuestion()] as never,
      });
      const q = quiz.questions[0];

      const a1 = await service.submitAttempt(courseId, quiz.id, student.id, {
        answers: [{ questionId: q.id, booleanAnswer: true }],
      });
      expect(a1.attemptNumber).toBe(1);

      const a2 = await service.submitAttempt(courseId, quiz.id, student.id, {
        answers: [{ questionId: q.id, booleanAnswer: true }],
      });
      expect(a2.attemptNumber).toBe(2);

      await expect(
        service.submitAttempt(courseId, quiz.id, student.id, {
          answers: [{ questionId: q.id, booleanAnswer: true }],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ===========================================================================
  // getMyLatestAttempt — release gating
  // ===========================================================================
  describe('getMyLatestAttempt', () => {
    it('returns null when no attempt exists', async () => {
      const quiz = await createQuiz();
      const result = await service.getMyLatestAttempt(courseId, quiz.id, student.id);
      expect(result).toBeNull();
    });

    it('hides per-question results before release', async () => {
      const quiz = await createQuiz();
      const q = quiz.questions[0];

      await service.submitAttempt(courseId, quiz.id, student.id, {
        answers: [{ questionId: q.id, booleanAnswer: true }],
      });

      const result = await service.getMyLatestAttempt(courseId, quiz.id, student.id);
      expect(result?.resultsReleased).toBe(false);
      expect(result?.answers).toBeNull();
    });

    it('shows per-question results after release', async () => {
      const quiz = await createQuiz();
      const q = quiz.questions[0];

      await service.submitAttempt(courseId, quiz.id, student.id, {
        answers: [{ questionId: q.id, booleanAnswer: true }],
      });
      await service.releaseResults(courseId, quiz.id, lecturer.id);

      const result = await service.getMyLatestAttempt(courseId, quiz.id, student.id);
      expect(result?.resultsReleased).toBe(true);
      expect(result?.answers).toHaveLength(1);
      expect(result?.answers?.[0].isCorrect).toBe(true);
      expect(result?.answers?.[0].correctAnswer).toBe(true);
    });

    it('returns only the Student own latest attempt', async () => {
      const quiz = await createQuiz();
      const q = quiz.questions[0];

      await service.submitAttempt(courseId, quiz.id, student.id, {
        answers: [{ questionId: q.id, booleanAnswer: true }],
      });
      await service.submitAttempt(courseId, quiz.id, student.id, {
        answers: [{ questionId: q.id, booleanAnswer: false }],
      });

      const mine = await service.getMyLatestAttempt(courseId, quiz.id, student.id);
      expect(mine?.attemptNumber).toBe(2);

      const theirs = await service.getMyLatestAttempt(courseId, quiz.id, otherStudent.id);
      expect(theirs).toBeNull();
    });
  });

  // ===========================================================================
  // releaseResults
  // ===========================================================================
  describe('releaseResults', () => {
    it('sets resultsReleasedAt once and is idempotent', async () => {
      const quiz = await createQuiz();

      const r1 = await service.releaseResults(courseId, quiz.id, lecturer.id);
      expect(r1.resultsReleasedAt).toBeInstanceOf(Date);

      const r2 = await service.releaseResults(courseId, quiz.id, lecturer.id);
      expect(r2.resultsReleasedAt?.getTime()).toBe(r1.resultsReleasedAt?.getTime());
    });

    it('rejects a non-owner Lecturer', async () => {
      const quiz = await createQuiz();
      await expect(
        service.releaseResults(courseId, quiz.id, otherLecturer.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ===========================================================================
  // replaceQuestions
  // ===========================================================================
  describe('replaceQuestions', () => {
    it('replaces all existing questions and preserves existing attempts', async () => {
      const quiz = await createQuiz([trueFalseQuestion()]);
      const q = quiz.questions[0];

      // Submit an attempt against the original question
      const attempt = await service.submitAttempt(courseId, quiz.id, student.id, {
        answers: [{ questionId: q.id, booleanAnswer: true }],
      });
      expect(attempt.score).toBe(100);

      // Replace with a different question set
      const updated = await service.replaceQuestions(courseId, quiz.id, lecturer.id, [
        singleChoiceQuestion(),
        fillInQuestion(),
      ] as never);

      expect(updated.questions).toHaveLength(2);

      // Old attempt still readable with original score (snapshot of answers)
      const persisted = await prisma.quizAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      });
      expect(Number(persisted.score)).toBe(100);
    });
  });

  // ===========================================================================
  // listAttemptsForLecturer + getAttemptForLecturer
  // ===========================================================================
  describe('Lecturer inspection', () => {
    it('lists all attempts paginated with student info', async () => {
      const quiz = await createQuiz();
      const q = quiz.questions[0];

      await service.submitAttempt(courseId, quiz.id, student.id, {
        answers: [{ questionId: q.id, booleanAnswer: true }],
      });
      await service.submitAttempt(courseId, quiz.id, otherStudent.id, {
        answers: [{ questionId: q.id, booleanAnswer: false }],
      });

      const result = await service.listAttemptsForLecturer(
        courseId,
        quiz.id,
        lecturer.id,
        {},
      );

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
      const emails = result.data.map((a) => a.student.email).sort();
      expect(emails).toEqual(
        [`${PREFIX}student-other@example.com`, `${PREFIX}student@example.com`].sort(),
      );
    });

    it('returns full attempt detail with correct answers', async () => {
      const quiz = await createQuiz([trueFalseQuestion()]);
      const q = quiz.questions[0];

      const attempt = await service.submitAttempt(courseId, quiz.id, student.id, {
        answers: [{ questionId: q.id, booleanAnswer: true }],
      });

      const detail = await service.getAttemptForLecturer(
        courseId,
        quiz.id,
        attempt.id,
        lecturer.id,
      );

      expect(detail.answers).toHaveLength(1);
      expect(detail.answers[0].correctAnswer).toBe(true);
      expect(detail.student.userId).toBe(student.id);
    });

    it('rejects a non-owner Lecturer', async () => {
      const quiz = await createQuiz();
      await expect(
        service.listAttemptsForLecturer(courseId, quiz.id, otherLecturer.id, {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ===========================================================================
  // Authorization edge cases
  // ===========================================================================
  describe('authorization', () => {
    it('rejects a Student trying to read the Lecturer view', async () => {
      const quiz = await createQuiz();
      await expect(
        service.getQuizForLecturer(courseId, quiz.id, student.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects reading a non-existent course', async () => {
      await expect(
        service.getQuizForStudent('nonexistent', 'x', student.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a block that is not a QUIZ', async () => {
      const textBlock = await prisma.courseBlock.create({
        data: {
          courseId,
          type: BlockType.TEXT,
          title: 'Text',
          position: 0,
        },
      });

      await expect(
        service.getQuizForStudent(courseId, textBlock.id, student.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ===========================================================================
  // Aggregation across attempts — highest / latest / average
  // ===========================================================================
  describe('aggregation across attempts', () => {
    it('returns individual scores per attempt so callers can aggregate', async () => {
      // Note: aggregation modes (HIGHEST/LATEST/AVERAGE) are computed in the
      // consumer via the attempts list — this test verifies scores are persisted
      // correctly so aggregation can be applied deterministically.
      const quiz = await createQuiz([
        trueFalseQuestion({ points: 2 }),
        trueFalseQuestion({ text: 'Q2', points: 2, correctBoolean: true }),
      ]);
      const [q1, q2] = quiz.questions;

      // Attempt 1: 1/2 correct -> 50
      const a1 = await service.submitAttempt(courseId, quiz.id, student.id, {
        answers: [
          { questionId: q1.id, booleanAnswer: true },
          { questionId: q2.id, booleanAnswer: false },
        ],
      });
      expect(a1.score).toBe(50);

      // Attempt 2: 2/2 correct -> 100
      const a2 = await service.submitAttempt(courseId, quiz.id, student.id, {
        answers: [
          { questionId: q1.id, booleanAnswer: true },
          { questionId: q2.id, booleanAnswer: true },
        ],
      });
      expect(a2.score).toBe(100);

      // Attempt 3: 1/2 correct -> 50
      const a3 = await service.submitAttempt(courseId, quiz.id, student.id, {
        answers: [
          { questionId: q1.id, booleanAnswer: true },
          { questionId: q2.id, booleanAnswer: false },
        ],
      });
      expect(a3.score).toBe(50);

      const scores = [a1.score!, a2.score!, a3.score!];
      expect(Math.max(...scores)).toBe(100); // HIGHEST
      expect(scores[scores.length - 1]).toBe(50); // LATEST
      expect(scores.reduce((s, v) => s + v, 0) / scores.length).toBeCloseTo(66.67, 1); // AVERAGE
    });
  });
});