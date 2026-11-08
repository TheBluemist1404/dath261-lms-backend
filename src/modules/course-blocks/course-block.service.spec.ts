// course-block.service.spec.ts

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { BlockType } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type.js';
import { EnrollmentService } from '../enrollments/enrollment.service.js';
import { CourseBlockService } from './course-block.service.js';
import type { CreateCourseBlockDto } from './dto/create-course-block.dto.js';
import type { UpdateCourseBlockDto } from './dto/update-course-block.dto.js';

// Mock dùng chung — inject để CourseBlockService khởi tạo được.
const mockEnrollmentService = {
  assertCanAccessCourse: vi.fn(),
};

// Service gọi auditService.record(payload, tx) — mock đúng method `record`.
const mockAuditService = {
  record: vi.fn().mockResolvedValue(undefined),
};

describe('CourseBlockService - findAll', () => {
  let service: CourseBlockService;

  const mockPrisma = {
    course: {
      findUnique: vi.fn(),
    },
    courseBlock: {
      findMany: vi.fn(),
    },
  };

  const courseId = 'course-abc';
  const ownerId = 'lecturer-123';
  const studentId = 'student-456';

  const buildUser = (userId: string): AuthenticatedUser => ({ userId }) as AuthenticatedUser;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseBlockService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EnrollmentService, useValue: mockEnrollmentService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<CourseBlockService>(CourseBlockService);
    vi.clearAllMocks();

    mockPrisma.courseBlock.findMany.mockResolvedValue([
      { id: 'b1', position: 0 },
      { id: 'b2', position: 1 },
    ]);
  });

  // ---------------------------------------------------------------------------
  // Owner
  // ---------------------------------------------------------------------------
  it('should return all blocks for the owner without calling assertCanAccessCourse', async () => {
    mockPrisma.course.findUnique.mockResolvedValue({ id: courseId, lecturerId: ownerId });

    const result = await service.findAll(courseId, buildUser(ownerId));

    expect(result).toHaveLength(2);
    expect(mockEnrollmentService.assertCanAccessCourse).not.toHaveBeenCalled();
    expect(mockPrisma.courseBlock.findMany).toHaveBeenCalledWith({
      where: { courseId },
      orderBy: { position: 'asc' },
    });
  });

  it('should return all blocks for the owner even when the course is Draft', async () => {
    mockPrisma.course.findUnique.mockResolvedValue({ id: courseId, lecturerId: ownerId });

    const result = await service.findAll(courseId, buildUser(ownerId));

    expect(result).toHaveLength(2);
    expect(mockEnrollmentService.assertCanAccessCourse).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Non-owner: student
  // ---------------------------------------------------------------------------
  it('should return blocks for a student when assertCanAccessCourse passes', async () => {
    mockPrisma.course.findUnique.mockResolvedValue({ id: courseId, lecturerId: ownerId });
    mockEnrollmentService.assertCanAccessCourse.mockResolvedValue({
      id: 'enrollment-1',
      status: 'ACTIVE',
    });

    const result = await service.findAll(courseId, buildUser(studentId));

    expect(result).toHaveLength(2);
    expect(mockEnrollmentService.assertCanAccessCourse).toHaveBeenCalledWith(studentId, courseId);
    expect(mockPrisma.courseBlock.findMany).toHaveBeenCalledWith({
      where: { courseId },
      orderBy: { position: 'asc' },
    });
  });

  it('should throw ForbiddenException when a non-enrolled student is rejected', async () => {
    mockPrisma.course.findUnique.mockResolvedValue({ id: courseId, lecturerId: ownerId });
    mockEnrollmentService.assertCanAccessCourse.mockRejectedValue(
      new ForbiddenException('You do not have access to this course.'),
    );

    await expect(service.findAll(courseId, buildUser(studentId))).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockPrisma.courseBlock.findMany).not.toHaveBeenCalled();
  });

  it('should throw ForbiddenException when an enrolled student hits a Draft/Suspended course', async () => {
    mockPrisma.course.findUnique.mockResolvedValue({ id: courseId, lecturerId: ownerId });
    mockEnrollmentService.assertCanAccessCourse.mockRejectedValue(
      new ForbiddenException('You do not have access to this course.'),
    );

    await expect(service.findAll(courseId, buildUser(studentId))).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockPrisma.courseBlock.findMany).not.toHaveBeenCalled();
  });

  it('should throw ForbiddenException when a non-owner lecturer calls findAll without enrollment', async () => {
    const otherLecturerId = 'lecturer-999';
    mockPrisma.course.findUnique.mockResolvedValue({ id: courseId, lecturerId: ownerId });
    mockEnrollmentService.assertCanAccessCourse.mockRejectedValue(
      new ForbiddenException('You do not have access to this course.'),
    );

    await expect(service.findAll(courseId, buildUser(otherLecturerId))).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockEnrollmentService.assertCanAccessCourse).toHaveBeenCalledWith(
      otherLecturerId,
      courseId,
    );
  });

  // ---------------------------------------------------------------------------
  // Course not found
  // ---------------------------------------------------------------------------
  it('should throw NotFoundException when the course does not exist', async () => {
    mockPrisma.course.findUnique.mockResolvedValue(null);

    await expect(service.findAll(courseId, buildUser(studentId))).rejects.toThrow(
      new NotFoundException('Course not found'),
    );
    expect(mockEnrollmentService.assertCanAccessCourse).not.toHaveBeenCalled();
    expect(mockPrisma.courseBlock.findMany).not.toHaveBeenCalled();
  });
});

