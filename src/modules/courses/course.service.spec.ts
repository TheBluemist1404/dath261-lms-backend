// course.service.spec.ts

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { AuditAction, AuditEntityType, CourseStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CourseService } from './course.service.js';
import type { CourseQueryDto } from './dto/course-query.dto.js';
import type { CreateCourseDto } from './dto/create-course.dto.js';
import type { UpdateCourseDto } from './dto/update-course.dto.js';
import type { UpdateCourseStatusDto } from './dto/update-course-status.dto.js';

// ---------------------------------------------------------------------------
// Helper dùng chung
// ---------------------------------------------------------------------------
const buildLecturer = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'lecturer-1',
  firstName: 'Nguyen',
  lastName: 'An',
  ...overrides,
});

const buildCourse = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'course-1',
  title: 'Course title',
  description: null,
  prerequisites: null,
  status: CourseStatus.DRAFT,
  isSuspended: false,
  lecturerId: 'lecturer-1',
  enrollmentStartAt: null,
  enrollmentEndAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  lecturer: buildLecturer(),
  _count: { enrollments: 0 },
  ...overrides,
});

// Include object mà service dùng — phải khớp chính xác để assertion pass.
const lecturerInclude = {
  lecturer: { select: { id: true, firstName: true, lastName: true } },
};
const mockAuditService = {
  record: vi.fn(),
};

// ---------------------------------------------------------------------------
// findAllByLecturer
// ---------------------------------------------------------------------------
describe('CourseService - findAllByLecturer', () => {
  let service: CourseService;

  const mockPrisma = {
    course: {
      findMany: vi.fn(),
    },
  };

  const lecturerId = 'lecturer-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<CourseService>(CourseService);
    vi.clearAllMocks();
  });

  it('should query courses by lecturerId with lecturer include and active enrollment count', async () => {
    const courses = [
      buildCourse({ id: 'course-1', _count: { enrollments: 3 } }),
      buildCourse({
        id: 'course-2',
        title: 'Another',
        _count: { enrollments: 0 },
      }),
    ];
    mockPrisma.course.findMany.mockResolvedValue(courses);

    const result = await service.findAllByLecturer(lecturerId);

    expect(mockPrisma.course.findMany).toHaveBeenCalledWith({
      where: { lecturerId },
      orderBy: { createdAt: 'desc' },
      include: {
        ...lecturerInclude,
        _count: {
          select: {
            enrollments: { where: { status: 'ACTIVE' } },
          },
        },
      },
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(
      expect.objectContaining({
        id: 'course-1',
        lecturer: { id: 'lecturer-1', name: 'Nguyen An' },
        enrollmentCount: 3,
      }),
    );
    expect(result[1].enrollmentCount).toBe(0);
  });

  it('should return empty array when lecturer has no courses', async () => {
    mockPrisma.course.findMany.mockResolvedValue([]);

    const result = await service.findAllByLecturer(lecturerId);

    expect(result).toEqual([]);
  });

  it('should fall back to "Unknown" when lecturer name is missing', async () => {
    mockPrisma.course.findMany.mockResolvedValue([
      buildCourse({
        lecturer: { id: 'lecturer-1', firstName: null, lastName: null },
      }),
    ]);

    const result = await service.findAllByLecturer(lecturerId);

    expect(result[0].lecturer.name).toBe('Unknown');
  });
});

