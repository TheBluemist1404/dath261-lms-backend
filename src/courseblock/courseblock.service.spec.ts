import { NotFoundException /*, ForbiddenException, BadRequestException*/ } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { PrismaService } from '../infrastructure/database/prisma/prisma.service.js';
import { CourseBlockService } from './courseblock.service.js';

describe('CourseBlockService - create (ownership pass)', () => {
  let service: CourseBlockService;

  const mockPrisma = {
    course: {
      findUnique: vi.fn(),
    },
    courseBlock: {
      create: vi.fn(),
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
  });

  mockPrisma.course.findUnique.mockResolvedValue({
    id: courseId,
    lecturerId, //pass ownership check
  });

  // Test case
  it('create a block', async () => {
    const dto = {
      title: 'Chapter 1',
      type: 'VIDEO',
      position: 0,
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
        position: dto.position,
        content: dto.content,
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
      position: 2,
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
        position: dto.position,
        content: dto.content,
        parentModuleId: null, // ?? null
      },
    });
  });
});

describe('CourseBlockService - update (ownership pass)', () => {
  let service: CourseBlockService;

  const mockPrisma = {
    course: { findUnique: vi.fn() },
    courseBlock: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  };

  const courseId = 'course-abc';
  const blockId = 'block-1';
  const lecturerId = 'lecturer-123';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CourseBlockService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<CourseBlockService>(CourseBlockService);
    vi.clearAllMocks();

    // OWNERSHIP PASS:
    mockPrisma.course.findUnique.mockResolvedValue({
      id: courseId,
      lecturerId,
    });
  });

  // Succesful update
  it('Full update and return result from Prisma', async () => {
    const dto = {
      title: 'Chapter 1 updated',
      type: 'VIDEO',
      position: 2,
      content: { url: 'https://example.com/v2.mp4' },
      // biome-ignore lint/suspicious/noExplicitAny: NestJS request object, can't type it properly
    } as any;

    const existingBlock = { id: blockId, courseId, title: 'Old', position: 1 };
    const updatedBlock = { ...existingBlock, ...dto };
    mockPrisma.courseBlock.findFirst.mockResolvedValue(existingBlock);
    mockPrisma.courseBlock.update.mockResolvedValue(updatedBlock);

    const result = await service.update(courseId, blockId, lecturerId, dto);

    // Verify findFirst call
    expect(mockPrisma.courseBlock.findFirst).toHaveBeenCalledWith({
      where: { id: blockId, courseId },
    });

    // Verify update call
    expect(mockPrisma.courseBlock.update).toHaveBeenCalledWith({
      where: { id: blockId },
      data: {
        title: dto.title,
        type: dto.type,
        position: dto.position,
        content: dto.content,
      },
    });

    expect(result).toEqual(updatedBlock);
  });

  // Partial update
  it('partial update — title', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: NestJS request object, can't type it properly
    const dto = { title: 'Only title changed' } as any;
    mockPrisma.courseBlock.findFirst.mockResolvedValue({ id: blockId, courseId });
    mockPrisma.courseBlock.update.mockResolvedValue({ id: blockId, title: 'Only title changed' });

    await service.update(courseId, blockId, lecturerId, dto);

    // Chỉ title có trong data — các field khác KHÔNG xuất hiện
    expect(mockPrisma.courseBlock.update).toHaveBeenCalledWith({
      where: { id: blockId },
      data: { title: 'Only title changed' },
    });
  });
});

describe('CourseBlockService - remove (ownership pass)', () => {
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
      providers: [CourseBlockService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<CourseBlockService>(CourseBlockService);
    vi.clearAllMocks();

    // OWNERSHIP PASS
    mockPrisma.course.findUnique.mockResolvedValue({
      id: courseId,
      lecturerId,
    });
  });

  //succesful remove
  it('Remove block and return Prisma response', async () => {
    const existingBlock = {
      id: blockId,
      courseId,
      title: 'Chapter 1',
      type: 'VIDEO',
    };
    mockPrisma.courseBlock.findFirst.mockResolvedValue(existingBlock);
    mockPrisma.courseBlock.delete.mockResolvedValue(existingBlock);

    const result = await service.remove(courseId, blockId, lecturerId);

    // Verify findFirst
    expect(mockPrisma.courseBlock.findFirst).toHaveBeenCalledWith({
      where: { id: blockId, courseId },
    });

    // Verify delete
    expect(mockPrisma.courseBlock.delete).toHaveBeenCalledWith({
      where: { id: blockId },
    });

    // return prisma.delete
    expect(result).toEqual(existingBlock);
  });

  // Block does not exist
  it('Throw NotFoundException when findFirst returns null', async () => {
    mockPrisma.courseBlock.findFirst.mockResolvedValue(null);

    await expect(service.remove(courseId, blockId, lecturerId)).rejects.toThrow(NotFoundException);

    // Fail-fast: Not calling delete
    expect(mockPrisma.courseBlock.delete).not.toHaveBeenCalled();
  });

  it('NotFoundException có đúng message', async () => {
    mockPrisma.courseBlock.findFirst.mockResolvedValue(null);

    await expect(service.remove(courseId, blockId, lecturerId)).rejects.toThrow(
      'Course block not found',
    );
  });

  it('findFirst được gọi với đúng where (id + courseId)', async () => {
    mockPrisma.courseBlock.findFirst.mockResolvedValue(null);

    await expect(service.remove(courseId, blockId, lecturerId)).rejects.toThrow(NotFoundException);

    // Quan trọng: where phải có CẢ id và courseId
    // để tránh xóa block của course khác
    expect(mockPrisma.courseBlock.findFirst).toHaveBeenCalledWith({
      where: { id: blockId, courseId },
    });
  });
});

