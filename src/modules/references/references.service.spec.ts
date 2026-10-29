import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockType } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { PagesService } from '../pages/pages.service.js';
import { CourseBlockAccessService } from './course-block-access.service.js';
import { ReferencesService } from './references.service.js';

describe('Reference integrity after course edits', () => {
  let service: ReferencesService;
  const findMany = vi.fn();
  const status = vi.fn();
  const base = { id: 'reference', pageId: 'page', createdAt: new Date('2026-10-27T00:00:00Z') };

  beforeEach(async () => {
    vi.resetAllMocks();
    status.mockReturnValue('AVAILABLE');
    const module = await Test.createTestingModule({
      providers: [
        ReferencesService,
        { provide: PrismaService, useValue: { resourceReference: { findMany } } },
        { provide: PagesService, useValue: { resolve: vi.fn().mockResolvedValue({}) } },
        {
          provide: CourseBlockAccessService,
          useValue: { enrolledCourseIds: vi.fn().mockResolvedValue(new Set(['course'])), status },
        },
      ],
    }).compile();
    service = module.get(ReferencesService);
  });

  function reference(type: BlockType, timestampSeconds: number | null, durationSeconds?: number) {
    return {
      ...base,
      timestampSeconds,
      courseBlock: {
        id: 'block',
        title: 'Protected material',
        courseId: 'course',
        type,
        content: durationSeconds === undefined ? {} : { durationSeconds },
        course: { id: 'course', title: 'Protected course' },
      },
    };
  }

  it.each([
    BlockType.TEXT,
    BlockType.MODULE,
    BlockType.QUIZ,
    BlockType.ASSIGNMENT,
  ])('hides references whose target became %s', async (type) => {
    findMany.mockResolvedValue([reference(type, null)]);
    expect(await service.list('viewer', 'page')).toEqual([{ ...base, status: 'UNAVAILABLE' }]);
  });

  it('hides a timestamped video reference whose target became a file', async () => {
    findMany.mockResolvedValue([reference(BlockType.FILE, 30)]);
    expect(await service.list('viewer', 'page')).toEqual([{ ...base, status: 'UNAVAILABLE' }]);
  });

  it('hides an anchor beyond the edited video duration', async () => {
    findMany.mockResolvedValue([reference(BlockType.VIDEO, 300, 120)]);
    expect(await service.list('viewer', 'page')).toEqual([{ ...base, status: 'UNAVAILABLE' }]);
  });

  it.each([
    [BlockType.FILE, null, undefined],
    [BlockType.VIDEO, null, 120],
    [BlockType.VIDEO, 0, 120],
    [BlockType.VIDEO, 120, 120],
    [BlockType.VIDEO, 300, undefined],
  ] as const)('keeps a valid %s reference available at %s with duration %s', async (type, timestamp, duration) => {
    findMany.mockResolvedValue([reference(type, timestamp, duration)]);
    expect((await service.list('viewer', 'page'))[0]).toMatchObject({
      status: 'AVAILABLE',
      block: { type },
      timestampSeconds: timestamp,
    });
  });

  it('preserves LOCKED for a viewer without course access even when the target is invalid', async () => {
    findMany.mockResolvedValue([reference(BlockType.TEXT, 30)]);
    status.mockReturnValue('LOCKED');
    expect(await service.list('viewer', 'page')).toEqual([{ ...base, status: 'LOCKED' }]);
  });
});
