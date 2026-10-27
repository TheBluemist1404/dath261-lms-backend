import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CourseStatus, EnrollmentStatus } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import type { MyEnrollmentsQueryDto } from './../dto/my-enrollments-query.dto.js';
import { EnrollmentService } from './../enrollment.service.js';

const USER_ID = 'student-1';
const COURSE_ID = 'course-1';

function makeCourse(overrides: Record<string, unknown> = {}) {
  return {
    id: COURSE_ID,
    title: 'Introduction to Networking',
    status: CourseStatus.PUBLISHED,
    isSuspended: false,
    enrollmentStartAt: null as Date | null,
    enrollmentEndAt: null as Date | null,
    ...overrides,
  };
}

function makeEnrollment(status: EnrollmentStatus = EnrollmentStatus.ACTIVE) {
  return {
    id: 'enrollment-1',
    userId: USER_ID,
    courseId: COURSE_ID,
    status,
    enrolledAt: new Date('2026-01-01T00:00:00.000Z'),
    leftAt: status === EnrollmentStatus.LEFT ? new Date('2026-02-01T00:00:00.000Z') : null,
    completedAt:
      status === EnrollmentStatus.COMPLETED ? new Date('2026-03-01T00:00:00.000Z') : null,
  };
}

const txMock = {
  course: {
    findUnique: vi.fn(),
  },
  enrollment: {
    findUnique: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
};

const prismaMock = {
  $transaction: vi.fn(async (callback: (tx: typeof txMock) => unknown) => callback(txMock)),
  course: {
    findUnique: vi.fn(),
  },
  enrollment: {
    findUnique: vi.fn(),
    count: vi.fn(),
    findMany: vi.fn(),
  },
};

describe('EnrollmentService', () => {
  let service: EnrollmentService;

  beforeEach(() => {
    vi.resetAllMocks();

    prismaMock.$transaction.mockImplementation(async (callback) => callback(txMock));

    txMock.course.findUnique.mockResolvedValue(makeCourse());
    txMock.enrollment.findUnique.mockResolvedValue(null);

    prismaMock.course.findUnique.mockResolvedValue(makeCourse());
    prismaMock.enrollment.findUnique.mockResolvedValue(null);
    prismaMock.enrollment.count.mockResolvedValue(0);
    prismaMock.enrollment.findMany.mockResolvedValue([]);

    service = new EnrollmentService(prismaMock as unknown as PrismaService);
  });

  describe('enroll', () => {
    it('creates an ACTIVE enrollment for an eligible course', async () => {
      const created = makeEnrollment();

      txMock.enrollment.create.mockResolvedValue(created);

      const result = await service.enroll(USER_ID, COURSE_ID);

      expect(txMock.course.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: COURSE_ID },
        }),
      );

      expect(txMock.enrollment.create).toHaveBeenCalledWith({
        data: {
          userId: USER_ID,
          courseId: COURSE_ID,
          status: EnrollmentStatus.ACTIVE,
        },
      });

      expect(result).toEqual(created);
    });

    it('throws NotFoundException when the course does not exist', async () => {
      txMock.course.findUnique.mockResolvedValue(null);

      await expect(service.enroll(USER_ID, COURSE_ID)).rejects.toBeInstanceOf(NotFoundException);

      expect(txMock.enrollment.create).not.toHaveBeenCalled();
    });

    it('rejects enrollment when the course is Draft', async () => {
      txMock.course.findUnique.mockResolvedValue(makeCourse({ status: CourseStatus.DRAFT }));

      await expect(service.enroll(USER_ID, COURSE_ID)).rejects.toBeInstanceOf(ConflictException);

      expect(txMock.enrollment.create).not.toHaveBeenCalled();
    });

    it('rejects enrollment when the course is suspended', async () => {
      txMock.course.findUnique.mockResolvedValue(makeCourse({ isSuspended: true }));

      await expect(service.enroll(USER_ID, COURSE_ID)).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects enrollment before the enrollment window opens', async () => {
      txMock.course.findUnique.mockResolvedValue(
        makeCourse({
          enrollmentStartAt: new Date(Date.now() + 60_000),
        }),
      );

      await expect(service.enroll(USER_ID, COURSE_ID)).rejects.toThrow(
        'The enrollment window has not opened.',
      );
    });

    it('rejects enrollment after the enrollment window closes', async () => {
      txMock.course.findUnique.mockResolvedValue(
        makeCourse({
          enrollmentEndAt: new Date(Date.now() - 60_000),
        }),
      );

      await expect(service.enroll(USER_ID, COURSE_ID)).rejects.toThrow(
        'The enrollment window has closed.',
      );
    });

    it('rejects duplicate ACTIVE enrollment', async () => {
      txMock.enrollment.findUnique.mockResolvedValue(makeEnrollment(EnrollmentStatus.ACTIVE));

      await expect(service.enroll(USER_ID, COURSE_ID)).rejects.toBeInstanceOf(ConflictException);

      expect(txMock.enrollment.create).not.toHaveBeenCalled();
      expect(txMock.enrollment.updateMany).not.toHaveBeenCalled();
    });

    it('rejects re-enrollment when enrollment is COMPLETED', async () => {
      txMock.enrollment.findUnique.mockResolvedValue(makeEnrollment(EnrollmentStatus.COMPLETED));

      await expect(service.enroll(USER_ID, COURSE_ID)).rejects.toBeInstanceOf(ConflictException);

      expect(txMock.enrollment.updateMany).not.toHaveBeenCalled();
    });

    it('reactivates the existing LEFT enrollment without creating another record', async () => {
      const existing = makeEnrollment(EnrollmentStatus.LEFT);
      const reactivated = {
        ...existing,
        status: EnrollmentStatus.ACTIVE,
        leftAt: null,
      };

      txMock.enrollment.findUnique.mockResolvedValue(existing);
      txMock.enrollment.updateMany.mockResolvedValue({ count: 1 });
      txMock.enrollment.findUniqueOrThrow.mockResolvedValue(reactivated);

      const result = await service.enroll(USER_ID, COURSE_ID);

      expect(txMock.enrollment.updateMany).toHaveBeenCalledWith({
        where: {
          id: existing.id,
          userId: USER_ID,
          courseId: COURSE_ID,
          status: EnrollmentStatus.LEFT,
        },
        data: {
          status: EnrollmentStatus.ACTIVE,
          leftAt: null,
        },
      });

      expect(txMock.enrollment.create).not.toHaveBeenCalled();
      expect(result.status).toBe(EnrollmentStatus.ACTIVE);
      expect(result.id).toBe(existing.id);
    });

    it('rejects reactivation if the enrollment state changes concurrently', async () => {
      txMock.enrollment.findUnique.mockResolvedValue(makeEnrollment(EnrollmentStatus.LEFT));
      txMock.enrollment.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.enroll(USER_ID, COURSE_ID)).rejects.toBeInstanceOf(ConflictException);
    });

    it('converts a Prisma P2002 error into ConflictException', async () => {
      txMock.enrollment.create.mockRejectedValue({
        code: 'P2002',
      });

      await expect(service.enroll(USER_ID, COURSE_ID)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('leave', () => {
    it('changes ACTIVE enrollment to LEFT and sets leftAt', async () => {
      const existing = makeEnrollment(EnrollmentStatus.ACTIVE);
      const left = {
        ...existing,
        status: EnrollmentStatus.LEFT,
        leftAt: new Date(),
      };

      txMock.enrollment.findUnique.mockResolvedValue(existing);
      txMock.enrollment.updateMany.mockResolvedValue({ count: 1 });
      txMock.enrollment.findUniqueOrThrow.mockResolvedValue(left);

      const result = await service.leave(USER_ID, COURSE_ID);

      expect(txMock.enrollment.updateMany).toHaveBeenCalledWith({
        where: {
          id: existing.id,
          userId: USER_ID,
          courseId: COURSE_ID,
          status: EnrollmentStatus.ACTIVE,
        },
        data: {
          status: EnrollmentStatus.LEFT,
          leftAt: expect.any(Date),
        },
      });

      expect(txMock.enrollment.create).not.toHaveBeenCalled();
      expect(result.status).toBe(EnrollmentStatus.LEFT);
      expect(result.id).toBe(existing.id);
    });

    it('throws NotFoundException when no enrollment exists', async () => {
      txMock.enrollment.findUnique.mockResolvedValue(null);

      await expect(service.leave(USER_ID, COURSE_ID)).rejects.toBeInstanceOf(NotFoundException);

      expect(txMock.enrollment.updateMany).not.toHaveBeenCalled();
    });

    it('rejects leaving an enrollment that is already LEFT', async () => {
      txMock.enrollment.findUnique.mockResolvedValue(makeEnrollment(EnrollmentStatus.LEFT));

      await expect(service.leave(USER_ID, COURSE_ID)).rejects.toBeInstanceOf(ConflictException);

      expect(txMock.enrollment.updateMany).not.toHaveBeenCalled();
    });

    it('rejects leaving a COMPLETED enrollment', async () => {
      txMock.enrollment.findUnique.mockResolvedValue(makeEnrollment(EnrollmentStatus.COMPLETED));

      await expect(service.leave(USER_ID, COURSE_ID)).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects the transition if the enrollment state changes concurrently', async () => {
      txMock.enrollment.findUnique.mockResolvedValue(makeEnrollment(EnrollmentStatus.ACTIVE));
      txMock.enrollment.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.leave(USER_ID, COURSE_ID)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('getMyEnrollments', () => {
    it('returns the requested page and correct pagination metadata', async () => {
      const active = {
        ...makeEnrollment(EnrollmentStatus.ACTIVE),
        course: makeCourse(),
      };

      const left = {
        ...makeEnrollment(EnrollmentStatus.LEFT),
        id: 'enrollment-2',
        courseId: 'course-2',
        course: makeCourse({ id: 'course-2' }),
      };

      prismaMock.enrollment.count.mockResolvedValue(5);
      prismaMock.enrollment.findMany.mockResolvedValue([active, left]);

      const query = {
        page: 2,
        limit: 2,
      } as MyEnrollmentsQueryDto;

      const result = await service.getMyEnrollments(USER_ID, query);

      expect(prismaMock.enrollment.count).toHaveBeenCalledWith({
        where: { userId: USER_ID },
      });

      expect(prismaMock.enrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: USER_ID },
          skip: 2,
          take: 2,
          orderBy: [{ enrolledAt: 'desc' }, { id: 'desc' }],
        }),
      );

      expect(result.data).toHaveLength(2);
      expect(result.data[0].canAccessCourse).toBe(true);
      expect(result.data[1].canAccessCourse).toBe(false);

      expect(result.meta).toEqual({
        page: 2,
        limit: 2,
        total: 5,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: true,
      });
    });

    it('returns zero total pages when there are no enrollments', async () => {
      prismaMock.enrollment.count.mockResolvedValue(0);
      prismaMock.enrollment.findMany.mockResolvedValue([]);

      const result = await service.getMyEnrollments(USER_ID, {
        page: 1,
        limit: 10,
      });

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
      expect(result.meta.totalPages).toBe(0);
      expect(result.meta.hasNextPage).toBe(false);
      expect(result.meta.hasPreviousPage).toBe(false);
    });

    it('marks a course unavailable when it becomes Draft', async () => {
      prismaMock.enrollment.count.mockResolvedValue(1);
      prismaMock.enrollment.findMany.mockResolvedValue([
        {
          ...makeEnrollment(EnrollmentStatus.ACTIVE),
          course: makeCourse({ status: CourseStatus.DRAFT }),
        },
      ]);

      const result = await service.getMyEnrollments(USER_ID, {
        page: 1,
        limit: 10,
      });

      expect(result.data[0].courseAvailable).toBe(false);
      expect(result.data[0].canAccessCourse).toBe(false);
    });

    it('marks a suspended course unavailable', async () => {
      prismaMock.enrollment.count.mockResolvedValue(1);
      prismaMock.enrollment.findMany.mockResolvedValue([
        {
          ...makeEnrollment(EnrollmentStatus.ACTIVE),
          course: makeCourse({ isSuspended: true }),
        },
      ]);

      const result = await service.getMyEnrollments(USER_ID, {
        page: 1,
        limit: 10,
      });

      expect(result.data[0].courseAvailable).toBe(false);
      expect(result.data[0].canAccessCourse).toBe(false);
    });
  });

  describe('getCourseEnrollmentState', () => {
    it('returns null enrollment fields when the student has never enrolled', async () => {
      prismaMock.course.findUnique.mockResolvedValue(makeCourse());
      prismaMock.enrollment.findUnique.mockResolvedValue(null);

      const result = await service.getCourseEnrollmentState(USER_ID, COURSE_ID);

      expect(result).toMatchObject({
        courseId: COURSE_ID,
        enrollmentId: null,
        enrollmentStatus: null,
        courseAvailable: true,
        canAccessCourse: false,
      });
    });

    it('allows access for an ACTIVE enrollment in an available course', async () => {
      prismaMock.course.findUnique.mockResolvedValue(makeCourse());
      prismaMock.enrollment.findUnique.mockResolvedValue({
        ...makeEnrollment(EnrollmentStatus.ACTIVE),
      });

      const result = await service.getCourseEnrollmentState(USER_ID, COURSE_ID);

      expect(result.canAccessCourse).toBe(true);
    });

    it('denies access for a LEFT enrollment', async () => {
      prismaMock.course.findUnique.mockResolvedValue(makeCourse());
      prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment(EnrollmentStatus.LEFT));

      const result = await service.getCourseEnrollmentState(USER_ID, COURSE_ID);

      expect(result.canAccessCourse).toBe(false);
    });

    it('denies access when the course becomes Draft', async () => {
      prismaMock.course.findUnique.mockResolvedValue(makeCourse({ status: CourseStatus.DRAFT }));
      prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment(EnrollmentStatus.ACTIVE));

      const result = await service.getCourseEnrollmentState(USER_ID, COURSE_ID);

      expect(result.courseAvailable).toBe(false);
      expect(result.canAccessCourse).toBe(false);
    });

    it('throws NotFoundException when the course does not exist', async () => {
      prismaMock.course.findUnique.mockResolvedValue(null);

      await expect(service.getCourseEnrollmentState(USER_ID, COURSE_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('assertCanAccessCourse', () => {
    it('allows a student enrolled in an available course', async () => {
      prismaMock.course.findUnique.mockResolvedValue(makeCourse());
      prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment(EnrollmentStatus.ACTIVE));

      await expect(service.assertCanAccessCourse(USER_ID, COURSE_ID)).resolves.toBeUndefined();
    });

    it('throws ForbiddenException for a LEFT enrollment', async () => {
      prismaMock.course.findUnique.mockResolvedValue(makeCourse());
      prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment(EnrollmentStatus.LEFT));

      await expect(service.assertCanAccessCourse(USER_ID, COURSE_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException when the course is unavailable', async () => {
      prismaMock.course.findUnique.mockResolvedValue(makeCourse({ isSuspended: true }));
      prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment(EnrollmentStatus.ACTIVE));

      await expect(service.assertCanAccessCourse(USER_ID, COURSE_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
