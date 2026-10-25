// src/courseblock/courseblock.service.integration.spec.ts
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BlockType, UserRole } from '../generated/prisma/enums.js';
import { PrismaService } from '../infrastructure/database/prisma/prisma.service.js';
import { CourseBlockService } from './courseblock.service.js';
import { Prisma } from '../generated/prisma/client.js';

const PREFIX = 'courseblock-integration-';

describe('CourseBlockService - integration', () => {
  let service: CourseBlockService;
  let prisma: PrismaService;
  let moduleRef: TestingModule;

  let lecturerA: { id: string };
  let lecturerB: { id: string };
  let courseA: { id: string };
  let courseB: { id: string };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env',
        }),
      ],
      providers: [PrismaService, CourseBlockService],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(CourseBlockService);

    await prisma.$connect();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await moduleRef.close();
  });

  async function cleanup() {
    await prisma.courseBlock.deleteMany({
      where: {
        course: {
          lecturer: {
            email: { startsWith: PREFIX },
          },
        },
      },
    });
    await prisma.course.deleteMany({
      where: {
        lecturer: {
          email: { startsWith: PREFIX },
        },
      },
    });
    await prisma.user.deleteMany({
      where: { email: { startsWith: PREFIX } },
    });
  }

  beforeEach(async () => {
    await cleanup();

    lecturerA = await prisma.user.create({
      data: {
        email: `${PREFIX}lecturer-a@example.com`,
        passwordHash: 'hash',
        role: UserRole.LECTURER,
      },
    });
    lecturerB = await prisma.user.create({
      data: {
        email: `${PREFIX}lecturer-b@example.com`,
        passwordHash: 'hash',
        role: UserRole.LECTURER,
      },
    });

    courseA = await prisma.course.create({
      data: {
        title: 'Course A',
        lecturerId: lecturerA.id,
      },
    });
    courseB = await prisma.course.create({
      data: {
        title: 'Course B',
        lecturerId: lecturerB.id,
      },
    });
  });

  function createBlock(overrides: {
    courseId?: string;
    type?: BlockType;
    title?: string;
    position: number;
    parentModuleId?: string | null;
    content?: Prisma.InputJsonValue;
  }) {
    return prisma.courseBlock.create({
      data: {
        courseId: overrides.courseId ?? courseA.id,
        type: overrides.type ?? BlockType.TEXT,
        title: overrides.title ?? 'Block',
        position: overrides.position,
        parentModuleId: overrides.parentModuleId ?? null,
        ...(overrides.content !== undefined && { content: overrides.content }),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // findAll
  // ---------------------------------------------------------------------------
  describe('findAll', () => {
    it('should return blocks ordered by position ascending', async () => {
      await createBlock({ position: 2, title: 'C' });
      await createBlock({ position: 0, title: 'A' });
      await createBlock({ position: 1, title: 'B' });

      const blocks = await service.findAll(courseA.id, lecturerA.id);

      expect(blocks.map((b) => b.title)).toEqual(['A', 'B', 'C']);
      expect(blocks.map((b) => b.position)).toEqual([0, 1, 2]);
    });

    it('should throw NotFoundException when course does not exist', async () => {
      await expect(
        service.findAll('non-existent-course', lecturerA.id),
      ).rejects.toThrow('Course not found');
    });

    it('should throw ForbiddenException when lecturer does not own the course', async () => {
      await expect(
        service.findAll(courseA.id, lecturerB.id),
      ).rejects.toThrow('You do not own this course');
    });
  });

  // ---------------------------------------------------------------------------
  // create (auto-increment position)
  // ---------------------------------------------------------------------------
  describe('create', () => {
    it('should auto-assign position = 0 for the first root block', async () => {
      const block = await service.create(courseA.id, lecturerA.id, {
        type: BlockType.TEXT,
        title: 'First',
      });

      expect(block.position).toBe(0);
      expect(block.parentModuleId).toBeNull();

      const persisted = await prisma.courseBlock.findUniqueOrThrow({
        where: { id: block.id },
      });
      expect(persisted.position).toBe(0);
    });

    it('should auto-increment position for subsequent root blocks', async () => {
      await service.create(courseA.id, lecturerA.id, {
        type: BlockType.TEXT,
        title: 'First',
      });

      const second = await service.create(courseA.id, lecturerA.id, {
        type: BlockType.TEXT,
        title: 'Second',
      });

      expect(second.position).toBe(1);
    });

    it('should compute position per parent module (children start at 0)', async () => {
      const module = await service.create(courseA.id, lecturerA.id, {
        type: BlockType.MODULE,
        title: 'Module',
      });

      const child1 = await service.create(courseA.id, lecturerA.id, {
        type: BlockType.TEXT,
        title: 'Child 1',
        parentModuleId: module.id,
      });

      const child2 = await service.create(courseA.id, lecturerA.id, {
        type: BlockType.TEXT,
        title: 'Child 2',
        parentModuleId: module.id,
      });

      expect(child1.position).toBe(0);
      expect(child2.position).toBe(1);
      expect(child1.parentModuleId).toBe(module.id);
    });

    it('should compute position independently per course', async () => {
      await service.create(courseA.id, lecturerA.id, {
        type: BlockType.TEXT,
        title: 'A1',
      });

      const blockB = await service.create(courseB.id, lecturerB.id, {
        type: BlockType.TEXT,
        title: 'B1',
      });

      expect(blockB.position).toBe(0);
    });

    it('should reject parent module that belongs to another course', async () => {
      const foreignModule = await createBlock({
        courseId: courseB.id,
        type: BlockType.MODULE,
        position: 0,
      });

      await expect(
        service.create(courseA.id, lecturerA.id, {
          type: BlockType.TEXT,
          title: 'Orphan',
          parentModuleId: foreignModule.id,
        }),
      ).rejects.toThrow('Parent module must belong to the same course');
    });

    it('should reject parent that is not a MODULE', async () => {
      const textBlock = await createBlock({
        type: BlockType.TEXT,
        position: 0,
      });

      await expect(
        service.create(courseA.id, lecturerA.id, {
          type: BlockType.TEXT,
          title: 'Orphan',
          parentModuleId: textBlock.id,
        }),
      ).rejects.toThrow('Parent block must be a MODULE');
    });

    it('should reject unknown parent id', async () => {
      await expect(
        service.create(courseA.id, lecturerA.id, {
          type: BlockType.TEXT,
          title: 'Orphan',
          parentModuleId: 'does-not-exist',
        }),
      ).rejects.toThrow('Parent module must belong to the same course');
    });
  });

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------
  describe('update', () => {
    it('should partially update fields and persist changes', async () => {
      const block = await createBlock({ position: 0, title: 'Old', content: 'Old' });

      const updated = await service.update(courseA.id, block.id, lecturerA.id, {
        title: 'New',
        content: { url: 'https://example.com/new.mp4' },
      });

      expect(updated.title).toBe('New');

      const persisted = await prisma.courseBlock.findUniqueOrThrow({
        where: { id: block.id },
      });
      expect(persisted.title).toBe('New');
      expect(persisted.content).toEqual({ url: 'https://example.com/new.mp4' });
    });

    it('should throw NotFoundException when block does not exist in the course', async () => {
      await expect(
        service.update(courseA.id, 'non-existent-block', lecturerA.id, {
          title: 'New',
        }),
      ).rejects.toThrow('Course block not found');
    });

    it('should reject changing MODULE to another type when it has children', async () => {
      const module = await createBlock({ type: BlockType.MODULE, position: 0 });
      await createBlock({ position: 0, parentModuleId: module.id });

      await expect(
        service.update(courseA.id, module.id, lecturerA.id, {
          type: BlockType.TEXT,
        }),
      ).rejects.toThrow('Cannot change a MODULE that has children');
    });

    it('should allow changing MODULE to another type when it has no children', async () => {
      const module = await createBlock({ type: BlockType.MODULE, position: 0 });

      const updated = await service.update(courseA.id, module.id, lecturerA.id, {
        type: BlockType.TEXT,
      });

      expect(updated.type).toBe(BlockType.TEXT);
    });
  });

  // ---------------------------------------------------------------------------
  // remove
  // ---------------------------------------------------------------------------
  describe('remove', () => {
    it('should delete the block', async () => {
      const block = await createBlock({ position: 0 });

      const deleted = await service.remove(courseA.id, block.id, lecturerA.id);

      expect(deleted.id).toBe(block.id);

      const persisted = await prisma.courseBlock.findUnique({
        where: { id: block.id },
      });
      expect(persisted).toBeNull();
    });

    it('should throw NotFoundException when block does not exist', async () => {
      await expect(
        service.remove(courseA.id, 'non-existent-block', lecturerA.id),
      ).rejects.toThrow('Course block not found');
    });

    it('should cascade delete children when removing a MODULE', async () => {
      const module = await createBlock({ type: BlockType.MODULE, position: 0 });
      const child1 = await createBlock({ position: 0, parentModuleId: module.id });
      const child2 = await createBlock({ position: 1, parentModuleId: module.id });

      await service.remove(courseA.id, module.id, lecturerA.id);

      const remaining = await prisma.courseBlock.findMany({
        where: { id: { in: [module.id, child1.id, child2.id] } },
      });
      expect(remaining).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // reorder
  // ---------------------------------------------------------------------------
  describe('reorder', () => {
    it('should reorder root blocks and persist new positions', async () => {
      const a = await createBlock({ position: 0, title: 'A' });
      const b = await createBlock({ position: 1, title: 'B' });
      const c = await createBlock({ position: 2, title: 'C' });

      const result = await service.reorder(
        courseA.id,
        [c.id, b.id, a.id],
        lecturerA.id,
      );

      expect(result.map((r) => r.id)).toEqual([c.id, b.id, a.id]);

      const persisted = await prisma.courseBlock.findMany({
        where: { courseId: courseA.id, parentModuleId: null },
        orderBy: { position: 'asc' },
      });
      expect(persisted.map((p) => p.title)).toEqual(['C', 'B', 'A']);
      expect(persisted.map((p) => p.position)).toEqual([0, 1, 2]);
    });

    it('should reorder children inside a MODULE', async () => {
      const module = await createBlock({ type: BlockType.MODULE, position: 0 });
      const c1 = await createBlock({ position: 0, parentModuleId: module.id });
      const c2 = await createBlock({ position: 1, parentModuleId: module.id });

      await service.reorder(courseA.id, [c2.id, c1.id], lecturerA.id);

      const persisted = await prisma.courseBlock.findMany({
        where: { parentModuleId: module.id },
        orderBy: { position: 'asc' },
      });
      expect(persisted.map((p) => p.id)).toEqual([c2.id, c1.id]);
      expect(persisted.map((p) => p.position)).toEqual([0, 1]);
    });

    it('should reject duplicate ids', async () => {
      const a = await createBlock({ position: 0 });

      await expect(
        service.reorder(courseA.id, [a.id, a.id], lecturerA.id),
      ).rejects.toThrow('Duplicate block IDs are not allowed');
    });

    it('should reject ids that belong to another course', async () => {
      const a = await createBlock({ position: 0 });
      const foreign = await createBlock({
        courseId: courseB.id,
        position: 0,
      });

      await expect(
        service.reorder(courseA.id, [a.id, foreign.id], lecturerA.id),
      ).rejects.toThrow('Some blocks do not belong to this course');
    });

    it('should reject blocks with different parentModuleId', async () => {
      const module = await createBlock({ type: BlockType.MODULE, position: 0 });
      const root = await createBlock({ position: 0 });
      const child = await createBlock({ position: 0, parentModuleId: module.id });

      await expect(
        service.reorder(courseA.id, [root.id, child.id], lecturerA.id),
      ).rejects.toThrow('All blocks must belong to the same sibling list');
    });

    it('should reject incomplete sibling list', async () => {
      const a = await createBlock({ position: 0 });
      await createBlock({ position: 1 });
      await createBlock({ position: 2 });

      await expect(
        service.reorder(courseA.id, [a.id], lecturerA.id),
      ).rejects.toThrow('You must provide all blocks in the parent module');
    });
  });
});