describe('CourseBlockService - create (ownership pass)', () => {
  let service: CourseBlockService;

  const mockPrisma = {
    course: {
      findUnique: vi.fn(),
    },
    courseBlock: {
      findFirst: vi.fn(),
      create: vi.fn(),
      aggregate: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  const courseId = 'course-abc';
  const lecturerId = 'lecturer-123';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseBlockService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EnrollmentService, useValue: mockEnrollmentService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<CourseBlockService>(CourseBlockService);
    vi.clearAllMocks();

    mockPrisma.courseBlock.aggregate.mockResolvedValue({
      _max: { position: null },
    });

    mockPrisma.course.findUnique.mockResolvedValue({
      id: courseId,
      lecturerId, //pass ownership check
    });

    // $transaction chạy callback với tx = mockPrisma
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      return cb(mockPrisma);
    });
  });

  it('create a block', async () => {
    const dto = {
      title: 'Chapter 1',
      type: 'VIDEO',
      content: { url: 'https://example.com/video.mp4' },
      parentModuleId: null,
      // biome-ignore lint/suspicious/noExplicitAny: NestJS request object, can't type it properly
    } as any;

    const expectedResult = { id: 'block-1', courseId, ...dto };
    mockPrisma.courseBlock.create.mockResolvedValue(expectedResult);

    const result = await service.create(courseId, lecturerId, dto);

    expect(mockPrisma.courseBlock.create).toHaveBeenCalledWith({
      data: {
        courseId,
        type: dto.type,
        title: dto.title,
        content: dto.content,
        position: 0,
        parentModuleId: dto.parentModuleId,
      },
    });

    expect(result).toEqual(expectedResult);
  });

  it("parentModuleId doesn't pass (use ?? null)", async () => {
    const dto = {
      title: 'Chapter 2',
      type: 'TEXT',
      content: { text: 'Hello' },
      // biome-ignore lint/suspicious/noExplicitAny: NestJS request object, can't type it properly
    } as any;

    mockPrisma.courseBlock.create.mockResolvedValue({ id: 'block-2' });

    await service.create(courseId, lecturerId, dto);

    expect(mockPrisma.courseBlock.create).toHaveBeenCalledWith({
      data: {
        courseId,
        type: dto.type,
        title: dto.title,
        content: dto.content,
        position: 0,
        parentModuleId: null, // ?? null
      },
    });
  });

  it('should auto-increment position based on max position in sibling list', async () => {
    mockPrisma.courseBlock.aggregate.mockResolvedValue({
      _max: { position: 4 },
    });
    mockPrisma.courseBlock.create.mockResolvedValue({ id: 'block-x' });

    const dto = {
      title: 'Chapter 3',
      type: 'TEXT',
      content: { text: 'Hi' },
    } as CreateCourseBlockDto;

    await service.create(courseId, lecturerId, dto);

    expect(mockPrisma.courseBlock.aggregate).toHaveBeenCalledWith({
      where: { courseId, parentModuleId: null },
      _max: { position: true },
    });
    expect(mockPrisma.courseBlock.create).toHaveBeenCalledWith({
      data: {
        courseId,
        type: dto.type,
        title: dto.title,
        content: dto.content,
        position: 5, // max 4 + 1
        parentModuleId: null,
      },
    });
  });
});

