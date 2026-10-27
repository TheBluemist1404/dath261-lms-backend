import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { BlockType } from '../../generated/prisma/enums.js';
import { CreateCourseBlockDto } from './create-course-block.dto.js';
import { UpdateCourseBlockDto } from './update-course-block.dto.js';

describe.each([
  {
    name: 'create',
    metatype: CreateCourseBlockDto,
    required: { type: BlockType.VIDEO, title: 'Video' },
  },
  { name: 'update', metatype: UpdateCourseBlockDto, required: {} },
])('$name CourseBlock content validation', ({ metatype, required }) => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  it('preserves nested JSON object payloads', async () => {
    const content = { durationSeconds: 120, metadata: { captions: ['en', 'vi'] } };
    const dto = await pipe.transform({ ...required, content }, { type: 'body', metatype });

    expect(dto.content).toEqual(content);
  });

  it('allows content to be omitted', async () => {
    const dto = await pipe.transform({ ...required }, { type: 'body', metatype });

    expect(dto.content).toBeUndefined();
  });

  it.each([
    'markdown text',
    42,
    false,
    [],
    null,
  ])('rejects a non-object payload: %j', async (content) => {
    await expect(
      pipe.transform({ ...required, content }, { type: 'body', metatype }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
