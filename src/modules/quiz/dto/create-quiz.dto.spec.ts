// create-quiz.dto.spec.ts
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { QuestionType, QuizScoringMode } from '../../../generated/prisma/enums.js';
import { CreateQuizDto } from './create-quiz.dto.js';

describe('CreateQuizDto validation', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  const transform = (value: unknown) =>
    pipe.transform(value, { type: 'body', metatype: CreateQuizDto });

  const buildSingleChoiceQuestion = (overrides: Record<string, unknown> = {}) => ({
    type: QuestionType.SINGLE_CHOICE,
    text: 'Capital of France?',
    options: [
      { text: 'Paris', isCorrect: true },
      { text: 'London', isCorrect: false },
    ],
    ...overrides,
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------
  it('accepts a minimal payload (title + 1 single-choice question)', async () => {
    const dto = await transform({
      title: 'Quiz',
      questions: [buildSingleChoiceQuestion()],
    });

    expect(dto.title).toBe('Quiz');
    expect(dto.maxAttempts).toBeUndefined();
    expect(dto.scoringMode).toBeUndefined();
    expect(dto.allowLate).toBeUndefined();
    expect(dto.questions).toHaveLength(1);
    expect(dto.questions[0].type).toBe(QuestionType.SINGLE_CHOICE);
  });

  it('accepts a full payload with all question types', async () => {
    const dto = await transform({
      title: 'Full Quiz',
      maxAttempts: 3,
      scoringMode: QuizScoringMode.AVERAGE,
      availableFrom: '2026-01-01T00:00:00.000Z',
      deadline: '2026-02-01T00:00:00.000Z',
      allowLate: true,
      questions: [
        buildSingleChoiceQuestion(),
        {
          type: QuestionType.MULTIPLE_CHOICE,
          text: 'Which are OOP?',
          points: 2,
          options: [
            { text: 'Java', isCorrect: true },
            { text: 'Python', isCorrect: true },
            { text: 'C', isCorrect: false },
          ],
        },
        { type: QuestionType.TRUE_FALSE, text: 'HTTP is stateless', correctBoolean: true },
        {
          type: QuestionType.FILL_IN_BLANK,
          text: '1 + 1 = ___',
          acceptedAnswers: ['2', 'two'],
        },
      ],
    });

    expect(dto.questions).toHaveLength(4);
    expect(dto.maxAttempts).toBe(3);
    expect(dto.scoringMode).toBe(QuizScoringMode.AVERAGE);
    expect(dto.allowLate).toBe(true);
  });

  // -------------------------------------------------------------------------
  // title
  // -------------------------------------------------------------------------
  it('rejects missing title', async () => {
    await expect(transform({ questions: [buildSingleChoiceQuestion()] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects empty title', async () => {
    await expect(
      transform({ title: '', questions: [buildSingleChoiceQuestion()] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // -------------------------------------------------------------------------
  // maxAttempts
  // -------------------------------------------------------------------------
  it('rejects maxAttempts = 0', async () => {
    await expect(
      transform({ title: 'Quiz', maxAttempts: 0, questions: [buildSingleChoiceQuestion()] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-integer maxAttempts', async () => {
    await expect(
      transform({ title: 'Quiz', maxAttempts: 1.5, questions: [buildSingleChoiceQuestion()] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // -------------------------------------------------------------------------
  // scoringMode
  // -------------------------------------------------------------------------
  it('rejects unknown scoringMode', async () => {
    await expect(
      transform({
        title: 'Quiz',
        scoringMode: 'BOGUS',
        questions: [buildSingleChoiceQuestion()],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // -------------------------------------------------------------------------
  // dates
  // -------------------------------------------------------------------------
  it('rejects invalid availableFrom', async () => {
    await expect(
      transform({
        title: 'Quiz',
        availableFrom: 'not-a-date',
        questions: [buildSingleChoiceQuestion()],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts null availableFrom and null deadline', async () => {
    const dto = await transform({
      title: 'Quiz',
      availableFrom: null,
      deadline: null,
      questions: [buildSingleChoiceQuestion()],
    });
    expect(dto.availableFrom).toBeNull();
    expect(dto.deadline).toBeNull();
  });

  // -------------------------------------------------------------------------
  // questions[]
  // -------------------------------------------------------------------------
  it('rejects empty questions array', async () => {
    await expect(transform({ title: 'Quiz', questions: [] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a question with unknown type', async () => {
    await expect(
      transform({
        title: 'Quiz',
        questions: [{ type: 'ESSAY', text: 'x', options: [] }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects SINGLE_CHOICE with fewer than 2 options', async () => {
    await expect(
      transform({
        title: 'Quiz',
        questions: [
          {
            type: QuestionType.SINGLE_CHOICE,
            text: 'Q',
            options: [{ text: 'only-one', isCorrect: true }],
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects TRUE_FALSE without correctBoolean', async () => {
    await expect(
      transform({
        title: 'Quiz',
        questions: [{ type: QuestionType.TRUE_FALSE, text: 'Q' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects FILL_IN_BLANK without acceptedAnswers', async () => {
    await expect(
      transform({
        title: 'Quiz',
        questions: [{ type: QuestionType.FILL_IN_BLANK, text: 'Q' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects FILL_IN_BLANK with empty acceptedAnswers', async () => {
    await expect(
      transform({
        title: 'Quiz',
        questions: [{ type: QuestionType.FILL_IN_BLANK, text: 'Q', acceptedAnswers: [] }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects duplicate acceptedAnswers', async () => {
    await expect(
      transform({
        title: 'Quiz',
        questions: [
          { type: QuestionType.FILL_IN_BLANK, text: 'Q', acceptedAnswers: ['Paris', 'Paris'] },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a negative points value', async () => {
    await expect(
      transform({
        title: 'Quiz',
        questions: [buildSingleChoiceQuestion({ points: -1 })],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // -------------------------------------------------------------------------
  // whitelist
  // -------------------------------------------------------------------------
  it('rejects unknown extra fields at root', async () => {
    await expect(
      transform({
        title: 'Quiz',
        questions: [buildSingleChoiceQuestion()],
        hacker: 'injected',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unknown extra fields inside a question', async () => {
    await expect(
      transform({
        title: 'Quiz',
        questions: [buildSingleChoiceQuestion({ hacker: 'injected' })],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
