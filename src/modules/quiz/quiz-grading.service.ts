// quiz-grading.service.ts
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { QuestionType } from '../../generated/prisma/enums.js';

/**
 * Shape of a question as needed by the grader.
 * Decoupled from Prisma types so the grader is a pure function
 * (easy to unit-test without DB).
 */
export interface GradableOption {
  id: string;
  isCorrect: boolean;
}

export interface GradableQuestion {
  id: string;
  type: QuestionType;
  points: number; // already converted from Decimal
  acceptedAnswers: string[] | null; // for FILL_IN_BLANK
  correctBoolean: boolean | null; // for TRUE_FALSE
  options: GradableOption[]; // for SINGLE_CHOICE / MULTIPLE_CHOICE
}

/**
 * One answer submitted by a Student for one question.
 * Exactly one of the payload fields is expected to be set,
 * depending on question type.
 */
export interface SubmittedAnswer {
  questionId: string;
  selectedOptionIds?: string[]; // SINGLE_CHOICE (1) / MULTIPLE_CHOICE (N)
  textAnswer?: string; // FILL_IN_BLANK
  booleanAnswer?: boolean; // TRUE_FALSE
}

export interface QuestionGradingResult {
  questionId: string;
  type: QuestionType;
  points: number; // max points for this question
  earnedPoints: number; // 0..points
  isCorrect: boolean; // true only when earnedPoints === points
}

export interface AttemptGradingResult {
  score: number; // 0.00 .. 100.00, rounded HALF_UP 2 decimals
  totalPoints: number; // sum of all question points
  earnedPoints: number; // sum of earned points
  perQuestion: QuestionGradingResult[];
}

const SCORE_DECIMALS = 2;
const SCORE_MULTIPLIER = 100;

@Injectable()
export class QuizGradingService {
  /**
   * Grade a full attempt.
   *
   * - Every question in `questions` produces exactly one result entry,
   *   even when the Student did not answer it (treated as 0 points).
   * - `answers` may contain unknown question IDs; they are ignored.
   * - Score is normalized to 0..100 based on total possible points,
   *   rounded HALF_UP to 2 decimal places.
   * - If `questions` is empty, score is 0 and totalPoints is 0.
   */
  gradeAttempt(questions: GradableQuestion[], answers: SubmittedAnswer[]): AttemptGradingResult {
    const answerByQuestion = new Map<string, SubmittedAnswer>();
    for (const answer of answers) {
      if (answer && typeof answer.questionId === 'string') {
        answerByQuestion.set(answer.questionId, answer);
      }
    }

    let totalPoints = 0;
    let earnedPoints = 0;
    const perQuestion: QuestionGradingResult[] = [];

    for (const question of questions) {
      const points = this.toNumber(question.points);
      totalPoints += points;

      const answer = answerByQuestion.get(question.id);
      const earned = answer ? this.gradeQuestion(question, answer) : 0;

      earnedPoints += earned;

      perQuestion.push({
        questionId: question.id,
        type: question.type,
        points,
        earnedPoints: earned,
        isCorrect: points > 0 && earned === points,
      });
    }

    const rawScore = totalPoints > 0 ? (earnedPoints / totalPoints) * SCORE_MULTIPLIER : 0;

    return {
      score: this.roundHalfUp(rawScore, SCORE_DECIMALS),
      totalPoints,
      earnedPoints,
      perQuestion,
    };
  }

  /**
   * Grade one question.
   * Returns 0 if the answer payload does not match the question type,
   * or if the submitted value is missing/invalid.
   */
  gradeQuestion(question: GradableQuestion, answer: SubmittedAnswer): number {
    const points = this.toNumber(question.points);

    if (points <= 0) {
      return 0;
    }

    switch (question.type) {
      case QuestionType.SINGLE_CHOICE:
        return this.gradeSingleChoice(question, answer, points);
      case QuestionType.MULTIPLE_CHOICE:
        return this.gradeMultipleChoice(question, answer, points);
      case QuestionType.TRUE_FALSE:
        return this.gradeTrueFalse(question, answer, points);
      case QuestionType.FILL_IN_BLANK:
        return this.gradeFillInBlank(question, answer, points);
      default:
        return 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Per-type grading
  // ---------------------------------------------------------------------------

  private gradeSingleChoice(
    question: GradableQuestion,
    answer: SubmittedAnswer,
    points: number,
  ): number {
    const selected = answer.selectedOptionIds ?? [];
    if (selected.length !== 1) {
      return 0;
    }

    const correctOption = question.options.find((option) => option.isCorrect);
    if (!correctOption) {
      return 0;
    }

    return selected[0] === correctOption.id ? points : 0;
  }

  private gradeMultipleChoice(
    question: GradableQuestion,
    answer: SubmittedAnswer,
    points: number,
  ): number {
    const selected = answer.selectedOptionIds ?? [];
    // All-or-nothing: the selected set must exactly equal the set of correct options.
    // Duplicates in the submitted array are collapsed (set semantics).
    const selectedSet = new Set(selected);
    const correctSet = new Set(
      question.options.filter((option) => option.isCorrect).map((option) => option.id),
    );

    if (selectedSet.size !== correctSet.size) {
      return 0;
    }

    for (const id of selectedSet) {
      if (!correctSet.has(id)) {
        return 0;
      }
    }

    return points;
  }

  private gradeTrueFalse(
    question: GradableQuestion,
    answer: SubmittedAnswer,
    points: number,
  ): number {
    if (typeof answer.booleanAnswer !== 'boolean') {
      return 0;
    }

    if (typeof question.correctBoolean !== 'boolean') {
      return 0;
    }

    return answer.booleanAnswer === question.correctBoolean ? points : 0;
  }

  private gradeFillInBlank(
    question: GradableQuestion,
    answer: SubmittedAnswer,
    points: number,
  ): number {
    if (typeof answer.textAnswer !== 'string') {
      return 0;
    }

    const accepted = question.acceptedAnswers ?? [];
    if (accepted.length === 0) {
      return 0;
    }

    const submitted = this.normalizeText(answer.textAnswer);
    if (submitted.length === 0) {
      return 0;
    }

    const isMatch = accepted.some((candidate) => this.normalizeText(candidate) === submitted);

    return isMatch ? points : 0;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Fill-in-the-blank normalization:
   * - trim leading/trailing whitespace
   * - lowercase (case-insensitive match)
   * Internal whitespace is preserved (a Student typing "New  York" with two
   * spaces is a different answer than "New York").
   */
  private normalizeText(value: string): string {
    return value.trim().toLowerCase();
  }

  /**
   * Prisma Decimal is exposed as a Decimal instance; callers may pass
   * number | string | Decimal-like. `Number(value)` handles all of them.
   */
  private toNumber(value: Prisma.Decimal | number | string): number {
    if (typeof value === 'number') {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    // Prisma.Decimal instance.
    const parsed = Number(value.toString());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  /**
   * Round HALF_UP to `decimals` places.
   * `Number.EPSILON` guards against binary floating-point drift
   * (e.g. 1.005 * 100 = 100.49999999999999).
   */
  private roundHalfUp(value: number, decimals: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }

    const factor = 10 ** decimals;
    const shifted = value * factor;
    const rounded = Math.round(shifted + Number.EPSILON);

    return rounded / factor;
  }
}
