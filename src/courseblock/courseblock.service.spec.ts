// courseblock.service.spec.ts
import { Test, type TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { vi } from 'vitest';
import { PrismaService } from '../infrastructure/database/prisma/prisma.service.js';
import { CourseBlockService } from './courseblock.service.js';
import type { CreateCourseBlockDto } from './dto/create-course-block.dto.js';
import { BlockType } from '../generated/prisma/enums.js';
import type { UpdateCourseBlockDto } from './dto/update-course-block.dto.js';

describe('CourseBlockService - create (ownership pass)', () => {
  let service: CourseBlockService;

  const mockPrisma = {
    course: {
      findUnique: vi.fn(),
    },
    courseBlock: {
      create: vi.fn(),
      aggregate: vi.fn(),
    },
  };

  const courseId = 'course-abc';
  const lecturerId = 'lecturer-123';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CourseBlockService, { provide: PrismaService, useValue: mockPrisma }],
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
  });

  // Test case
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

    // Verify that the PrismaService methods were created with the correct parameters
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

    // Verify that the result matches the expected result
    expect(result).toEqual(expectedResult);
  });

  it("parentModuleId doesn't pass (use ?? null)", async () => {
    const dto = {
      title: 'Chapter 2',
      type: 'TEXT',
      content: 'Hello',
      // parentModuleId
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
      content: 'Hi',
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
        position: 5,          // max 4 + 1
        parentModuleId: null,
      },
    });
  });
});

