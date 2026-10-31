// course.service.spec.ts

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { CourseStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../infrastructure/database/prisma/prisma.service.js';
import { CourseService } from './course.service.js';
import type { CreateCourseDto } from './dto/create-course.dto.js';
import type { UpdateCourseDto } from './dto/update-course.dto.js';
import type { UpdateCourseStatusDto } from './dto/update-course-status.dto.js';

// ---------------------------------------------------------------------------
// Helper dùng chung
// ---------------------------------------------------------------------------
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
  ...overrides,
});

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
      providers: [CourseService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<CourseService>(CourseService);
    vi.clearAllMocks();
  });

  it('should query courses by lecturerId and map to DTO', async () => {
    const courses = [
      buildCourse({ id: 'course-1' }),
      buildCourse({ id: 'course-2', title: 'Another' }),
    ];
    mockPrisma.course.findMany.mockResolvedValue(courses);

    const result = await service.findAllByLecturer(lecturerId);

    expect(mockPrisma.course.findMany).toHaveBeenCalledWith({
      where: { lecturerId },
      orderBy: { createdAt: 'desc' },
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(expect.objectContaining({ id: 'course-1' }));
  });

  it('should return empty array when lecturer has no courses', async () => {
    mockPrisma.course.findMany.mockResolvedValue([]);

    const result = await service.findAllByLecturer(lecturerId);

    expect(result).toEqual([]);
  });
});

describe('CourseService - findAllPublished', () => {
  let service: CourseService;

  const mockPrisma = {
    course: {
      findMany: vi.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CourseService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<CourseService>(CourseService);
    vi.clearAllMocks();
  });

  it('should only query PUBLISHED and non-suspended courses', async () => {
    mockPrisma.course.findMany.mockResolvedValue([buildCourse({ status: CourseStatus.PUBLISHED })]);

    const result = await service.findAllPublished();

    expect(mockPrisma.course.findMany).toHaveBeenCalledWith({
      where: {
        status: CourseStatus.PUBLISHED,
        isSuspended: false,
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(result).toHaveLength(1);
  });
});

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
      providers: [CourseService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<CourseService>(CourseService);
    vi.clearAllMocks();
  });

  it('should throw NotFoundException when course does not exist', async () => {
    mockPrisma.course.findUnique.mockResolvedValue(null);

    await expect(service.findOne(courseId, ownerId)).rejects.toThrow(
      new NotFoundException('Course not found.'),
    );
  });

  it('should allow owner to read DRAFT course', async () => {
    mockPrisma.course.findUnique.mockResolvedValue(buildCourse({ status: CourseStatus.DRAFT }));

    const result = await service.findOne(courseId, ownerId);

    expect(result.id).toBe(courseId);
  });

  it('should allow non-owner to read PUBLISHED non-suspended course', async () => {
    mockPrisma.course.findUnique.mockResolvedValue(
      buildCourse({ status: CourseStatus.PUBLISHED, isSuspended: false }),
    );

    const result = await service.findOne(courseId, otherId);

    expect(result.id).toBe(courseId);
  });

  it('should throw ForbiddenException when non-owner reads DRAFT course', async () => {
    mockPrisma.course.findUnique.mockResolvedValue(buildCourse({ status: CourseStatus.DRAFT }));

    await expect(service.findOne(courseId, otherId)).rejects.toThrow(ForbiddenException);
  });

  it('should throw ForbiddenException when non-owner reads suspended course', async () => {
    mockPrisma.course.findUnique.mockResolvedValue(
      buildCourse({ status: CourseStatus.PUBLISHED, isSuspended: true }),
    );

    await expect(service.findOne(courseId, otherId)).rejects.toThrow(ForbiddenException);
  });
});

describe('CourseService - create', () => {
  let service: CourseService;

  const mockPrisma = {
    course: {
      create: vi.fn(),
    },
  };

  const lecturerId = 'lecturer-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CourseService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<CourseService>(CourseService);
    vi.clearAllMocks();
  });

  const buildDto = (overrides: Partial<CreateCourseDto> = {}): CreateCourseDto =>
    ({ title: 'New course', ...overrides }) as CreateCourseDto;

  it('should create course in DRAFT status with null optional fields', async () => {
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
    });
  });

  it('should parse enrollment dates to Date', async () => {
    const dto = buildDto({
      enrollmentStartAt: '2026-01-01T00:00:00.000Z',
      enrollmentEndAt: '2026-02-01T00:00:00.000Z',
    });
    mockPrisma.course.create.mockResolvedValue(buildCourse());

    await service.create(lecturerId, dto);

    expect(mockPrisma.course.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        enrollmentStartAt: new Date('2026-01-01T00:00:00.000Z'),
        enrollmentEndAt: new Date('2026-02-01T00:00:00.000Z'),
      }),
    });
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
  });
});

