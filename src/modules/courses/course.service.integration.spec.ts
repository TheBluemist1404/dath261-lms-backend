// course.service.integration.spec.ts
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AuditAction,
  AuditEntityType,
  BlockType,
  CourseStatus,
  EnrollmentStatus,
  UserRole,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CourseService } from './course.service.js';
import type { CourseQueryDto } from './dto/course-query.dto.js';

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
      providers: [PrismaService, CourseService, AuditService],
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
    // Xóa enrollment của course do integration test tạo
    // (cả enrollment của student-integration và của student khác nếu có)
    await prisma.auditEntry.deleteMany({
      where: {
        actor: {
          email: {
            startsWith: PREFIX,
          },
        },
      },
    });

    await prisma.enrollment.deleteMany({
      where: {
        OR: [
          { course: { lecturer: { email: { startsWith: PREFIX } } } },
          { user: { email: { startsWith: PREFIX } } },
        ],
      },
    });

    // Xóa courseBlock của course do integration test tạo
    await prisma.courseBlock.deleteMany({
      where: { course: { lecturer: { email: { startsWith: PREFIX } } } },
    });

    // Xóa course do integration test tạo
    await prisma.course.deleteMany({
      where: { lecturer: { email: { startsWith: PREFIX } } },
    });

    // Xóa user do integration test tạo (lecturer + student)
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
        firstName: 'Nguyen',
        lastName: 'An',
        role: UserRole.LECTURER,
      },
    });
    lecturerB = await prisma.user.create({
      data: {
        email: `${PREFIX}lecturer-b@example.com`,
        passwordHash: 'hash',
        firstName: 'Tran',
        lastName: 'Binh',
        role: UserRole.LECTURER,
      },
    });
  });

  function createCourse(overrides: {
    lecturerId: string;
    title?: string;
    description?: string | null;
    prerequisites?: string | null;
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
        ...(overrides.description !== undefined && { description: overrides.description }),
        ...(overrides.prerequisites !== undefined && { prerequisites: overrides.prerequisites }),
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

  async function createStudentEnrollment(
    courseId: string,
    status: EnrollmentStatus,
    emailSuffix: string,
  ) {
    const student = await prisma.user.create({
      data: {
        email: `${PREFIX}student-${emailSuffix}@example.com`,
        passwordHash: 'hash',
        role: UserRole.STUDENT,
      },
    });
    return prisma.enrollment.create({
      data: { userId: student.id, courseId, status },
    });
  }

  // ---------------------------------------------------------------------------
  // findAllByLecturer
  // ---------------------------------------------------------------------------
  describe('findAllByLecturer', () => {
    it('should return only courses owned by the lecturer, newest first, with lecturer summary', async () => {
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
      expect(result[0].lecturer).toEqual({ id: lecturerA.id, name: 'Nguyen An' });
    });

    it('should return only ACTIVE enrollment count per course', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        title: 'Counting',
      });

      await createStudentEnrollment(course.id, EnrollmentStatus.ACTIVE, 'a1');
      await createStudentEnrollment(course.id, EnrollmentStatus.ACTIVE, 'a2');
      await createStudentEnrollment(course.id, EnrollmentStatus.LEFT, 'l1');
      await createStudentEnrollment(course.id, EnrollmentStatus.COMPLETED, 'c1');

      const result = await service.findAllByLecturer(lecturerA.id);

      expect(result).toHaveLength(1);
      expect(result[0].enrollmentCount).toBe(2);
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
    const q = (overrides: Partial<CourseQueryDto> = {}): CourseQueryDto =>
      ({
        lecturerId: lecturerA.id,
        ...overrides,
      }) as CourseQueryDto;

    it('should return only PUBLISHED and non-suspended courses with meta', async () => {
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

      const result = await service.findAllPublished(q());

      expect(result.data.map((c) => c.title)).toEqual(['published']);
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(20);
    });

    it('should not leak courses from other lecturers that are not published', async () => {
      await createCourse({
        lecturerId: lecturerB.id,
        title: 'b-draft',
        status: CourseStatus.DRAFT,
      });

      const result = await service.findAllPublished(q({ lecturerId: lecturerB.id }));

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });

    it('should search by title, description, and prerequisites (case-insensitive)', async () => {
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'NestJS Fundamentals',
        status: CourseStatus.PUBLISHED,
      });
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'React Basics',
        description: 'Learn nestjs patterns',
        status: CourseStatus.PUBLISHED,
      });
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'Advanced TS',
        prerequisites: 'Know NestJS first',
        status: CourseStatus.PUBLISHED,
      });
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'Unrelated',
        status: CourseStatus.PUBLISHED,
      });

      const result = await service.findAllPublished(q({ search: 'NESTJS' }));

      expect(result.data.map((c) => c.title).sort()).toEqual([
        'Advanced TS',
        'NestJS Fundamentals',
        'React Basics',
      ]);
      expect(result.meta.total).toBe(3);
    });

    it('should filter by lecturerId', async () => {
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'by-A',
        status: CourseStatus.PUBLISHED,
      });
      await createCourse({
        lecturerId: lecturerB.id,
        title: 'by-B',
        status: CourseStatus.PUBLISHED,
      });

      const result = await service.findAllPublished(q({ lecturerId: lecturerB.id }));

      expect(result.data.map((c) => c.title)).toEqual(['by-B']);
    });

    it('should filter by enrollmentOpen=true', async () => {
      const now = new Date();
      const past = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const future = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      await createCourse({
        lecturerId: lecturerA.id,
        title: 'open-both-null',
        status: CourseStatus.PUBLISHED,
      });
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'open-within',
        status: CourseStatus.PUBLISHED,
        enrollmentStartAt: past,
        enrollmentEndAt: future,
      });
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'closed-future',
        status: CourseStatus.PUBLISHED,
        enrollmentStartAt: future,
        enrollmentEndAt: future,
      });
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'closed-past',
        status: CourseStatus.PUBLISHED,
        enrollmentStartAt: past,
        enrollmentEndAt: past,
      });

      const result = await service.findAllPublished(q({ enrollmentOpen: 'true' }));

      expect(result.data.map((c) => c.title).sort()).toEqual(['open-both-null', 'open-within']);
    });

    it('should sort by title ascending', async () => {
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'Zeta',
        status: CourseStatus.PUBLISHED,
      });
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'Alpha',
        status: CourseStatus.PUBLISHED,
      });
      await createCourse({
        lecturerId: lecturerA.id,
        title: 'Mike',
        status: CourseStatus.PUBLISHED,
      });

      const result = await service.findAllPublished(q({ sortBy: 'title', sortOrder: 'asc' }));

      expect(result.data.map((c) => c.title)).toEqual(['Alpha', 'Mike', 'Zeta']);
    });

    it('should paginate results', async () => {
      for (let i = 0; i < 5; i++) {
        await createCourse({
          lecturerId: lecturerA.id,
          title: `c-${i}`,
          status: CourseStatus.PUBLISHED,
          createdAt: new Date(`2026-01-0${i + 1}T00:00:00.000Z`),
        });
      }

      const page1 = await service.findAllPublished(q({ page: 1, limit: 2 }));
      const page2 = await service.findAllPublished(q({ page: 2, limit: 2 }));
      const page3 = await service.findAllPublished(q({ page: 3, limit: 2 }));

      expect(page1.data.map((c) => c.title)).toEqual(['c-4', 'c-3']);
      expect(page1.meta).toMatchObject({
        total: 5,
        page: 1,
        limit: 2,
        totalPages: 3,
        hasNextPage: true,
        hasPrevPage: false,
      });

      expect(page2.data.map((c) => c.title)).toEqual(['c-2', 'c-1']);
      expect(page2.meta.hasPrevPage).toBe(true);
      expect(page2.meta.hasNextPage).toBe(true);

      expect(page3.data.map((c) => c.title)).toEqual(['c-0']);
      expect(page3.meta.hasNextPage).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // findOne
  // ---------------------------------------------------------------------------
  describe('findOne', () => {
    it('should allow owner to read a DRAFT course with lecturer summary', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.DRAFT,
      });

      const result = await service.findOne(course.id, lecturerA.id);

      expect(result.id).toBe(course.id);
      expect(result.lecturer).toEqual({ id: lecturerA.id, name: 'Nguyen An' });
    });

    it('should allow non-owner to read a PUBLISHED non-suspended course', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.PUBLISHED,
      });

      const result = await service.findOne(course.id, lecturerB.id);

      expect(result.id).toBe(course.id);
    });

    it('should throw NotFoundException when non-owner reads a DRAFT course', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.DRAFT,
      });

      await expect(service.findOne(course.id, lecturerB.id)).rejects.toThrow('Course not found.');
    });

    it('should throw NotFoundException when non-owner reads a suspended course', async () => {
      const course = await createCourse({
        lecturerId: lecturerA.id,
        status: CourseStatus.PUBLISHED,
        isSuspended: true,
      });

      await expect(service.findOne(course.id, lecturerB.id)).rejects.toThrow('Course not found.');
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
      expect(created.lecturer).toEqual({ id: lecturerA.id, name: 'Nguyen An' });

      const persisted = await prisma.course.findUniqueOrThrow({ where: { id: created.id } });
      expect(persisted.description).toBeNull();
      expect(persisted.prerequisites).toBeNull();
      expect(persisted.enrollmentStartAt).toBeNull();
      expect(persisted.enrollmentEndAt).toBeNull();

      const audit = await prisma.auditEntry.findFirstOrThrow({
        where: {
          actorId: lecturerA.id,
          action: AuditAction.COURSE_CREATED,
          entityType: AuditEntityType.COURSE,
          entityId: created.id,
        },
      });
      expect(audit.metadata).toBeNull();
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
      const audit = await prisma.auditEntry.findFirstOrThrow({
        where: {
          actorId: lecturerA.id,
          action: AuditAction.COURSE_CREATED,
          entityType: AuditEntityType.COURSE,
          entityId: created.id,
        },
      });

      expect(audit.metadata).toBeNull();
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

      const auditCount = await prisma.auditEntry.count({
        where: {
          actorId: lecturerA.id,
          action: AuditAction.COURSE_CREATED,
          entityType: AuditEntityType.COURSE,
        },
      });

      expect(auditCount).toBe(0);
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
      expect(updated.lecturer).toEqual({ id: lecturerA.id, name: 'Nguyen An' });

      const persisted = await prisma.course.findUniqueOrThrow({ where: { id: course.id } });
      expect(persisted.title).toBe('New');
      expect(persisted.description).toBe('New desc');
      const audit = await prisma.auditEntry.findFirstOrThrow({
        where: {
          actorId: lecturerA.id,
          action: AuditAction.COURSE_UPDATED,
          entityType: AuditEntityType.COURSE,
          entityId: course.id,
        },
      });

      expect(audit.metadata).toEqual({
        changedFields: ['title', 'description'],
      });
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
      const audit = await prisma.auditEntry.findFirstOrThrow({
        where: {
          actorId: lecturerA.id,
          action: AuditAction.COURSE_UPDATED,
          entityType: AuditEntityType.COURSE,
          entityId: course.id,
        },
      });

      expect(audit.metadata).toEqual({
        changedFields: ['enrollmentEndAt'],
      });
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

      const audit = await prisma.auditEntry.findFirstOrThrow({
        where: {
          actorId: lecturerA.id,
          action: AuditAction.COURSE_UPDATED,
          entityType: AuditEntityType.COURSE,
          entityId: course.id,
        },
      });

      expect(audit.metadata).toEqual({
        changedFields: ['title'],
      });
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

      const auditCount = await prisma.auditEntry.count({
        where: {
          actorId: lecturerA.id,
          action: AuditAction.COURSE_UPDATED,
          entityType: AuditEntityType.COURSE,
          entityId: course.id,
        },
      });

      expect(auditCount).toBe(0);
    });

    it('should throw NotFoundException when course does not exist', async () => {
      await expect(
        service.update('non-existent-course', lecturerA.id, { title: 'New' }),
      ).rejects.toThrow('Course not found.');
      const auditCount = await prisma.auditEntry.count({
        where: {
          actorId: lecturerA.id,
          action: AuditAction.COURSE_UPDATED,
          entityType: AuditEntityType.COURSE,
          entityId: 'non-existent-course',
        },
      });

      expect(auditCount).toBe(0);
    });

    it('should throw ForbiddenException when lecturer does not own the course', async () => {
      const course = await createCourse({ lecturerId: lecturerA.id, title: 'Old' });

      await expect(service.update(course.id, lecturerB.id, { title: 'Hacked' })).rejects.toThrow(
        'You do not own this course.',
      );

      const persisted = await prisma.course.findUniqueOrThrow({ where: { id: course.id } });
      expect(persisted.title).toBe('Old');

      const auditCount = await prisma.auditEntry.count({
        where: {
          entityType: AuditEntityType.COURSE,
          entityId: course.id,
          action: AuditAction.COURSE_UPDATED,
        },
      });

      expect(auditCount).toBe(0);
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
      expect(updated.lecturer).toEqual({ id: lecturerA.id, name: 'Nguyen An' });

      const persisted = await prisma.course.findUniqueOrThrow({ where: { id: course.id } });
      expect(persisted.status).toBe(CourseStatus.PUBLISHED);

      const audit = await prisma.auditEntry.findFirstOrThrow({
        where: {
          actorId: lecturerA.id,
          action: AuditAction.COURSE_STATUS_CHANGED,
          entityType: AuditEntityType.COURSE,
          entityId: course.id,
        },
      });

      expect(audit.metadata).toEqual({
        from: CourseStatus.DRAFT,
        to: CourseStatus.PUBLISHED,
      });
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

      const auditCount = await prisma.auditEntry.count({
        where: {
          actorId: lecturerA.id,
          action: AuditAction.COURSE_STATUS_CHANGED,
          entityType: AuditEntityType.COURSE,
          entityId: course.id,
        },
      });

      expect(auditCount).toBe(0);
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

      const audit = await prisma.auditEntry.findFirstOrThrow({
        where: {
          actorId: lecturerA.id,
          action: AuditAction.COURSE_STATUS_CHANGED,
          entityType: AuditEntityType.COURSE,
          entityId: course.id,
        },
      });

      expect(audit.metadata).toEqual({
        from: CourseStatus.PUBLISHED,
        to: CourseStatus.DRAFT,
      });
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

      const auditCount = await prisma.auditEntry.count({
        where: {
          entityType: AuditEntityType.COURSE,
          entityId: course.id,
          action: AuditAction.COURSE_STATUS_CHANGED,
        },
      });

      expect(auditCount).toBe(0);
    });

    it('should throw NotFoundException when course does not exist', async () => {
      await expect(
        service.updateStatus('non-existent-course', lecturerA.id, {
          status: CourseStatus.PUBLISHED,
        }),
      ).rejects.toThrow('Course not found.');

      const auditCount = await prisma.auditEntry.count({
        where: {
          actorId: lecturerA.id,
          action: AuditAction.COURSE_STATUS_CHANGED,
          entityType: AuditEntityType.COURSE,
          entityId: 'non-existent-course',
        },
      });

      expect(auditCount).toBe(0);
    });
  });
});
