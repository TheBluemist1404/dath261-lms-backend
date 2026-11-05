// quiz-grading.service.spec.ts
import { describe, expect, it } from 'vitest';
import { QuestionType } from '../../generated/prisma/enums.js';
import {
  type GradableQuestion,
  QuizGradingService,
  type SubmittedAnswer,
} from './quiz-grading.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const buildOptions = (
  ...spec: Array<{ id: string; isCorrect: boolean }>
): GradableQuestion['options'] => spec;

const buildQuestion = (
  overrides: Partial<GradableQuestion> & Pick<GradableQuestion, 'id' | 'type'>,
): GradableQuestion => ({
  points: 1,
  acceptedAnswers: null,
  correctBoolean: null,
  options: [],
  ...overrides,
});

describe('QuizGradingService', () => {
  const service = new QuizGradingService();

  // -------------------------------------------------------------------------
  // SINGLE_CHOICE
  // -------------------------------------------------------------------------
  describe('SINGLE_CHOICE', () => {
    const question = buildQuestion({
      id: 'q1',
      type: QuestionType.SINGLE_CHOICE,
      points: 2,
      options: buildOptions(
        { id: 'o1', isCorrect: false },
        { id: 'o2', isCorrect: true },
        { id: 'o3', isCorrect: false },
      ),
    });

    it('awards full points for the correct option', () => {
      const score = service.gradeQuestion(question, {
        questionId: 'q1',
        selectedOptionIds: ['o2'],
      });
      expect(score).toBe(2);
    });

    it('awards 0 for a wrong option', () => {
      const score = service.gradeQuestion(question, {
        questionId: 'q1',
        selectedOptionIds: ['o1'],
      });
      expect(score).toBe(0);
    });

    it('awards 0 when more than one option is selected', () => {
      const score = service.gradeQuestion(question, {
        questionId: 'q1',
        selectedOptionIds: ['o2', 'o3'],
      });
      expect(score).toBe(0);
    });

    it('awards 0 when no option is selected', () => {
      const score = service.gradeQuestion(question, {
        questionId: 'q1',
        selectedOptionIds: [],
      });
      expect(score).toBe(0);
    });

    it('awards 0 when the payload is missing', () => {
      const score = service.gradeQuestion(question, { questionId: 'q1' });
      expect(score).toBe(0);
    });

    it('awards 0 when the question has no correct option configured', () => {
      const broken = buildQuestion({
        id: 'q1',
        type: QuestionType.SINGLE_CHOICE,
        points: 2,
        options: buildOptions({ id: 'o1', isCorrect: false }, { id: 'o2', isCorrect: false }),
      });
      const score = service.gradeQuestion(broken, {
        questionId: 'q1',
        selectedOptionIds: ['o1'],
      });
      expect(score).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // MULTIPLE_CHOICE (all-or-nothing)
  // -------------------------------------------------------------------------
  describe('MULTIPLE_CHOICE', () => {
    const question = buildQuestion({
      id: 'q2',
      type: QuestionType.MULTIPLE_CHOICE,
      points: 3,
      options: buildOptions(
        { id: 'o1', isCorrect: true },
        { id: 'o2', isCorrect: false },
        { id: 'o3', isCorrect: true },
        { id: 'o4', isCorrect: false },
      ),
    });

    it('awards full points when the selected set exactly matches the correct set', () => {
      const score = service.gradeQuestion(question, {
        questionId: 'q2',
        selectedOptionIds: ['o1', 'o3'],
      });
      expect(score).toBe(3);
    });

    it('awards full points regardless of selection order', () => {
      const score = service.gradeQuestion(question, {
        questionId: 'q2',
        selectedOptionIds: ['o3', 'o1'],
      });
      expect(score).toBe(3);
    });

    it('awards full points when correct options are duplicated in the payload (set semantics)', () => {
      const score = service.gradeQuestion(question, {
        questionId: 'q2',
        selectedOptionIds: ['o1', 'o3', 'o1'],
      });
      expect(score).toBe(3);
    });

    it('awards 0 when the Student misses one correct option', () => {
      const score = service.gradeQuestion(question, {
        questionId: 'q2',
        selectedOptionIds: ['o1'],
      });
      expect(score).toBe(0);
    });

    it('awards 0 when the Student picks an extra wrong option', () => {
      const score = service.gradeQuestion(question, {
        questionId: 'q2',
        selectedOptionIds: ['o1', 'o3', 'o2'],
      });
      expect(score).toBe(0);
    });

    it('awards 0 when the Student picks only wrong options', () => {
      const score = service.gradeQuestion(question, {
        questionId: 'q2',
        selectedOptionIds: ['o2', 'o4'],
      });
      expect(score).toBe(0);
    });

    it('awards 0 when no option is selected', () => {
      const score = service.gradeQuestion(question, {
        questionId: 'q2',
        selectedOptionIds: [],
      });
      expect(score).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // TRUE_FALSE
  // -------------------------------------------------------------------------
  describe('TRUE_FALSE', () => {
    const question = buildQuestion({
      id: 'q3',
      type: QuestionType.TRUE_FALSE,
      points: 1,
      correctBoolean: true,
    });

    it('awards full points when the boolean matches', () => {
      expect(service.gradeQuestion(question, { questionId: 'q3', booleanAnswer: true })).toBe(1);
    });

    it('awards 0 when the boolean differs', () => {
      expect(service.gradeQuestion(question, { questionId: 'q3', booleanAnswer: false })).toBe(0);
    });

    it('awards 0 when the boolean is missing', () => {
      expect(service.gradeQuestion(question, { questionId: 'q3' })).toBe(0);
    });

    it('awards 0 when the question has no correctBoolean configured', () => {
      const broken = buildQuestion({
        id: 'q3',
        type: QuestionType.TRUE_FALSE,
        points: 1,
        correctBoolean: null,
      });
      expect(service.gradeQuestion(broken, { questionId: 'q3', booleanAnswer: true })).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // FILL_IN_BLANK
  // -------------------------------------------------------------------------
  describe('FILL_IN_BLANK', () => {
    const question = buildQuestion({
      id: 'q4',
      type: QuestionType.FILL_IN_BLANK,
      points: 2,
      acceptedAnswers: ['Paris', 'paris', 'PARIS'],
    });

    it('awards full points for an exact match', () => {
      expect(service.gradeQuestion(question, { questionId: 'q4', textAnswer: 'Paris' })).toBe(2);
    });

    it('awards full points for a case-insensitive match', () => {
      expect(service.gradeQuestion(question, { questionId: 'q4', textAnswer: 'pArIs' })).toBe(2);
    });

    it('awards full points after trimming whitespace', () => {
      expect(service.gradeQuestion(question, { questionId: 'q4', textAnswer: '  Paris  ' })).toBe(
        2,
      );
    });

    it('awards 0 for an empty/whitespace-only answer', () => {
      expect(service.gradeQuestion(question, { questionId: 'q4', textAnswer: '   ' })).toBe(0);
      expect(service.gradeQuestion(question, { questionId: 'q4', textAnswer: '' })).toBe(0);
    });

    it('awards 0 for a different answer', () => {
      expect(service.gradeQuestion(question, { questionId: 'q4', textAnswer: 'London' })).toBe(0);
    });

    it('preserves internal whitespace (does not collapse)', () => {
      const q = buildQuestion({
        id: 'q5',
        type: QuestionType.FILL_IN_BLANK,
        points: 1,
        acceptedAnswers: ['New York'],
      });
      expect(service.gradeQuestion(q, { questionId: 'q5', textAnswer: 'New  York' })).toBe(0);
    });

    it('awards 0 when no accepted answers are configured', () => {
      const broken = buildQuestion({
        id: 'q4',
        type: QuestionType.FILL_IN_BLANK,
        points: 2,
        acceptedAnswers: [],
      });
      expect(service.gradeQuestion(broken, { questionId: 'q4', textAnswer: 'Paris' })).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // gradeAttempt (aggregation)
  // -------------------------------------------------------------------------
  describe('gradeAttempt', () => {
    it('returns score 0 and no per-question results for an empty question list', () => {
      const result = service.gradeAttempt([], []);
      expect(result.score).toBe(0);
      expect(result.totalPoints).toBe(0);
      expect(result.earnedPoints).toBe(0);
      expect(result.perQuestion).toEqual([]);
    });

    it('aggregates earned points across mixed question types and normalizes score to 0..100', () => {
      const questions: GradableQuestion[] = [
        buildQuestion({
          id: 'q1',
          type: QuestionType.SINGLE_CHOICE,
          points: 1,
          options: buildOptions({ id: 'o1', isCorrect: true }, { id: 'o2', isCorrect: false }),
        }),
        buildQuestion({
          id: 'q2',
          type: QuestionType.TRUE_FALSE,
          points: 2,
          correctBoolean: false,
        }),
        buildQuestion({
          id: 'q3',
          type: QuestionType.FILL_IN_BLANK,
          points: 1,
          acceptedAnswers: ['Answer'],
        }),
      ];
      const answers: SubmittedAnswer[] = [
        { questionId: 'q1', selectedOptionIds: ['o1'] }, // +1
        { questionId: 'q2', booleanAnswer: false }, // +2
        { questionId: 'q3', textAnswer: 'wrong' }, // 0
      ];

      const result = service.gradeAttempt(questions, answers);

      expect(result.totalPoints).toBe(4);
      expect(result.earnedPoints).toBe(3);
      // 3 / 4 * 100 = 75
      expect(result.score).toBe(75);
      expect(result.perQuestion).toHaveLength(3);
      expect(result.perQuestion.map((r) => r.isCorrect)).toEqual([true, true, false]);
      expect(result.perQuestion.map((r) => r.earnedPoints)).toEqual([1, 2, 0]);
    });

    it('treats missing answers as 0 points but still returns a result entry per question', () => {
      const questions: GradableQuestion[] = [
        buildQuestion({
          id: 'q1',
          type: QuestionType.TRUE_FALSE,
          points: 1,
          correctBoolean: true,
        }),
        buildQuestion({
          id: 'q2',
          type: QuestionType.TRUE_FALSE,
          points: 1,
          correctBoolean: false,
        }),
      ];
      const answers: SubmittedAnswer[] = [
        { questionId: 'q1', booleanAnswer: true }, // +1
        // q2 not answered
      ];

      const result = service.gradeAttempt(questions, answers);

      expect(result.totalPoints).toBe(2);
      expect(result.earnedPoints).toBe(1);
      expect(result.score).toBe(50);
      expect(result.perQuestion).toEqual([
        {
          questionId: 'q1',
          type: QuestionType.TRUE_FALSE,
          points: 1,
          earnedPoints: 1,
          isCorrect: true,
        },
        {
          questionId: 'q2',
          type: QuestionType.TRUE_FALSE,
          points: 1,
          earnedPoints: 0,
          isCorrect: false,
        },
      ]);
    });

    it('ignores answers for unknown question IDs', () => {
      const questions: GradableQuestion[] = [
        buildQuestion({
          id: 'q1',
          type: QuestionType.TRUE_FALSE,
          points: 1,
          correctBoolean: true,
        }),
      ];
      const answers: SubmittedAnswer[] = [
        { questionId: 'q1', booleanAnswer: true },
        { questionId: 'ghost', booleanAnswer: false },
      ];

      const result = service.gradeAttempt(questions, answers);

      expect(result.earnedPoints).toBe(1);
      expect(result.totalPoints).toBe(1);
      expect(result.score).toBe(100);
    });

    it('returns score 100 when everything is correct', () => {
      const questions: GradableQuestion[] = [
        buildQuestion({
          id: 'q1',
          type: QuestionType.SINGLE_CHOICE,
          points: 1,
          options: buildOptions({ id: 'o1', isCorrect: true }),
        }),
      ];
      const result = service.gradeAttempt(questions, [
        { questionId: 'q1', selectedOptionIds: ['o1'] },
      ]);
      expect(result.score).toBe(100);
    });

    it('returns score 0 when everything is wrong', () => {
      const questions: GradableQuestion[] = [
        buildQuestion({
          id: 'q1',
          type: QuestionType.TRUE_FALSE,
          points: 1,
          correctBoolean: true,
        }),
      ];
      const result = service.gradeAttempt(questions, [{ questionId: 'q1', booleanAnswer: false }]);
      expect(result.score).toBe(0);
    });

    it('rounds HALF_UP to 2 decimals (2/3 → 66.67)', () => {
      const questions: GradableQuestion[] = [
        buildQuestion({ id: 'q1', type: QuestionType.TRUE_FALSE, points: 1, correctBoolean: true }),
        buildQuestion({ id: 'q2', type: QuestionType.TRUE_FALSE, points: 1, correctBoolean: true }),
        buildQuestion({ id: 'q3', type: QuestionType.TRUE_FALSE, points: 1, correctBoolean: true }),
      ];
      const answers: SubmittedAnswer[] = [
        { questionId: 'q1', booleanAnswer: true },
        { questionId: 'q2', booleanAnswer: true },
        { questionId: 'q3', booleanAnswer: false },
      ];

      const result = service.gradeAttempt(questions, answers);

      // 2/3 * 100 = 66.666... → 66.67
      expect(result.score).toBe(66.67);
    });

    it('is deterministic: same input yields the same output', () => {
      const questions: GradableQuestion[] = [
        buildQuestion({
          id: 'q1',
          type: QuestionType.MULTIPLE_CHOICE,
          points: 2,
          options: buildOptions(
            { id: 'o1', isCorrect: true },
            { id: 'o2', isCorrect: true },
            { id: 'o3', isCorrect: false },
          ),
        }),
      ];
      const answers: SubmittedAnswer[] = [{ questionId: 'q1', selectedOptionIds: ['o2', 'o1'] }];

      const first = service.gradeAttempt(questions, answers);
      const second = service.gradeAttempt(questions, answers);

      expect(second).toEqual(first);
    });

    it('awards 0 to a question whose points are 0 or negative', () => {
      const questions: GradableQuestion[] = [
        buildQuestion({
          id: 'q1',
          type: QuestionType.TRUE_FALSE,
          points: 0,
          correctBoolean: true,
        }),
      ];
      const result = service.gradeAttempt(questions, [{ questionId: 'q1', booleanAnswer: true }]);
      expect(result.earnedPoints).toBe(0);
      expect(result.score).toBe(0);
    });
  });
});
