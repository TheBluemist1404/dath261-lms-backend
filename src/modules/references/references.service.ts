import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ResourceReference } from '../../generated/prisma/client.js';
import { BlockType } from '../../generated/prisma/enums.js';
import { escapeLike } from '../../infrastructure/database/prisma/like-pattern.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { PagesService } from '../pages/pages.service.js';
import {
  type BlockWithCourse,
  CourseBlockAccessService,
  durationSeconds,
} from './course-block-access.service.js';
import type { CreateReferenceDto } from './dto/create-reference.dto.js';
import {
  REFERENCEABLE_TYPES,
  type ReferenceableType,
  type ReferenceSourcesQueryDto,
} from './dto/reference-sources-query.dto.js';
import type {
  CourseReferenceResponseDto,
  ReferencedBlockResponseDto,
} from './dto/responses/course-reference-response.dto.js';

type ReferenceWithBlock = ResourceReference & { courseBlock: BlockWithCourse };

const blockInclude = { courseBlock: { include: { course: true } } } as const;

@Injectable()
export class ReferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pages: PagesService,
    private readonly blockAccess: CourseBlockAccessService,
  ) {}

  async list(userId: string, pageId: string): Promise<CourseReferenceResponseDto[]> {
    await this.pages.resolve(userId, pageId);

    const references = await this.prisma.resourceReference.findMany({
      where: { pageId },
      include: blockInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const enrolled = await this.blockAccess.enrolledCourseIds(
      userId,
      references.map((reference) => reference.courseBlock.courseId),
    );

    return references.map((reference) => this.present(reference, userId, enrolled));
  }

  async create(
    userId: string,
    pageId: string,
    dto: CreateReferenceDto,
  ): Promise<CourseReferenceResponseDto> {
    this.pages.assertEditable(await this.pages.resolve(userId, pageId));

    const block = await this.prisma.courseBlock.findUnique({
      where: { id: dto.courseBlockId },
      include: { course: true },
    });
    const enrolled = block
      ? await this.blockAccess.enrolledCourseIds(userId, [block.courseId])
      : new Set<string>();

    // Blocks the caller cannot open look the same as missing ones.
    if (
      !block ||
      !isReferenceable(block.type) ||
      this.blockAccess.status(block, userId, enrolled) !== 'AVAILABLE'
    ) {
      throw new NotFoundException('Course material is not available');
    }

    const timestampSeconds = dto.timestampSeconds ?? null;
    if (timestampSeconds !== null) {
      const duration = durationSeconds(block);
      if (block.type !== BlockType.VIDEO || (duration !== null && timestampSeconds > duration)) {
        throw new BadRequestException('timestampSeconds is outside the video');
      }
    }

    const reference = await this.prisma.resourceReference.create({
      data: { pageId, courseBlockId: block.id, timestampSeconds },
      include: blockInclude,
    });
    return this.present(reference, userId, enrolled);
  }

  async remove(userId: string, referenceId: string): Promise<void> {
    const reference = await this.prisma.resourceReference.findUnique({
      where: { id: referenceId },
    });
    if (!reference) {
      throw new NotFoundException('Reference not found');
    }

    try {
      this.pages.assertEditable(await this.pages.resolve(userId, reference.pageId));
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new NotFoundException('Reference not found');
      }
      throw error;
    }

    await this.prisma.resourceReference.delete({ where: { id: referenceId } });
  }

  async sources(
    userId: string,
    query: ReferenceSourcesQueryDto,
  ): Promise<ReferencedBlockResponseDto[]> {
    const q = query.q ? escapeLike(query.q) : undefined;

    const blocks = await this.prisma.courseBlock.findMany({
      where: {
        type: query.type,
        course: this.blockAccess.accessibleCourses(userId),
        ...(q && {
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { course: { title: { contains: q, mode: 'insensitive' } } },
          ],
        }),
      },
      include: { course: true },
      orderBy: [{ course: { title: 'asc' } }, { courseId: 'asc' }, { position: 'asc' }],
    });

    return blocks.map(toReferencedBlock);
  }

  private present(
    reference: ReferenceWithBlock,
    userId: string,
    enrolled: Set<string>,
  ): CourseReferenceResponseDto {
    const base = { id: reference.id, pageId: reference.pageId, createdAt: reference.createdAt };
    const status = this.blockAccess.status(reference.courseBlock, userId, enrolled);

    if (status !== 'AVAILABLE') {
      // No block metadata for references the viewer cannot open (NFR-VAL-02).
      return { ...base, status };
    }
    return {
      ...base,
      status,
      block: toReferencedBlock(reference.courseBlock),
      timestampSeconds: reference.timestampSeconds,
    };
  }
}

function isReferenceable(type: BlockType): type is ReferenceableType {
  return (REFERENCEABLE_TYPES as readonly BlockType[]).includes(type);
}

function toReferencedBlock(block: BlockWithCourse): ReferencedBlockResponseDto {
  return {
    id: block.id,
    type: block.type as ReferenceableType,
    title: block.title,
    courseId: block.courseId,
    courseTitle: block.course.title,
    durationSeconds: durationSeconds(block),
  };
}