describe('CourseBlockService - update', () => {
  let service: CourseBlockService;

  // Mock Prisma: chỉ khai báo method mà update() dùng tới
  const mockPrisma = {
    course: {
      findUnique: vi.fn(),
    },
    courseBlock: {
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
  };

  const courseId = 'course-abc';
  const blockId = 'block-1';
  const lecturerId = 'lecturer-123';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseBlockService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<CourseBlockService>(CourseBlockService);
    vi.clearAllMocks();

    // Mặc định: ownership pass
    mockPrisma.course.findUnique.mockResolvedValue({
      id: courseId,
      lecturerId,
    });
  });

  type UpdateDtoInput = Omit<UpdateCourseBlockDto, 'content'> & {
    content?: unknown;
  };
  
  // Helper tạo DTO update, có thể override từng field
  const buildDto = (overrides: Partial<UpdateDtoInput> = {}): UpdateCourseBlockDto =>
    ({ ...overrides }) as UpdateCourseBlockDto;

  // Helper tạo block hiện tại trong DB, có thể override
  const buildExistingBlock = (overrides: Partial<{ type: BlockType; courseId: string }> = {}) => ({
    id: blockId,
    courseId,
    type: BlockType.TEXT,
    title: 'Old title',
    content: 'Old content',
    parentModuleId: null,
    ...overrides,
  });

  // ---------------------------------------------------------------------------
  // Nhóm 1: Happy path — update từng field đơn lẻ
  // ---------------------------------------------------------------------------
  describe('happy path', () => {
    it('should update only title when only title is provided', async () => {
      mockPrisma.courseBlock.findFirst.mockResolvedValue(buildExistingBlock());
      const dto = buildDto({ title: 'New title' });
      mockPrisma.courseBlock.update.mockResolvedValue({ id: blockId, title: 'New title' });

      const result = await service.update(courseId, blockId, lecturerId, dto);

      expect(mockPrisma.courseBlock.update).toHaveBeenCalledWith({
        where: { id: blockId },
        data: { title: 'New title' }, // không có type, position, content
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
      const dto = buildDto(); // {}
      mockPrisma.courseBlock.update.mockResolvedValue({ id: blockId });

      await service.update(courseId, blockId, lecturerId, dto);

      // Tất cả spread condition đều false -> data = {}
      expect(mockPrisma.courseBlock.update).toHaveBeenCalledWith({
        where: { id: blockId },
        data: {},
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Nhóm 2: Ownership check fail
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Nhóm 3: Block không tồn tại trong course
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Nhóm 4: Logic đổi type của MODULE có children
  // ---------------------------------------------------------------------------
  describe('validation: changing MODULE type with children', () => {
    it('should throw BadRequestException when changing MODULE to another type and it has children', async () => {
      mockPrisma.courseBlock.findFirst.mockResolvedValue(
        buildExistingBlock({ type: BlockType.MODULE }),
      );
      mockPrisma.courseBlock.count.mockResolvedValue(2); // có 2 children
      const dto = buildDto({ type: BlockType.VIDEO });

      await expect(service.update(courseId, blockId, lecturerId, dto)).rejects.toThrow(
        new BadRequestException('Cannot change a MODULE that has children'),
      );

      // Phải check count với parentModuleId = blockId
      expect(mockPrisma.courseBlock.count).toHaveBeenCalledWith({
        where: { parentModuleId: blockId },
      });
      expect(mockPrisma.courseBlock.update).not.toHaveBeenCalled();
    });

    it('should allow changing MODULE to another type when it has no children', async () => {
      mockPrisma.courseBlock.findFirst.mockResolvedValue(
        buildExistingBlock({ type: BlockType.MODULE }),
      );
      mockPrisma.courseBlock.count.mockResolvedValue(0); // không có children
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

      // type không đổi -> không gọi count
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

      // block.type !== MODULE -> bỏ qua check children
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
      const dto = buildDto({ title: 'New title' }); // không có type
      mockPrisma.courseBlock.update.mockResolvedValue({ id: blockId });

      await service.update(courseId, blockId, lecturerId, dto);

      expect(mockPrisma.courseBlock.count).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Nhóm 5: Đảm bảo data chỉ chứa field được cung cấp (spread condition)
  // ---------------------------------------------------------------------------
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
  // ---------------------------------------------------------------------------
  // Nhóm 6: Truyền đúng tham số cho findFirst (id + courseId)
  // ---------------------------------------------------------------------------
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
        where: { id: blockId }, // service chỉ dùng id
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
  };

  const courseId = 'course-abc';
  const blockId = 'block-1';
  const lecturerId = 'lecturer-123';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseBlockService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<CourseBlockService>(CourseBlockService);
    vi.clearAllMocks();

    // Mặc định: ownership pass
    mockPrisma.course.findUnique.mockResolvedValue({ id: courseId, lecturerId });
    // Mặc định: block tồn tại trong course
    mockPrisma.courseBlock.findFirst.mockResolvedValue({ id: blockId, courseId });
  });

  // ---------------------------------------------------------------------------
  // Happy path
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Ownership fail
  // ---------------------------------------------------------------------------
  it('should throw NotFoundException when course does not exist', async () => {
    mockPrisma.course.findUnique.mockResolvedValue(null);

    await expect(service.remove(courseId, blockId, lecturerId)).rejects.toThrow(
      NotFoundException,
    );
    expect(mockPrisma.courseBlock.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.courseBlock.delete).not.toHaveBeenCalled();
  });

  it('should throw ForbiddenException when lecturer does not own the course', async () => {
    mockPrisma.course.findUnique.mockResolvedValue({
      id: courseId,
      lecturerId: 'other-lecturer',
    });

    await expect(service.remove(courseId, blockId, lecturerId)).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockPrisma.courseBlock.delete).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Block not found
  // ---------------------------------------------------------------------------
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

  // Mock Prisma: khai báo method mà reorder() + checkCourseOwnership() dùng tới
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
      ],
    }).compile();

    service = module.get<CourseBlockService>(CourseBlockService);
    vi.clearAllMocks();

    // Mặc định: course tồn tại và thuộc lecturerId -> checkCourseOwnership pass
    mockPrisma.course.findUnique.mockResolvedValue({
      id: courseId,
      lecturerId,
    });

    // $transaction chạy callback với tx = mockPrisma (callback-style)
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      return cb(mockPrisma);
    });
  });

  // Helper tạo block từ findMany (lần 1: blocks được yêu cầu)
  const buildRequestedBlocks = (
    ids: string[],
    parentModuleId: string | null = null,
  ) =>
    ids.map((id, i) => ({
      id,
      parentModuleId,
      position: i,
    }));

  // Helper tạo sibling từ findMany (lần 2: tất cả siblings cùng parent)
  const buildSiblings = (
    ids: string[],
    positions: number[] = ids.map((_, i) => i),
  ) =>
    ids.map((id, i) => ({
      id,
      position: positions[i],
    }));

  // ---------------------------------------------------------------------------
  // Nhóm 1: Happy path
  // ---------------------------------------------------------------------------
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
      expect(finalCalls[0]).toEqual([
        { where: { id: 'block-c' }, data: { position: 0 } },
      ]);
      expect(finalCalls[1]).toEqual([
        { where: { id: 'block-a' }, data: { position: 1 } },
      ]);
      expect(finalCalls[2]).toEqual([
        { where: { id: 'block-b' }, data: { position: 2 } },
      ]);

      expect(result).toEqual([
        { id: 'block-c', position: 0 },
        { id: 'block-a', position: 1 },
        { id: 'block-b', position: 2 },
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // Nhóm 2: checkCourseOwnership — course không tồn tại / không sở hữu
  // ---------------------------------------------------------------------------
  describe('ownership check', () => {
    it('should throw NotFoundException when course does not exist', async () => {
      mockPrisma.course.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.reorder(courseId, ['block-a'], lecturerId),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.courseBlock.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when lecturer does not own the course', async () => {
      mockPrisma.course.findUnique.mockResolvedValueOnce({
        id: courseId,
        lecturerId: 'other-lecturer',
      });

      await expect(
        service.reorder(courseId, ['block-a'], lecturerId),
      ).rejects.toThrow(ForbiddenException);

      expect(mockPrisma.courseBlock.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Nhóm 3: Validation — duplicate IDs (fail-fast TRƯỚC checkCourseOwnership)
  // ---------------------------------------------------------------------------
  describe('validation: duplicate block IDs', () => {
    it('should throw BadRequestException when blockIds has duplicates', async () => {
      const blockIds = ['block-a', 'block-a', 'block-b'];

      await expect(service.reorder(courseId, blockIds, lecturerId)).rejects.toThrow(
        new BadRequestException('Duplicate block IDs are not allowed'),
      );

      // Fail-fast: không được gọi Prisma gì cả (kể cả course.findUnique)
      expect(mockPrisma.course.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.courseBlock.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Nhóm 4: Validation — block không tồn tại / không thuộc course
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Nhóm 5: Validation — khác parentModuleId
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Nhóm 6: Validation — thiếu siblings
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Nhóm 7: Validation — blockIds không khớp siblingIds
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Nhóm 8: Prisma call arguments
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Nhóm 9: Hai giai đoạn update (tạm + chính thức)
  // ---------------------------------------------------------------------------
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