describe('CourseService - update', () => {
  let service: CourseService;

  const mockPrisma = {
    course: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };

  const courseId = 'course-1';
  const lecturerId = 'lecturer-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CourseService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<CourseService>(CourseService);
    vi.clearAllMocks();

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
  });

  it('should throw ForbiddenException when lecturer does not own the course', async () => {
    mockPrisma.course.findUnique.mockResolvedValue(buildCourse({ lecturerId: 'other' }));

    await expect(service.update(courseId, lecturerId, buildDto({ title: 'New' }))).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockPrisma.course.update).not.toHaveBeenCalled();
  });

  it('should only update provided fields', async () => {
    mockPrisma.course.update.mockResolvedValue(buildCourse());

    await service.update(courseId, lecturerId, buildDto({ title: 'New' }));

    expect(mockPrisma.course.update).toHaveBeenCalledWith({
      where: { id: courseId },
      data: { title: 'New' },
    });
  });

  it('should set enrollmentEndAt to null when dto passes null', async () => {
    mockPrisma.course.update.mockResolvedValue(buildCourse());

    await service.update(courseId, lecturerId, { enrollmentEndAt: null } as UpdateCourseDto);

    expect(mockPrisma.course.update).toHaveBeenCalledWith({
      where: { id: courseId },
      data: { enrollmentEndAt: null },
    });
  });

  it('should keep enrollmentEndAt when field is not provided (undefined)', async () => {
    mockPrisma.course.update.mockResolvedValue(buildCourse());

    await service.update(courseId, lecturerId, buildDto({ title: 'New' }));

    const callArg = mockPrisma.course.update.mock.calls[0][0];
    expect(callArg.data).not.toHaveProperty('enrollmentEndAt');
  });

  it('should throw BadRequestException when merged window is invalid', async () => {
    // DB: start = Jan 1, end = Feb 1. DTO changes end to Dec 31 (before start).
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
  });
});

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
  };

  const courseId = 'course-1';
  const lecturerId = 'lecturer-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CourseService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<CourseService>(CourseService);
    vi.clearAllMocks();

    mockPrisma.course.findUnique.mockResolvedValue(buildCourse({ lecturerId }));
  });

  const buildDto = (status: CourseStatus): UpdateCourseStatusDto =>
    ({ status }) as UpdateCourseStatusDto;

  it('should throw NotFoundException when course does not exist', async () => {
    mockPrisma.course.findUnique.mockResolvedValue(null);

    await expect(
      service.updateStatus(courseId, lecturerId, buildDto(CourseStatus.PUBLISHED)),
    ).rejects.toThrow(NotFoundException);
  });

  it('should throw ForbiddenException when lecturer does not own the course', async () => {
    mockPrisma.course.findUnique.mockResolvedValue(buildCourse({ lecturerId: 'other' }));

    await expect(
      service.updateStatus(courseId, lecturerId, buildDto(CourseStatus.PUBLISHED)),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should publish course when it has at least one block', async () => {
    mockPrisma.courseBlock.count.mockResolvedValue(1);
    mockPrisma.course.update.mockResolvedValue(buildCourse({ status: CourseStatus.PUBLISHED }));

    const result = await service.updateStatus(
      courseId,
      lecturerId,
      buildDto(CourseStatus.PUBLISHED),
    );

    expect(mockPrisma.courseBlock.count).toHaveBeenCalledWith({ where: { courseId } });
    expect(mockPrisma.course.update).toHaveBeenCalledWith({
      where: { id: courseId },
      data: { status: CourseStatus.PUBLISHED },
    });
    expect(result.status).toBe(CourseStatus.PUBLISHED);
  });

  it('should throw BadRequestException when publishing an empty course', async () => {
    mockPrisma.courseBlock.count.mockResolvedValue(0);

    await expect(
      service.updateStatus(courseId, lecturerId, buildDto(CourseStatus.PUBLISHED)),
    ).rejects.toThrow(new BadRequestException('Cannot publish an empty course.'));
    expect(mockPrisma.course.update).not.toHaveBeenCalled();
  });

  it('should not check blocks when transitioning to DRAFT', async () => {
    mockPrisma.course.update.mockResolvedValue(buildCourse({ status: CourseStatus.DRAFT }));

    await service.updateStatus(courseId, lecturerId, buildDto(CourseStatus.DRAFT));

    expect(mockPrisma.courseBlock.count).not.toHaveBeenCalled();
    expect(mockPrisma.course.update).toHaveBeenCalledWith({
      where: { id: courseId },
      data: { status: CourseStatus.DRAFT },
    });
  });
});
