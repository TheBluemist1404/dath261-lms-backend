// create-course.dto.spec.ts
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CreateCourseDto } from './create-course.dto.js';

describe('CreateCourseDto validation', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  const transform = (value: unknown) =>
    pipe.transform(value, { type: 'body', metatype: CreateCourseDto });

  it('accepts a minimal payload with only title', async () => {
    const dto = await transform({ title: 'Course' });

    expect(dto.title).toBe('Course');
    expect(dto.description).toBeUndefined();
    expect(dto.prerequisites).toBeUndefined();
    expect(dto.enrollmentStartAt).toBeUndefined();
    expect(dto.enrollmentEndAt).toBeUndefined();
  });

  it('accepts a full payload and preserves optional values', async () => {
    const dto = await transform({
      title: 'Course',
      description: 'Desc',
      prerequisites: 'Pre',
      enrollmentStartAt: '2026-01-01T00:00:00.000Z',
      enrollmentEndAt: '2026-02-01T00:00:00.000Z',
    });

    expect(dto.description).toBe('Desc');
    expect(dto.prerequisites).toBe('Pre');
    expect(dto.enrollmentStartAt).toBe('2026-01-01T00:00:00.000Z');
    expect(dto.enrollmentEndAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('allows enrollment dates to be null (explicit clear)', async () => {
    const dto = await transform({
      title: 'Course',
      enrollmentStartAt: null,
      enrollmentEndAt: null,
    });

    expect(dto.enrollmentStartAt).toBeNull();
    expect(dto.enrollmentEndAt).toBeNull();
  });

  it('rejects missing title', async () => {
    await expect(transform({})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects empty title', async () => {
    await expect(transform({ title: '' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-string title', async () => {
    await expect(transform({ title: 42 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-string description', async () => {
    await expect(transform({ title: 'Course', description: 42 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it.each([
    'not-a-date',
    '2026-13-01T00:00:00.000Z', // invalid month
    123,
    true,
    {},
  ])('rejects invalid enrollmentStartAt: %j', async (value) => {
    await expect(transform({ title: 'Course', enrollmentStartAt: value })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects unknown extra fields (forbidNonWhitelisted)', async () => {
    await expect(transform({ title: 'Course', hacker: 'injected' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
