// submit-quiz-attempt.dto.spec.ts
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { SubmitQuizAttemptDto } from './submit-quiz-attempt.dto.js';

describe('SubmitQuizAttemptDto validation', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  const transform = (value: unknown) =>
    pipe.transform(value, { type: 'body', metatype: SubmitQuizAttemptDto });

  it('accepts an empty answers array (submit without answering)', async () => {
    const dto = await transform({ answers: [] });
    expect(dto.answers).toEqual([]);
  });

  it('accepts a single-choice answer', async () => {
    const dto = await transform({
      answers: [{ questionId: 'q1', selectedOptionIds: ['o1'] }],
    });
    expect(dto.answers[0].selectedOptionIds).toEqual(['o1']);
  });

  it('accepts a multiple-choice answer', async () => {
    const dto = await transform({
      answers: [{ questionId: 'q1', selectedOptionIds: ['o1', 'o2'] }],
    });
    expect(dto.answers[0].selectedOptionIds).toEqual(['o1', 'o2']);
  });

  it('accepts a true/false answer', async () => {
    const dto = await transform({
      answers: [{ questionId: 'q1', booleanAnswer: true }],
    });
    expect(dto.answers[0].booleanAnswer).toBe(true);
  });

  it('accepts a fill-in-the-blank answer', async () => {
    const dto = await transform({
      answers: [{ questionId: 'q1', textAnswer: 'Paris' }],
    });
    expect(dto.answers[0].textAnswer).toBe('Paris');
  });

  it('rejects a missing answers field', async () => {
    await expect(transform({})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects answers that is not an array', async () => {
    await expect(transform({ answers: 'not-array' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an answer without questionId', async () => {
    await expect(transform({ answers: [{ selectedOptionIds: ['o1'] }] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects an answer with empty questionId', async () => {
    await expect(
      transform({ answers: [{ questionId: '', selectedOptionIds: ['o1'] }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects duplicate selectedOptionIds', async () => {
    await expect(
      transform({ answers: [{ questionId: 'q1', selectedOptionIds: ['o1', 'o1'] }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-string selectedOptionIds', async () => {
    await expect(
      transform({ answers: [{ questionId: 'q1', selectedOptionIds: [1, 2] }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-string textAnswer', async () => {
    await expect(
      transform({ answers: [{ questionId: 'q1', textAnswer: 123 }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-boolean booleanAnswer', async () => {
    await expect(
      transform({ answers: [{ questionId: 'q1', booleanAnswer: 'true' }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unknown extra fields inside an answer', async () => {
    await expect(
      transform({ answers: [{ questionId: 'q1', hacker: 'injected' }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
