// course-query.dto.spec.ts
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CourseQueryDto } from './course-query.dto.js';

describe('CourseQueryDto validation', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  // Query params arrive as plain objects of string values.
  // The pipe transforms them using @Type(() => Number) where applicable.
  const transform = (value: unknown) =>
    pipe.transform(value, { type: 'query', metatype: CourseQueryDto });

  // -------------------------------------------------------------------------
  // Defaults / empty
  // -------------------------------------------------------------------------
  it('accepts an empty query and leaves all fields undefined', async () => {
    const dto = await transform({});

    expect(dto).toEqual({});
    expect(dto.search).toBeUndefined();
    expect(dto.lecturerId).toBeUndefined();
    expect(dto.enrollmentOpen).toBeUndefined();
    expect(dto.sortBy).toBeUndefined();
    expect(dto.sortOrder).toBeUndefined();
    expect(dto.page).toBeUndefined();
    expect(dto.limit).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // search
  // -------------------------------------------------------------------------
  it('accepts a string search', async () => {
    const dto = await transform({ search: 'nestjs' });
    expect(dto.search).toBe('nestjs');
  });

  it('rejects non-string search', async () => {
    await expect(transform({ search: 42 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects array search (repeated query param)', async () => {
    await expect(transform({ search: ['a', 'b'] })).rejects.toBeInstanceOf(BadRequestException);
  });

  // -------------------------------------------------------------------------
  // lecturerId
  // -------------------------------------------------------------------------
  it('accepts a string lecturerId', async () => {
    const dto = await transform({ lecturerId: 'clx789ghi' });
    expect(dto.lecturerId).toBe('clx789ghi');
  });

  it('rejects non-string lecturerId', async () => {
    await expect(transform({ lecturerId: 123 })).rejects.toBeInstanceOf(BadRequestException);
  });

  // -------------------------------------------------------------------------
  // enrollmentOpen
  // -------------------------------------------------------------------------
  it.each(['true', 'false'])('accepts enrollmentOpen=%s', async (value) => {
    const dto = await transform({ enrollmentOpen: value });
    expect(dto.enrollmentOpen).toBe(value);
  });

  it.each([
    'TRUE',
    'False',
    'yes',
    '1',
    '0',
    '',
    'maybe',
  ])('rejects enrollmentOpen=%j', async (value) => {
    await expect(transform({ enrollmentOpen: value })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects boolean true for enrollmentOpen (must be string)', async () => {
    // class-validator @IsIn(['true','false']) compares against strings; a real
    // boolean is not equal to 'true' string, so it must be rejected.
    await expect(transform({ enrollmentOpen: true })).rejects.toBeInstanceOf(BadRequestException);
  });

  // -------------------------------------------------------------------------
  // sortBy
  // -------------------------------------------------------------------------
  it.each(['createdAt', 'title', 'enrollmentStartAt'])('accepts sortBy=%s', async (value) => {
    const dto = await transform({ sortBy: value });
    expect(dto.sortBy).toBe(value);
  });

  it.each(['createdat', 'TITLE', 'description', 'id', ''])('rejects sortBy=%j', async (value) => {
    await expect(transform({ sortBy: value })).rejects.toBeInstanceOf(BadRequestException);
  });

  // -------------------------------------------------------------------------
  // sortOrder
  // -------------------------------------------------------------------------
  it.each(['asc', 'desc'])('accepts sortOrder=%s', async (value) => {
    const dto = await transform({ sortOrder: value });
    expect(dto.sortOrder).toBe(value);
  });

  it.each(['ASC', 'DESC', 'up', 'down', ''])('rejects sortOrder=%j', async (value) => {
    await expect(transform({ sortOrder: value })).rejects.toBeInstanceOf(BadRequestException);
  });

  // -------------------------------------------------------------------------
  // page
  // -------------------------------------------------------------------------
  it('transforms numeric-string page to number', async () => {
    const dto = await transform({ page: '5' });
    expect(dto.page).toBe(5);
    expect(typeof dto.page).toBe('number');
  });

  it('accepts page=1 (minimum boundary)', async () => {
    const dto = await transform({ page: '1' });
    expect(dto.page).toBe(1);
  });

  it('rejects page=0 (below minimum)', async () => {
    await expect(transform({ page: '0' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects negative page', async () => {
    await expect(transform({ page: '-1' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-integer page', async () => {
    await expect(transform({ page: '1.5' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-numeric page', async () => {
    await expect(transform({ page: 'abc' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects NaN-producing page', async () => {
    await expect(transform({ page: '1e' })).rejects.toBeInstanceOf(BadRequestException);
  });

  // -------------------------------------------------------------------------
  // limit
  // -------------------------------------------------------------------------
  it('transforms numeric-string limit to number', async () => {
    const dto = await transform({ limit: '10' });
    expect(dto.limit).toBe(10);
    expect(typeof dto.limit).toBe('number');
  });

  it('accepts limit=1 (minimum boundary)', async () => {
    const dto = await transform({ limit: '1' });
    expect(dto.limit).toBe(1);
  });

  it('accepts limit=100 (maximum boundary)', async () => {
    const dto = await transform({ limit: '100' });
    expect(dto.limit).toBe(100);
  });

  it('rejects limit=0 (below minimum)', async () => {
    await expect(transform({ limit: '0' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects limit=101 (above maximum)', async () => {
    await expect(transform({ limit: '101' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-integer limit', async () => {
    await expect(transform({ limit: '2.5' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-numeric limit', async () => {
    await expect(transform({ limit: 'abc' })).rejects.toBeInstanceOf(BadRequestException);
  });

  // -------------------------------------------------------------------------
  // Combined / whitelist
  // -------------------------------------------------------------------------
  it('accepts a full valid query with all fields', async () => {
    const dto = await transform({
      search: 'nestjs',
      lecturerId: 'clx789ghi',
      enrollmentOpen: 'true',
      sortBy: 'title',
      sortOrder: 'asc',
      page: '2',
      limit: '50',
    });

    expect(dto).toEqual({
      search: 'nestjs',
      lecturerId: 'clx789ghi',
      enrollmentOpen: 'true',
      sortBy: 'title',
      sortOrder: 'asc',
      page: 2,
      limit: 50,
    });
  });

  it('rejects unknown extra query fields (forbidNonWhitelisted)', async () => {
    await expect(transform({ hacker: 'injected' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unknown field even when valid fields are present', async () => {
    await expect(transform({ search: 'nestjs', hacker: 'injected' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
