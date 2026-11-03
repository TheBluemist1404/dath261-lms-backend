// update-course.dto.spec.ts
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { UpdateCourseDto } from './update-course.dto.js';

describe('UpdateCourseDto validation', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  const transform = (value: unknown) =>
    pipe.transform(value, { type: 'body', metatype: UpdateCourseDto });

  it('accepts an empty payload (all fields optional)', async () => {
    const dto = await transform({});

    expect(dto).toEqual({});
  });

  it('accepts partial updates of a single field', async () => {
    const dto = await transform({ title: 'New title' });

    expect(dto.title).toBe('New title');
    expect(dto.description).toBeUndefined();
    expect(dto.enrollmentStartAt).toBeUndefined();
  });

  it('preserves null to explicitly clear enrollment dates', async () => {
    const dto = await transform({ enrollmentEndAt: null });

    expect(dto.enrollmentEndAt).toBeNull();
  });

  it('keeps undefined when date is omitted (no change)', async () => {
    const dto = await transform({ title: 'New' });

    expect(dto.enrollmentEndAt).toBeUndefined();
  });

  it('rejects empty title when provided', async () => {
    await expect(transform({ title: '' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects invalid date format when provided', async () => {
    await expect(transform({ enrollmentStartAt: 'not-a-date' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects unknown extra fields', async () => {
    await expect(
      transform({ status: 'PUBLISHED' }), // status không nằm trong UpdateCourseDto
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