// ---------------------------------------------------------------------------
// findAllPublished
// ---------------------------------------------------------------------------
describe('CourseService - findAllPublished', () => {
  let service: CourseService;

  const mockPrisma = {
    course: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<CourseService>(CourseService);
    vi.clearAllMocks();

    // Default: $transaction([countPromise, findManyPromise]) → resolve to [total, rows]
    // We wire it so tests only need to mock count & findMany.
    mockPrisma.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
  });

  const buildQuery = (overrides: Partial<CourseQueryDto> = {}): CourseQueryDto =>
    ({ ...overrides }) as CourseQueryDto;

  it('should query PUBLISHED non-suspended with default pagination/sort and return meta', async () => {
    mockPrisma.course.count.mockResolvedValue(1);
    mockPrisma.course.findMany.mockResolvedValue([buildCourse({ status: CourseStatus.PUBLISHED })]);

    const result = await service.findAllPublished(buildQuery());

    expect(mockPrisma.course.count).toHaveBeenCalledWith({
      where: {
        status: CourseStatus.PUBLISHED,
        isSuspended: false,
      },
    });
    expect(mockPrisma.course.findMany).toHaveBeenCalledWith({
      where: {
        status: CourseStatus.PUBLISHED,
        isSuspended: false,
      },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 20,
      include: lecturerInclude,
    });
    expect(result.data).toHaveLength(1);
    expect(result.meta).toEqual({
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
      hasNextPage: false,
      hasPrevPage: false,
    });
  });

  it('should apply search across title/description/prerequisites', async () => {
    mockPrisma.course.count.mockResolvedValue(0);
    mockPrisma.course.findMany.mockResolvedValue([]);

    await service.findAllPublished(buildQuery({ search: '  nestjs  ' }));

    const where = mockPrisma.course.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { title: { contains: 'nestjs', mode: 'insensitive' } },
      { description: { contains: 'nestjs', mode: 'insensitive' } },
      { prerequisites: { contains: 'nestjs', mode: 'insensitive' } },
    ]);
  });

  it('should ignore empty/whitespace search', async () => {
    mockPrisma.course.count.mockResolvedValue(0);
    mockPrisma.course.findMany.mockResolvedValue([]);

    await service.findAllPublished(buildQuery({ search: '   ' }));

    const where = mockPrisma.course.findMany.mock.calls[0][0].where;
    expect(where.OR).toBeUndefined();
  });

  it('should filter by lecturerId', async () => {
    mockPrisma.course.count.mockResolvedValue(0);
    mockPrisma.course.findMany.mockResolvedValue([]);

    await service.findAllPublished(buildQuery({ lecturerId: 'lecturer-9' }));

    const where = mockPrisma.course.findMany.mock.calls[0][0].where;
    expect(where.lecturerId).toBe('lecturer-9');
  });

  it('should filter by enrollmentOpen=true (null boundaries = open-ended)', async () => {
    mockPrisma.course.count.mockResolvedValue(0);
    mockPrisma.course.findMany.mockResolvedValue([]);

    await service.findAllPublished(buildQuery({ enrollmentOpen: 'true' }));

    const where = mockPrisma.course.findMany.mock.calls[0][0].where;
    expect(where.AND).toHaveLength(2);
    expect(where.AND[0]).toEqual({
      OR: [{ enrollmentStartAt: null }, { enrollmentStartAt: { lte: expect.any(Date) } }],
    });
    expect(where.AND[1]).toEqual({
      OR: [{ enrollmentEndAt: null }, { enrollmentEndAt: { gte: expect.any(Date) } }],
    });
  });

  it('should not add enrollmentOpen filter when false', async () => {
    mockPrisma.course.count.mockResolvedValue(0);
    mockPrisma.course.findMany.mockResolvedValue([]);

    await service.findAllPublished(buildQuery({ enrollmentOpen: 'false' }));

    const where = mockPrisma.course.findMany.mock.calls[0][0].where;
    expect(where.AND).toBeUndefined();
  });

  it('should apply custom sort and pagination', async () => {
    mockPrisma.course.count.mockResolvedValue(42);
    mockPrisma.course.findMany.mockResolvedValue([]);

    const result = await service.findAllPublished(
      buildQuery({ sortBy: 'title', sortOrder: 'asc', page: 3, limit: 10 }),
    );

    expect(mockPrisma.course.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { title: 'asc' },
        skip: 20,
        take: 10,
      }),
    );
    expect(result.meta).toEqual({
      total: 42,
      page: 3,
      limit: 10,
      totalPages: 5,
      hasNextPage: true,
      hasPrevPage: true,
    });
  });

  it('should return totalPages=0 and no next/prev when result is empty', async () => {
    mockPrisma.course.count.mockResolvedValue(0);
    mockPrisma.course.findMany.mockResolvedValue([]);

    const result = await service.findAllPublished(buildQuery());

    expect(result.meta).toEqual({
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
      hasNextPage: false,
      hasPrevPage: false,
    });
  });
});