describe('CourseBlockService - update', () => {
  let service: CourseBlockService;

  const mockPrisma = {
    course: {
      findUnique: vi.fn(),
    },
    courseBlock: {
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  const courseId = 'course-abc';
  const blockId = 'block-1';
  const lecturerId = 'lecturer-123';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseBlockService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EnrollmentService, useValue: mockEnrollmentService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<CourseBlockService>(CourseBlockService);
    vi.clearAllMocks();

    mockPrisma.course.findUnique.mockResolvedValue({
      id: courseId,
      lecturerId,
    });

    mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      return cb(mockPrisma);
    });
  });

  type UpdateDtoInput = Omit<UpdateCourseBlockDto, 'content'> & {
    content?: unknown;
  };

  const buildDto = (overrides: Partial<UpdateDtoInput> = {}): UpdateCourseBlockDto =>
    ({ ...overrides }) as UpdateCourseBlockDto;

  const buildExistingBlock = (overrides: Partial<{ type: BlockType; courseId: string }> = {}) => ({
    id: blockId,
    courseId,
    type: BlockType.TEXT,
    title: 'Old title',
    content: { text: 'Old content' },
    parentModuleId: null,
    ...overrides,
  });

  describe('happy path', () => {
    it('should update only title when only title is provided', async () => {
      mockPrisma.courseBlock.findFirst.mockResolvedValue(buildExistingBlock());
      const dto = buildDto({ title: 'New title' });
      mockPrisma.courseBlock.update.mockResolvedValue({ id: blockId, title: 'New title' });

      const result = await service.update(courseId, blockId, lecturerId, dto);

      expect(mockPrisma.courseBlock.update).toHaveBeenCalledWith({
        where: { id: blockId },
        data: { title: 'New title' },
      });
      expect(result).toEqual({ id: blockId, title: 'New title' });
    });

    it('should update only type when only type is provided', async () => {
      mockPrisma.courseBlock.findFirst.mockResolvedValue(buildExistingBlock());
      const dto = buildDto({ type: BlockType.VIDEO });
      mockPrisma.courseBlock.update.mockResolvedValue({ id: blockId });

      await service.update(courseId, blockId, lecturerId, dto);

      expect(mockPrisma.courseBlock.update).toHaveBeenCalledWith({
        where: { id: blockId },
        data: { type: BlockType.VIDEO },
      });
    });

    it('should update only content when only content is provided', async () => {
      mockPrisma.courseBlock.findFirst.mockResolvedValue(buildExistingBlock());
      const content = { url: 'https://example.com/new.mp4' };
      const dto = buildDto({ content });
      mockPrisma.courseBlock.update.mockResolvedValue({ id: blockId });

      await service.update(courseId, blockId, lecturerId, dto);

      expect(mockPrisma.courseBlock.update).toHaveBeenCalledWith({
        where: { id: blockId },
        data: { content },
      });
    });

    it('should update multiple fields at once when provided', async () => {
      mockPrisma.courseBlock.findFirst.mockResolvedValue(buildExistingBlock());
      const dto = buildDto({
        title: 'New title',
        type: BlockType.VIDEO,
        content: { url: 'https://example.com/new.mp4' },
      });
      mockPrisma.courseBlock.update.mockResolvedValue({ id: blockId });

      await service.update(courseId, blockId, lecturerId, dto);

      expect(mockPrisma.courseBlock.update).toHaveBeenCalledWith({
        where: { id: blockId },
        data: {
          title: 'New title',
          type: BlockType.VIDEO,
          content: { url: 'https://example.com/new.mp4' },
        },
      });
    });

    it('should send an empty data object when dto is empty (no fields to update)', async () => {
      mockPrisma.courseBlock.findFirst.mockResolvedValue(buildExistingBlock());
      const dto = buildDto();
      mockPrisma.courseBlock.update.mockResolvedValue({ id: blockId });

      await service.update(courseId, blockId, lecturerId, dto);

      expect(mockPrisma.courseBlock.update).toHaveBeenCalledWith({
        where: { id: blockId },
        data: {},
      });
    });
  });

  describe('ownership check', () => {
    it('should throw NotFoundException when course does not exist', async () => {
      mockPrisma.course.findUnique.mockResolvedValue(null);
      const dto = buildDto({ title: 'New title' });

      await expect(service.update(courseId, blockId, lecturerId, dto)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.courseBlock.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.courseBlock.update).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when lecturer does not own the course', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({
        id: courseId,
        lecturerId: 'other-lecturer',
      });
      const dto = buildDto({ title: 'New title' });

      await expect(service.update(courseId, blockId, lecturerId, dto)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrisma.courseBlock.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.courseBlock.update).not.toHaveBeenCalled();
    });
  });

  describe('block existence', () => {
    it('should throw NotFoundException when block does not exist in the course', async () => {
      mockPrisma.courseBlock.findFirst.mockResolvedValue(null);
      const dto = buildDto({ title: 'New title' });

      await expect(service.update(courseId, blockId, lecturerId, dto)).rejects.toThrow(
        new NotFoundException('Course block not found'),
      );
      expect(mockPrisma.courseBlock.update).not.toHaveBeenCalled();
    });
  });

  describe('validation: changing MODULE type with children', () => {
    it('should throw BadRequestException when changing MODULE to another type and it has children', async () => {
      mockPrisma.courseBlock.findFirst.mockResolvedValue(
        buildExistingBlock({ type: BlockType.MODULE }),
      );
      mockPrisma.courseBlock.count.mockResolvedValue(2);
      const dto = buildDto({ type: BlockType.VIDEO });

      await expect(service.update(courseId, blockId, lecturerId, dto)).rejects.toThrow(
        new BadRequestException('Cannot change a MODULE that has children'),
      );

      expect(mockPrisma.courseBlock.count).toHaveBeenCalledWith({
        where: { parentModuleId: blockId },
      });
      expect(mockPrisma.courseBlock.update).not.toHaveBeenCalled();
    });

    it('should allow changing MODULE to another type when it has no children', async () => {
      mockPrisma.courseBlock.findFirst.mockResolvedValue(
        buildExistingBlock({ type: BlockType.MODULE }),
      );
      mockPrisma.courseBlock.count.mockResolvedValue(0);
      const dto = buildDto({ type: BlockType.VIDEO });
      mockPrisma.courseBlock.update.mockResolvedValue({ id: blockId });

      await service.update(courseId, blockId, lecturerId, dto);

      expect(mockPrisma.courseBlock.count).toHaveBeenCalledWith({
        where: { parentModuleId: blockId },
      });
      expect(mockPrisma.courseBlock.update).toHaveBeenCalledWith({
        where: { id: blockId },
        data: { type: BlockType.VIDEO },
      });
    });

    it('should NOT check children when block is already MODULE and dto.type is also MODULE', async () => {
      mockPrisma.courseBlock.findFirst.mockResolvedValue(
        buildExistingBlock({ type: BlockType.MODULE }),
      );
      const dto = buildDto({ type: BlockType.MODULE, title: 'New title' });
      mockPrisma.courseBlock.update.mockResolvedValue({ id: blockId });

      await service.update(courseId, blockId, lecturerId, dto);

      expect(mockPrisma.courseBlock.count).not.toHaveBeenCalled();
      expect(mockPrisma.courseBlock.update).toHaveBeenCalledWith({
        where: { id: blockId },
        data: { type: BlockType.MODULE, title: 'New title' },
      });
    });

    it('should NOT check children when block is NOT a MODULE even if dto.type changes', async () => {
      mockPrisma.courseBlock.findFirst.mockResolvedValue(
        buildExistingBlock({ type: BlockType.TEXT }),
      );
      const dto = buildDto({ type: BlockType.VIDEO });
      mockPrisma.courseBlock.update.mockResolvedValue({ id: blockId });

      await service.update(courseId, blockId, lecturerId, dto);

      expect(mockPrisma.courseBlock.count).not.toHaveBeenCalled();
      expect(mockPrisma.courseBlock.update).toHaveBeenCalledWith({
        where: { id: blockId },
        data: { type: BlockType.VIDEO },
      });
    });

    it('should NOT check children when dto.type is undefined (không đổi type)', async () => {
      mockPrisma.courseBlock.findFirst.mockResolvedValue(
        buildExistingBlock({ type: BlockType.MODULE }),
      );
      const dto = buildDto({ title: 'New title' });
      mockPrisma.courseBlock.update.mockResolvedValue({ id: blockId });

      await service.update(courseId, blockId, lecturerId, dto);

      expect(mockPrisma.courseBlock.count).not.toHaveBeenCalled();
    });
  });

  describe('data spread condition', () => {
    it('should NOT include fields with undefined value in data', async () => {
      mockPrisma.courseBlock.findFirst.mockResolvedValue(buildExistingBlock());
      const dto = buildDto({ title: 'New title' });
      mockPrisma.courseBlock.update.mockResolvedValue({ id: blockId });

      await service.update(courseId, blockId, lecturerId, dto);

      const callArg = mockPrisma.courseBlock.update.mock.calls[0][0];
      expect(callArg.data).not.toHaveProperty('type');
      expect(callArg.data).not.toHaveProperty('content');
      expect(callArg.data).toEqual({ title: 'New title' });
    });
  });

  describe('prisma call arguments', () => {
    it('should call findFirst with both blockId and courseId', async () => {
      mockPrisma.courseBlock.findFirst.mockResolvedValue(buildExistingBlock());
      const dto = buildDto({ title: 'New title' });
      mockPrisma.courseBlock.update.mockResolvedValue({ id: blockId });

      await service.update(courseId, blockId, lecturerId, dto);

      expect(mockPrisma.courseBlock.findFirst).toHaveBeenCalledWith({
        where: { id: blockId, courseId },
      });
    });

    it('should call update with where = { id: blockId } only (not courseId)', async () => {
      mockPrisma.courseBlock.findFirst.mockResolvedValue(buildExistingBlock());
      const dto = buildDto({ title: 'New title' });
      mockPrisma.courseBlock.update.mockResolvedValue({ id: blockId });

      await service.update(courseId, blockId, lecturerId, dto);

      expect(mockPrisma.courseBlock.update).toHaveBeenCalledWith({
        where: { id: blockId },
        data: { title: 'New title' },
      });
    });
  });
});

