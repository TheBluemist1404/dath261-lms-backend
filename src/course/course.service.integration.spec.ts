// course.service.integration.spec.ts
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BlockType, CourseStatus, UserRole } from '../generated/prisma/enums.js';
import { PrismaService } from '../infrastructure/database/prisma/prisma.service.js';
import { CourseService } from './course.service.js';

const PREFIX = 'course-integration-';

describe('CourseService - integration', () => {
  let service: CourseService;
  let prisma: PrismaService;
  let moduleRef: TestingModule;

  let lecturerA: { id: string };
  let lecturerB: { id: string };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env',
        }),
      ],
      providers: [PrismaService, CourseService],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(CourseService);

    await prisma.$connect();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await moduleRef.close();
  });

  async function cleanup() {
    await prisma.courseBlock.deleteMany({
      where: { course: { lecturer: { email: { startsWith: PREFIX } } } },
    });
    await prisma.course.deleteMany({
      where: { lecturer: { email: { startsWith: PREFIX } } },
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
  });

  // Helper tạo course trực tiếp qua Prisma để kiểm soát status/suspended/createdAt.
  function createCourse(overrides: {
    lecturerId: string;
    title?: string;
    status?: CourseStatus;
    isSuspended?: boolean;
    enrollmentStartAt?: Date | null;
    enrollmentEndAt?: Date | null;
    createdAt?: Date;
  }) {
    return prisma.course.create({
      data: {
        title: overrides.title ?? 'Course',
        lecturerId: overrides.lecturerId,
        ...(overrides.status !== undefined && { status: overrides.status }),
        ...(overrides.isSuspended !== undefined && { isSuspended: overrides.isSuspended }),
        ...(overrides.enrollmentStartAt !== undefined && {
          enrollmentStartAt: overrides.enrollmentStartAt,
        }),
        ...(overrides.enrollmentEndAt !== undefined && {
          enrollmentEndAt: overrides.enrollmentEndAt,
        }),
        ...(overrides.createdAt !== undefined && { createdAt: overrides.createdAt }),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // findAllByLecturer
  // ---------------------------------------------------------------------------
  describe('findAllByLecturer', () => {
    it('should return only courses owned by the lecturer, newest first', async () => {
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'A-old',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'A-new',
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
      });
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'A-mid',
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
      });
      await createCourse({ lecturerId: lecturerB.id, title: 'B-only' });

      const result = await service.findAllByLecturer(lecturerA.id);

      expect(result.map((c) => c.title)).toEqual(['A-new', 'A-mid', 'A-old']);
    });

    it('should return empty array when lecturer has no courses', async () => {
      const result = await service.findAllByLecturer(lecturerA.id);

      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // findAllPublished
  // ---------------------------------------------------------------------------
  describe('findAllPublished', () => {
    it('should return only PUBLISHED and non-suspended courses', async () => {
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'draft',
        status: CourseStatus.DRAFT,
      });
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'published',
        status: CourseStatus.PUBLISHED,
      });
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'published-suspended',
        status: CourseStatus.PUBLISHED,
        isSuspended: true,
      });

      const result = await service.findAllPublished();

      expect(result.map((c) => c.title)).toEqual(['published']);
    });

    it('should not leak courses from other lecturers that are not published', async () => {
      await createCourse({
        lecturerId: lecturerB.id,
        title: 'b-draft',
        status: CourseStatus.DRAFT,
      });

      const result = await service.findAllPublished();

      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // findOne
  // ---------------------------------------------------------------------------
  describe('findOne', () => {
    it('should allow owner to read a DRAFT course', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.DRAFT,
      });

      const result = await service.findOne(course.id, lecturerA.id);

      expect(result.id).toBe(course.id);
    });

    it('should allow non-owner to read a PUBLISHED non-suspended course', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.PUBLISHED,
      });

      const result = await service.findOne(course.id, lecturerB.id);

      expect(result.id).toBe(course.id);
    });

    it('should throw ForbiddenException when non-owner reads a DRAFT course', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.DRAFT,
      });

      await expect(service.findOne(course.id, lecturerB.id)).rejects.toThrow(
        'You do not have access to this course.',
      );
    });

    it('should throw ForbiddenException when non-owner reads a suspended course', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.PUBLISHED,
        isSuspended: true,
      });

      await expect(service.findOne(course.id, lecturerB.id)).rejects.toThrow(
        'You do not have access to this course.',
      );
    });

    it('should allow owner to read a suspended course', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.PUBLISHED,
        isSuspended: true,
      });

      const result = await service.findOne(course.id, lecturerA.id);

      expect(result.id).toBe(course.id);
    });

    it('should throw NotFoundException when course does not exist', async () => {
      await expect(service.findOne('non-existent-course', lecturerA.id)).rejects.toThrow(
        'Course not found.',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------
  describe('create', () => {
    it('should create course in DRAFT status with null optional fields', async () => {
      const created = await service.create(lecturerA.id, { title: 'New course' });

      expect(created.status).toBe(CourseStatus.DRAFT);
      expect(created.isSuspended).toBe(false);
      expect(created.lecturerId).toBe(lecturerA.id);

      const persisted = await prisma.course.findUniqueOrThrow({ where: { id: created.id } });
      expect(persisted.description).toBeNull();
      expect(persisted.prerequisites).toBeNull();
      expect(persisted.enrollmentStartAt).toBeNull();
      expect(persisted.enrollmentEndAt).toBeNull();
    });

    it('should persist provided optional fields and parse dates', async () => {
      const created = await service.create(lecturerA.id, {
        title: 'Full course',
        description: 'Desc',
        prerequisites: 'Pre',
        enrollmentStartAt: '2026-01-01T00:00:00.000Z',
        enrollmentEndAt: '2026-02-01T00:00:00.000Z',
      });

      const persisted = await prisma.course.findUniqueOrThrow({ where: { id: created.id } });
      expect(persisted.description).toBe('Desc');
      expect(persisted.prerequisites).toBe('Pre');
      expect(persisted.enrollmentStartAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
      expect(persisted.enrollmentEndAt?.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    });

    it('should throw BadRequestException and not persist when window is invalid', async () => {
      await expect(
        service.create(lecturerA.id, {
          title: 'Invalid',
          enrollmentStartAt: '2026-02-01T00:00:00.000Z',
          enrollmentEndAt: '2026-01-01T00:00:00.000Z',
        }),
      ).rejects.toThrow('enrollmentStartAt must be before enrollmentEndAt.');

      const count = await prisma.course.count({
        where: { lecturerId: lecturerA.id },
      });
      expect(count).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------
  describe('update', () => {
    it('should partially update fields and persist changes', async () => {
      const course = await createCourse({ lecturerId: lecturerA.id, title: 'Old' });

      const updated = await service.update(course.id, lecturerA.id, {
        title: 'New',
        description: 'New desc',
      });

      expect(updated.title).toBe('New');

      const persisted = await prisma.course.findUniqueOrThrow({ where: { id: course.id } });
      expect(persisted.title).toBe('New');
      expect(persisted.description).toBe('New desc');
    });

    it('should set enrollmentEndAt to null when dto passes null', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        enrollmentStartAt: new Date('2026-01-01T00:00:00.000Z'),
        enrollmentEndAt: new Date('2026-02-01T00:00:00.000Z'),
      });

      await service.update(course.id, lecturerA.id, { enrollmentEndAt: null });

      const persisted = await prisma.course.findUniqueOrThrow({ where: { id: course.id } });
      expect(persisted.enrollmentEndAt).toBeNull();
      expect(persisted.enrollmentStartAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });

    it('should keep enrollmentEndAt when field is not provided', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        enrollmentStartAt: new Date('2026-01-01T00:00:00.000Z'),
        enrollmentEndAt: new Date('2026-02-01T00:00:00.000Z'),
      });

      await service.update(course.id, lecturerA.id, { title: 'Renamed' });

      const persisted = await prisma.course.findUniqueOrThrow({ where: { id: course.id } });
      expect(persisted.enrollmentEndAt?.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    });

    it('should reject merged window that becomes invalid after update', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        enrollmentStartAt: new Date('2026-01-01T00:00:00.000Z'),
        enrollmentEndAt: new Date('2026-02-01T00:00:00.000Z'),
      });

      await expect(
        service.update(course.id, lecturerA.id, {
          enrollmentEndAt: '2025-12-31T00:00:00.000Z',
        }),
      ).rejects.toThrow('enrollmentStartAt must be before enrollmentEndAt.');

      const persisted = await prisma.course.findUniqueOrThrow({ where: { id: course.id } });
      expect(persisted.enrollmentEndAt?.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    });

    it('should throw NotFoundException when course does not exist', async () => {
      await expect(
        service.update('non-existent-course', lecturerA.id, { title: 'New' }),
      ).rejects.toThrow('Course not found.');
    });

    it('should throw ForbiddenException when lecturer does not own the course', async () => {
      const course = await createCourse({ lecturerId: lecturerA.id, title: 'Old' });

      await expect(service.update(course.id, lecturerB.id, { title: 'Hacked' })).rejects.toThrow(
        'You do not own this course.',
      );

      const persisted = await prisma.course.findUniqueOrThrow({ where: { id: course.id } });
      expect(persisted.title).toBe('Old');
    });
  });

  // ---------------------------------------------------------------------------
  // updateStatus
  // ---------------------------------------------------------------------------
  describe('updateStatus', () => {
    async function createBlock(courseId: string) {
      return prisma.courseBlock.create({
        data: {
          courseId,
          type: BlockType.TEXT,
          title: 'Block',
          position: 0,
        },
      });
    }

    it('should publish a course that has at least one block', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.DRAFT,
      });
      await createBlock(course.id);

      const updated = await service.updateStatus(course.id, lecturerA.id, {
        status: CourseStatus.PUBLISHED,
      });

      expect(updated.status).toBe(CourseStatus.PUBLISHED);

      const persisted = await prisma.course.findUniqueOrThrow({ where: { id: course.id } });
      expect(persisted.status).toBe(CourseStatus.PUBLISHED);
    });

    it('should reject publishing an empty course', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.DRAFT,
      });

      await expect(
        service.updateStatus(course.id, lecturerA.id, { status: CourseStatus.PUBLISHED }),
      ).rejects.toThrow('Cannot publish an empty course.');

      const persisted = await prisma.course.findUniqueOrThrow({ where: { id: course.id } });
      expect(persisted.status).toBe(CourseStatus.DRAFT);
    });

    it('should allow transitioning PUBLISHED back to DRAFT without block check', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.PUBLISHED,
      });

      const updated = await service.updateStatus(course.id, lecturerA.id, {
        status: CourseStatus.DRAFT,
      });

      expect(updated.status).toBe(CourseStatus.DRAFT);
    });

    it('should throw ForbiddenException when lecturer does not own the course', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.DRAFT,
      });
      await createBlock(course.id);

      await expect(
        service.updateStatus(course.id, lecturerB.id, { status: CourseStatus.PUBLISHED }),
      ).rejects.toThrow('You do not own this course.');

      const persisted = await prisma.course.findUniqueOrThrow({ where: { id: course.id } });
      expect(persisted.status).toBe(CourseStatus.DRAFT);
    });

    it('should throw NotFoundException when course does not exist', async () => {
      await expect(
        service.updateStatus('non-existent-course', lecturerA.id, {
          status: CourseStatus.PUBLISHED,
        }),
      ).rejects.toThrow('Course not found.');
    });
  });
});