describe('CourseBlockService - reorder (ownership pass)', () => {
  let service: CourseBlockService;

  const mockPrisma = {
    course: { findUnique: vi.fn() },
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
      providers: [CourseBlockService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<CourseBlockService>(CourseBlockService);
    vi.clearAllMocks();

    // OWNERSHIP PASS
    mockPrisma.course.findUnique.mockResolvedValue({
      id: courseId,
      lecturerId,
    });

    // $transaction execute promise and return result
    // biome-ignore lint/suspicious/noExplicitAny: NestJS request object, can't type it properly
    mockPrisma.$transaction.mockImplementation((ops: any[]) => Promise.all(ops));
  });

  it("Update position by blockIds' positions in array and return transaction result", async () => {
    const blockIds = ['block-a', 'block-b', 'block-c'];

    // findMany returns 3 blocks → Belongs to a course
    mockPrisma.courseBlock.findMany.mockResolvedValue([
      { id: 'block-a' },
      { id: 'block-b' },
      { id: 'block-c' },
    ]);

    // Update returns updated block with position
    mockPrisma.courseBlock.update
      .mockResolvedValueOnce({ id: 'block-a', position: 0 })
      .mockResolvedValueOnce({ id: 'block-b', position: 1 })
      .mockResolvedValueOnce({ id: 'block-c', position: 2 });

    const result = await service.reorder(courseId, lecturerId, blockIds);

    // Verify findMany with where querry
    expect(mockPrisma.courseBlock.findMany).toHaveBeenCalledWith({
      where: { courseId, id: { in: blockIds } },
      select: { id: true },
    });

    // Verify update call times
    expect(mockPrisma.courseBlock.update).toHaveBeenCalledTimes(3);
    expect(mockPrisma.courseBlock.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'block-a' },
      data: { position: 0 },
    });
    expect(mockPrisma.courseBlock.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'block-b' },
      data: { position: 1 },
    });
    expect(mockPrisma.courseBlock.update).toHaveBeenNthCalledWith(3, {
      where: { id: 'block-c' },
      data: { position: 2 },
    });

    // Verify $transaction được gọi 1 lần với mảng 3 promise
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.$transaction).toHaveBeenCalledWith(
      expect.arrayContaining([expect.anything(), expect.anything(), expect.anything()]),
    );

    // Kết quả là mảng block đã update
    expect(result).toEqual([
      { id: 'block-a', position: 0 },
      { id: 'block-b', position: 1 },
      { id: 'block-c', position: 2 },
    ]);
  });

  it('reorder 1 block — position = 0', async () => {
    const blockIds = ['block-a'];
    mockPrisma.courseBlock.findMany.mockResolvedValue([{ id: 'block-a' }]);
    mockPrisma.courseBlock.update.mockResolvedValue({ id: 'block-a', position: 0 });

    const result = await service.reorder(courseId, lecturerId, blockIds);

    expect(mockPrisma.courseBlock.update).toHaveBeenCalledWith({
      where: { id: 'block-a' },
      data: { position: 0 },
    });
    expect(result).toEqual([{ id: 'block-a', position: 0 }]);
  });

  it('Blockss positions determine their place (independent from db position)', async () => {
    // blockIds: c, a, b → position: c=0, a=1, b=2
    const blockIds = ['block-c', 'block-a', 'block-b'];

    // findMany results does not matter
    mockPrisma.courseBlock.findMany.mockResolvedValue([
      { id: 'block-a' },
      { id: 'block-b' },
      { id: 'block-c' },
    ]);
    mockPrisma.courseBlock.update
      .mockResolvedValueOnce({ id: 'block-c', position: 0 })
      .mockResolvedValueOnce({ id: 'block-a', position: 1 })
      .mockResolvedValueOnce({ id: 'block-b', position: 2 });

    await service.reorder(courseId, lecturerId, blockIds);

    // position place by index of blockIds, not by findMany
    expect(mockPrisma.courseBlock.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'block-c' },
      data: { position: 0 },
    });
    expect(mockPrisma.courseBlock.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'block-a' },
      data: { position: 1 },
    });
    expect(mockPrisma.courseBlock.update).toHaveBeenNthCalledWith(3, {
      where: { id: 'block-b' },
      data: { position: 2 },
    });
  });
});