describe('CourseBlockService - remove', () => {
  let service: CourseBlockService;

  const mockPrisma = {
    course: { findUnique: vi.fn() },
    courseBlock: {
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  const courseId = 'course-abc';
  const blockId = 'block-1';
  const lecturerId = 'lecturer-123';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseBlockService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EnrollmentService, useValue: mockEnrollmentService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<CourseBlockService>(CourseBlockService);
    vi.clearAllMocks();

    mockPrisma.course.findUnique.mockResolvedValue({ id: courseId, lecturerId });
    mockPrisma.courseBlock.findFirst.mockResolvedValue({ id: blockId, courseId });

    mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      return cb(mockPrisma);
    });
  });

  it('should delete the block and return Prisma response', async () => {
    const deleted = { id: blockId, courseId, title: 'Chapter 1' };
    mockPrisma.courseBlock.delete.mockResolvedValue(deleted);

    const result = await service.remove(courseId, blockId, lecturerId);

    expect(mockPrisma.courseBlock.findFirst).toHaveBeenCalledWith({
      where: { id: blockId, courseId },
    });
    expect(mockPrisma.courseBlock.delete).toHaveBeenCalledWith({
      where: { id: blockId },
    });
    expect(result).toEqual(deleted);
  });

  it('should throw NotFoundException when course does not exist', async () => {
    mockPrisma.course.findUnique.mockResolvedValue(null);

    await expect(service.remove(courseId, blockId, lecturerId)).rejects.toThrow(NotFoundException);
    expect(mockPrisma.courseBlock.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.courseBlock.delete).not.toHaveBeenCalled();
  });

  it('should throw ForbiddenException when lecturer does not own the course', async () => {
    mockPrisma.course.findUnique.mockResolvedValue({
      id: courseId,
      lecturerId: 'other-lecturer',
    });

    await expect(service.remove(courseId, blockId, lecturerId)).rejects.toThrow(ForbiddenException);
    expect(mockPrisma.courseBlock.delete).not.toHaveBeenCalled();
  });

  it('should throw NotFoundException when block does not exist in the course', async () => {
    mockPrisma.courseBlock.findFirst.mockResolvedValue(null);

    await expect(service.remove(courseId, blockId, lecturerId)).rejects.toThrow(
      new NotFoundException('Course block not found'),
    );
    expect(mockPrisma.courseBlock.delete).not.toHaveBeenCalled();
  });
});