// ---------------------------------------------------------------------------
// findOne
// ---------------------------------------------------------------------------
describe('CourseService - findOne', () => {
  let service: CourseService;

  const mockPrisma = {
    course: {
      findUnique: vi.fn(),
    },
  };

  const courseId = 'course-1';
  const ownerId = 'lecturer-1';
  const otherId = 'lecturer-2';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<CourseService>(CourseService);
    vi.clearAllMocks();
  });

  it('should include lecturer relation', async () => {
    mockPrisma.course.findUnique.mockResolvedValue(buildCourse());

    await service.findOne(courseId, ownerId);

    expect(mockPrisma.course.findUnique).toHaveBeenCalledWith({
      where: { id: courseId },
      include: lecturerInclude,
    });
  });

  it('should throw NotFoundException when course does not exist', async () => {
    mockPrisma.course.findUnique.mockResolvedValue(null);

    await expect(service.findOne(courseId, ownerId)).rejects.toThrow(
      new NotFoundException('Course not found.'),
    );
  });

  it('should allow owner to read DRAFT course and expose lecturer summary', async () => {
    mockPrisma.course.findUnique.mockResolvedValue(buildCourse({ status: CourseStatus.DRAFT }));

    const result = await service.findOne(courseId, ownerId);

    expect(result.id).toBe(courseId);
    expect(result.lecturer).toEqual({ id: 'lecturer-1', name: 'Nguyen An' });
    // findOne không trả enrollmentCount
    expect(result.enrollmentCount).toBeUndefined();
  });

  it('should allow non-owner to read PUBLISHED non-suspended course', async () => {
    mockPrisma.course.findUnique.mockResolvedValue(
      buildCourse({ status: CourseStatus.PUBLISHED, isSuspended: false }),
    );

    const result = await service.findOne(courseId, otherId);

    expect(result.id).toBe(courseId);
  });

  it('should throw NotFoundException when non-owner reads DRAFT course', async () => {
    mockPrisma.course.findUnique.mockResolvedValue(buildCourse({ status: CourseStatus.DRAFT }));

    await expect(service.findOne(courseId, otherId)).rejects.toThrow(NotFoundException);
  });

  it('should throw NotFoundException when non-owner reads suspended course', async () => {
    mockPrisma.course.findUnique.mockResolvedValue(
      buildCourse({ status: CourseStatus.PUBLISHED, isSuspended: true }),
    );

    await expect(service.findOne(courseId, otherId)).rejects.toThrow(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------
describe('CourseService - create', () => {
  let service: CourseService;

  const mockPrisma = {
    course: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  const lecturerId = 'lecturer-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<CourseService>(CourseService);
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mockPrisma) => Promise<unknown>) => callback(mockPrisma),
    );
  });

  const buildDto = (overrides: Partial<CreateCourseDto> = {}): CreateCourseDto =>
    ({ title: 'New course', ...overrides }) as CreateCourseDto;

  it('should create course in DRAFT status with null optional fields and lecturer include', async () => {
    const dto = buildDto();
    mockPrisma.course.create.mockResolvedValue(buildCourse());

    await service.create(lecturerId, dto);

    expect(mockPrisma.course.create).toHaveBeenCalledWith({
      data: {
        title: 'New course',
        description: null,
        prerequisites: null,
        enrollmentStartAt: null,
        enrollmentEndAt: null,
        lecturerId,
        status: CourseStatus.DRAFT,
        isSuspended: false,
      },
      include: lecturerInclude,
    });

    expect(mockAuditService.record).toHaveBeenCalledWith(
      {
        actorId: lecturerId,
        action: AuditAction.COURSE_CREATED,
        entityType: AuditEntityType.COURSE,
        entityId: 'course-1',
      },
      mockPrisma,
    );
  });

  it('should parse enrollment dates to Date', async () => {
    const dto = buildDto({
      enrollmentStartAt: '2026-01-01T00:00:00.000Z',
      enrollmentEndAt: '2026-02-01T00:00:00.000Z',
    });
    mockPrisma.course.create.mockResolvedValue(buildCourse());

    await service.create(lecturerId, dto);

    expect(mockAuditService.record).toHaveBeenCalledWith(
      {
        actorId: lecturerId,
        action: AuditAction.COURSE_CREATED,
        entityType: AuditEntityType.COURSE,
        entityId: 'course-1',
      },
      mockPrisma,
    );
  });

  it('should return DTO with lecturer summary', async () => {
    mockPrisma.course.create.mockResolvedValue(buildCourse());

    const result = await service.create(lecturerId, buildDto());

    expect(result.lecturer).toEqual({ id: 'lecturer-1', name: 'Nguyen An' });

    expect(mockAuditService.record).toHaveBeenCalledWith(
      {
        actorId: lecturerId,
        action: AuditAction.COURSE_CREATED,
        entityType: AuditEntityType.COURSE,
        entityId: 'course-1',
      },
      mockPrisma,
    );
  });

  it('should throw BadRequestException when start >= end', async () => {
    const dto = buildDto({
      enrollmentStartAt: '2026-02-01T00:00:00.000Z',
      enrollmentEndAt: '2026-01-01T00:00:00.000Z',
    });

    await expect(service.create(lecturerId, dto)).rejects.toThrow(
      new BadRequestException('enrollmentStartAt must be before enrollmentEndAt.'),
    );
    expect(mockPrisma.course.create).not.toHaveBeenCalled();
    expect(mockAuditService.record).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------
describe('CourseService - update', () => {
  let service: CourseService;

  const mockPrisma = {
    course: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  const courseId = 'course-1';
  const lecturerId = 'lecturer-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<CourseService>(CourseService);
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mockPrisma) => Promise<unknown>) => callback(mockPrisma),
    );
    mockPrisma.course.findUnique.mockResolvedValue(buildCourse({ lecturerId }));
  });

  const buildDto = (overrides: Partial<UpdateCourseDto> = {}): UpdateCourseDto =>
    ({ ...overrides }) as UpdateCourseDto;

  it('should throw NotFoundException when course does not exist', async () => {
    mockPrisma.course.findUnique.mockResolvedValue(null);

    await expect(service.update(courseId, lecturerId, buildDto({ title: 'New' }))).rejects.toThrow(
      NotFoundException,
    );
    expect(mockPrisma.course.update).not.toHaveBeenCalled();
    expect(mockAuditService.record).not.toHaveBeenCalled();
  });

  it('should throw ForbiddenException when lecturer does not own the course', async () => {
    mockPrisma.course.findUnique.mockResolvedValue(buildCourse({ lecturerId: 'other' }));

    await expect(service.update(courseId, lecturerId, buildDto({ title: 'New' }))).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockPrisma.course.update).not.toHaveBeenCalled();
    expect(mockAuditService.record).not.toHaveBeenCalled();
  });

  it('should only update provided fields with lecturer include', async () => {
    mockPrisma.course.update.mockResolvedValue(buildCourse());

    await service.update(courseId, lecturerId, buildDto({ title: 'New' }));

    expect(mockPrisma.course.update).toHaveBeenCalledWith({
      where: { id: courseId },
      data: { title: 'New' },
      include: lecturerInclude,
    });

    expect(mockAuditService.record).toHaveBeenCalledWith(
      {
        actorId: lecturerId,
        action: AuditAction.COURSE_UPDATED,
        entityType: AuditEntityType.COURSE,
        entityId: courseId,
        metadata: {
          changedFields: ['title'],
        },
      },
      mockPrisma,
    );
  });

  it('should set enrollmentEndAt to null when dto passes null', async () => {
    mockPrisma.course.update.mockResolvedValue(buildCourse());

    await service.update(courseId, lecturerId, {
      enrollmentEndAt: null,
    } as UpdateCourseDto);

    expect(mockPrisma.course.update).toHaveBeenCalledWith({
      where: { id: courseId },
      data: { enrollmentEndAt: null },
      include: lecturerInclude,
    });

    expect(mockAuditService.record).toHaveBeenCalledWith(
      {
        actorId: lecturerId,
        action: AuditAction.COURSE_UPDATED,
        entityType: AuditEntityType.COURSE,
        entityId: courseId,
        metadata: {
          changedFields: ['enrollmentEndAt'],
        },
      },
      mockPrisma,
    );
  });

  it('should keep enrollmentEndAt when field is not provided (undefined)', async () => {
    mockPrisma.course.update.mockResolvedValue(buildCourse());

    await service.update(courseId, lecturerId, buildDto({ title: 'New' }));

    const callArg = mockPrisma.course.update.mock.calls[0][0];
    expect(callArg.data).not.toHaveProperty('enrollmentEndAt');
    expect(mockAuditService.record).toHaveBeenCalledWith(
      {
        actorId: lecturerId,
        action: AuditAction.COURSE_UPDATED,
        entityType: AuditEntityType.COURSE,
        entityId: courseId,
        metadata: {
          changedFields: ['title'],
        },
      },
      mockPrisma,
    );
  });

  it('should throw BadRequestException when merged window is invalid', async () => {
    mockPrisma.course.findUnique.mockResolvedValue(
      buildCourse({
        lecturerId,
        enrollmentStartAt: new Date('2026-01-01T00:00:00.000Z'),
        enrollmentEndAt: new Date('2026-02-01T00:00:00.000Z'),
      }),
    );

    await expect(
      service.update(courseId, lecturerId, {
        enrollmentEndAt: '2025-12-31T00:00:00.000Z',
      } as UpdateCourseDto),
    ).rejects.toThrow(new BadRequestException('enrollmentStartAt must be before enrollmentEndAt.'));
    expect(mockPrisma.course.update).not.toHaveBeenCalled();
    expect(mockAuditService.record).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// updateStatus
// ---------------------------------------------------------------------------
describe('CourseService - updateStatus', () => {
  let service: CourseService;

  const mockPrisma = {
    course: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    courseBlock: {
      count: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  const courseId = 'course-1';
  const lecturerId = 'lecturer-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourseService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<CourseService>(CourseService);
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mockPrisma) => Promise<unknown>) => callback(mockPrisma),
    );
    mockPrisma.course.findUnique.mockResolvedValue(buildCourse({ lecturerId }));
  });

  const buildDto = (status: CourseStatus): UpdateCourseStatusDto =>
    ({ status }) as UpdateCourseStatusDto;

  it('should throw NotFoundException when course does not exist', async () => {
    mockPrisma.course.findUnique.mockResolvedValue(null);

    await expect(
      service.updateStatus(courseId, lecturerId, buildDto(CourseStatus.PUBLISHED)),
    ).rejects.toThrow(NotFoundException);
    expect(mockAuditService.record).not.toHaveBeenCalled();
  });

  it('should throw ForbiddenException when lecturer does not own the course', async () => {
    mockPrisma.course.findUnique.mockResolvedValue(buildCourse({ lecturerId: 'other' }));

    await expect(
      service.updateStatus(courseId, lecturerId, buildDto(CourseStatus.PUBLISHED)),
    ).rejects.toThrow(ForbiddenException);
    expect(mockAuditService.record).not.toHaveBeenCalled();
  });

  it('should publish course when it has at least one block', async () => {
    mockPrisma.courseBlock.count.mockResolvedValue(1);
    mockPrisma.course.update.mockResolvedValue(buildCourse({ status: CourseStatus.PUBLISHED }));

    const result = await service.updateStatus(
      courseId,
      lecturerId,
      buildDto(CourseStatus.PUBLISHED),
    );

    expect(mockPrisma.courseBlock.count).toHaveBeenCalledWith({
      where: { courseId },
    });
    expect(mockPrisma.course.update).toHaveBeenCalledWith({
      where: { id: courseId },
      data: { status: CourseStatus.PUBLISHED },
      include: lecturerInclude,
    });
    expect(result.status).toBe(CourseStatus.PUBLISHED);

    expect(mockAuditService.record).toHaveBeenCalledWith(
      {
        actorId: lecturerId,
        action: AuditAction.COURSE_STATUS_CHANGED,
        entityType: AuditEntityType.COURSE,
        entityId: courseId,
        metadata: {
          from: CourseStatus.DRAFT,
          to: CourseStatus.PUBLISHED,
        },
      },
      mockPrisma,
    );
  });

  it('should throw BadRequestException when publishing an empty course', async () => {
    mockPrisma.courseBlock.count.mockResolvedValue(0);

    await expect(
      service.updateStatus(courseId, lecturerId, buildDto(CourseStatus.PUBLISHED)),
    ).rejects.toThrow(new BadRequestException('Cannot publish an empty course.'));
    expect(mockPrisma.course.update).not.toHaveBeenCalled();
    expect(mockAuditService.record).not.toHaveBeenCalled();
  });

  it('should not check blocks when transitioning to DRAFT', async () => {
    mockPrisma.course.update.mockResolvedValue(buildCourse({ status: CourseStatus.DRAFT }));

    await service.updateStatus(courseId, lecturerId, buildDto(CourseStatus.DRAFT));

    expect(mockPrisma.courseBlock.count).not.toHaveBeenCalled();
    expect(mockPrisma.course.update).toHaveBeenCalledWith({
      where: { id: courseId },
      data: { status: CourseStatus.DRAFT },
      include: lecturerInclude,
    });
    expect(mockAuditService.record).toHaveBeenCalledWith(
      {
        actorId: lecturerId,
        action: AuditAction.COURSE_STATUS_CHANGED,
        entityType: AuditEntityType.COURSE,
        entityId: courseId,
        metadata: {
          from: CourseStatus.DRAFT,
          to: CourseStatus.DRAFT,
        },
      },
      mockPrisma,
    );
  });
});