describe('CourseBlockService - reorder', () => {
  let service: CourseBlockService;

  const mockPrisma = {
    course: {
      findUnique: vi.fn(),
    },
    courseBlock: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  const courseId = 'course-abc';
  const lecturerId = 'lecturer-123';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseBlockService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EnrollmentService, useValue: mockEnrollmentService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<CourseBlockService>(CourseBlockService);
    vi.clearAllMocks();

    mockPrisma.course.findUnique.mockResolvedValue({
      id: courseId,
      lecturerId,
    });

    mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      return cb(mockPrisma);
    });
  });

  const buildRequestedBlocks = (ids: string[], parentModuleId: string | null = null) =>
    ids.map((id, i) => ({
      id,
      parentModuleId,
      position: i,
    }));

  const buildSiblings = (ids: string[], positions: number[] = ids.map((_, i) => i)) =>
    ids.map((id, i) => ({
      id,
      position: positions[i],
    }));

  describe('happy path', () => {
    it('should reorder 3 sibling blocks and return reordered result', async () => {
      const blockIds = ['block-a', 'block-b', 'block-c'];

      mockPrisma.courseBlock.findMany
        .mockResolvedValueOnce(buildRequestedBlocks(blockIds))
        .mockResolvedValueOnce(buildSiblings(blockIds));

      mockPrisma.courseBlock.update.mockResolvedValue({});

      const result = await service.reorder(courseId, blockIds, lecturerId);

      expect(result).toHaveLength(3);
      expect(mockPrisma.course.findUnique).toHaveBeenCalledWith({
        where: { id: courseId },
      });
    });

    it('should reorder a single block (position = 0)', async () => {
      const blockIds = ['block-a'];

      mockPrisma.courseBlock.findMany
        .mockResolvedValueOnce(buildRequestedBlocks(blockIds))
        .mockResolvedValueOnce(buildSiblings(blockIds));

      mockPrisma.courseBlock.update.mockResolvedValue({ id: 'block-a', position: 0 });

      const result = await service.reorder(courseId, blockIds, lecturerId);

      expect(result).toEqual([{ id: 'block-a', position: 0 }]);
    });

    it('should assign final positions by index of blockIds, not by DB position', async () => {
      const blockIds = ['block-c', 'block-a', 'block-b'];

      mockPrisma.courseBlock.findMany
        .mockResolvedValueOnce(buildRequestedBlocks(blockIds))
        .mockResolvedValueOnce(buildSiblings(['block-a', 'block-b', 'block-c']));

      mockPrisma.courseBlock.update.mockImplementation(
        async ({ where, data }: { where: { id: string }; data: { position: number } }) => ({
          id: where.id,
          position: data.position,
        }),
      );

      const result = await service.reorder(courseId, blockIds, lecturerId);

      const finalCalls = mockPrisma.courseBlock.update.mock.calls.slice(3);
      expect(finalCalls[0]).toEqual([{ where: { id: 'block-c' }, data: { position: 0 } }]);
      expect(finalCalls[1]).toEqual([{ where: { id: 'block-a' }, data: { position: 1 } }]);
      expect(finalCalls[2]).toEqual([{ where: { id: 'block-b' }, data: { position: 2 } }]);

      expect(result).toEqual([
        { id: 'block-c', position: 0 },
        { id: 'block-a', position: 1 },
        { id: 'block-b', position: 2 },
      ]);
    });
  });

  describe('ownership check', () => {
    it('should throw NotFoundException when course does not exist', async () => {
      mockPrisma.course.findUnique.mockResolvedValueOnce(null);

      await expect(service.reorder(courseId, ['block-a'], lecturerId)).rejects.toThrow(
        NotFoundException,
      );

      expect(mockPrisma.courseBlock.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when lecturer does not own the course', async () => {
      mockPrisma.course.findUnique.mockResolvedValueOnce({
        id: courseId,
        lecturerId: 'other-lecturer',
      });

      await expect(service.reorder(courseId, ['block-a'], lecturerId)).rejects.toThrow(
        ForbiddenException,
      );

      expect(mockPrisma.courseBlock.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('validation: duplicate block IDs', () => {
    it('should throw BadRequestException when blockIds has duplicates', async () => {
      const blockIds = ['block-a', 'block-a', 'block-b'];

      await expect(service.reorder(courseId, blockIds, lecturerId)).rejects.toThrow(
        new BadRequestException('Duplicate block IDs are not allowed'),
      );

      expect(mockPrisma.course.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.courseBlock.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('validation: blocks not in course', () => {
    it('should throw BadRequestException when some blockIds do not exist in the course', async () => {
      const blockIds = ['block-a', 'block-b', 'block-c'];

      mockPrisma.courseBlock.findMany.mockResolvedValueOnce(
        buildRequestedBlocks(['block-a', 'block-b']),
      );

      await expect(service.reorder(courseId, blockIds, lecturerId)).rejects.toThrow(
        new BadRequestException('Some blocks do not belong to this course'),
      );

      expect(mockPrisma.courseBlock.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('validation: different parentModuleId', () => {
    it('should throw BadRequestException when blocks belong to different parents', async () => {
      const blockIds = ['block-a', 'block-b', 'block-c'];

      mockPrisma.courseBlock.findMany.mockResolvedValueOnce([
        { id: 'block-a', parentModuleId: 'module-1', position: 0 },
        { id: 'block-b', parentModuleId: 'module-1', position: 1 },
        { id: 'block-c', parentModuleId: null, position: 2 },
      ]);

      await expect(service.reorder(courseId, blockIds, lecturerId)).rejects.toThrow(
        new BadRequestException('All blocks must belong to the same sibling list'),
      );

      expect(mockPrisma.courseBlock.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('validation: missing siblings', () => {
    it('should throw BadRequestException when blockIds does not include all siblings', async () => {
      const blockIds = ['block-a', 'block-b'];

      mockPrisma.courseBlock.findMany
        .mockResolvedValueOnce(buildRequestedBlocks(blockIds))
        .mockResolvedValueOnce(buildSiblings(['block-a', 'block-b', 'block-c']));

      await expect(service.reorder(courseId, blockIds, lecturerId)).rejects.toThrow(
        new BadRequestException('You must provide all blocks in the parent module'),
      );

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('validation: blockIds mismatch sibling IDs', () => {
    it('should throw BadRequestException when blockIds length matches siblings but IDs differ', async () => {
      const blockIds = ['block-a', 'block-b'];

      mockPrisma.courseBlock.findMany
        .mockResolvedValueOnce(buildRequestedBlocks(blockIds))
        .mockResolvedValueOnce(buildSiblings(['block-a', 'block-x']));

      await expect(service.reorder(courseId, blockIds, lecturerId)).rejects.toThrow(
        new BadRequestException('Block IDs must match the sibling list'),
      );

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('prisma call arguments', () => {
    it('should call findMany #1 with courseId and id: { in: blockIds }', async () => {
      const blockIds = ['block-a', 'block-b'];

      mockPrisma.courseBlock.findMany
        .mockResolvedValueOnce(buildRequestedBlocks(blockIds))
        .mockResolvedValueOnce(buildSiblings(blockIds));
      mockPrisma.courseBlock.update.mockResolvedValue({});

      await service.reorder(courseId, blockIds, lecturerId);

      expect(mockPrisma.courseBlock.findMany).toHaveBeenNthCalledWith(1, {
        where: { courseId, id: { in: blockIds } },
        select: { id: true, parentModuleId: true, position: true },
      });
    });

    it('should call findMany #2 with courseId and parentModuleId', async () => {
      const blockIds = ['block-a', 'block-b'];
      const parentModuleId = 'module-1';

      mockPrisma.courseBlock.findMany
        .mockResolvedValueOnce([
          { id: 'block-a', parentModuleId, position: 0 },
          { id: 'block-b', parentModuleId, position: 1 },
        ])
        .mockResolvedValueOnce(buildSiblings(blockIds));
      mockPrisma.courseBlock.update.mockResolvedValue({});

      await service.reorder(courseId, blockIds, lecturerId);

      expect(mockPrisma.courseBlock.findMany).toHaveBeenNthCalledWith(2, {
        where: { courseId, parentModuleId },
        select: { id: true, position: true },
      });
    });

    it('should call $transaction exactly once', async () => {
      const blockIds = ['block-a'];

      mockPrisma.courseBlock.findMany
        .mockResolvedValueOnce(buildRequestedBlocks(blockIds))
        .mockResolvedValueOnce(buildSiblings(blockIds));
      mockPrisma.courseBlock.update.mockResolvedValue({});

      await service.reorder(courseId, blockIds, lecturerId);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('two-phase update', () => {
    it('should first move all blocks to temporary positions > maxPosition, then assign final positions', async () => {
      const blockIds = ['block-a', 'block-b'];

      mockPrisma.courseBlock.findMany
        .mockResolvedValueOnce(buildRequestedBlocks(blockIds))
        .mockResolvedValueOnce(buildSiblings(['block-a', 'block-b'], [0, 1]));
      mockPrisma.courseBlock.update.mockResolvedValue({});

      await service.reorder(courseId, blockIds, lecturerId);

      expect(mockPrisma.courseBlock.update).toHaveBeenCalledTimes(4);

      expect(mockPrisma.courseBlock.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'block-a' },
        data: { position: 2 },
      });
      expect(mockPrisma.courseBlock.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'block-b' },
        data: { position: 3 },
      });

      expect(mockPrisma.courseBlock.update).toHaveBeenNthCalledWith(3, {
        where: { id: 'block-a' },
        data: { position: 0 },
      });
      expect(mockPrisma.courseBlock.update).toHaveBeenNthCalledWith(4, {
        where: { id: 'block-b' },
        data: { position: 1 },
      });
    });

    it('should throw BadRequestException when siblings array is empty (length mismatch)', async () => {
      const blockIds = ['block-a'];

      mockPrisma.courseBlock.findMany
        .mockResolvedValueOnce(buildRequestedBlocks(blockIds))
        .mockResolvedValueOnce([]);

      await expect(service.reorder(courseId, blockIds, lecturerId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
