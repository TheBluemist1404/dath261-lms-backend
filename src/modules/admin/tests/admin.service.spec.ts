import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AccountStatus,
  AuditAction,
  AuditEntityType,
  CourseStatus,
  EnrollmentStatus,
  UserRole,
} from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { AuditService } from '../../audit/audit.service.js';
import { UserService } from '../../users/user.service.js';
import { AdminService } from '../admin.service.js';

describe('AdminService', () => {
  let service: AdminService;

  const transaction = {
    authSession: {
      updateMany: vi.fn(),
    },
    course: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };

  const mockPrisma = {
    user: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    course: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  const mockUserService = {
    updateStatus: vi.fn(),
  };

  const mockAuditService = {
    record: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: UserService, useValue: mockUserService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = moduleRef.get(AdminService);

    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction),
    );
  });

  // ---------------------------------------------------------------------------
  // User listing
  // ---------------------------------------------------------------------------

  describe('listUsers', () => {
    it('should search by email/name, filter role/status, and paginate', async () => {
      mockPrisma.user.count.mockResolvedValue(12);
      mockPrisma.user.findMany.mockResolvedValue([]);

      const result = await service.listUsers({
        search: '  Nguyen  ',
        role: UserRole.LECTURER,
        status: AccountStatus.ACTIVE,
        page: 2,
        pageSize: 5,
      });

      const expectedWhere = {
        role: UserRole.LECTURER,
        status: AccountStatus.ACTIVE,
        OR: [
          { email: { contains: 'Nguyen', mode: 'insensitive' } },
          { firstName: { contains: 'Nguyen', mode: 'insensitive' } },
          { lastName: { contains: 'Nguyen', mode: 'insensitive' } },
        ],
      };

      expect(mockPrisma.user.count).toHaveBeenCalledWith({
        where: expectedWhere,
      });

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expectedWhere,
          skip: 5,
          take: 5,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
      );

      expect(result).toEqual({
        items: [],
        page: 2,
        pageSize: 5,
        total: 12,
      });
    });

    it('should use default pagination when page and pageSize are omitted', async () => {
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.user.findMany.mockResolvedValue([]);

      const result = await service.listUsers({});

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
        }),
      );

      expect(result).toEqual({
        items: [],
        page: 1,
        pageSize: 20,
        total: 0,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // User status
  // ---------------------------------------------------------------------------

  describe('updateUserStatus', () => {
    const adminId = 'admin-1';
    const targetUserId = 'student-1';

    const updatedUser = {
      id: targetUserId,
      email: 'student@example.com',
      firstName: 'Test',
      lastName: 'Student',
      role: UserRole.STUDENT,
      status: AccountStatus.SUSPENDED,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    it('should prevent an admin from suspending their own account', async () => {
      await expect(
        service.updateUserStatus(adminId, adminId, {
          status: AccountStatus.SUSPENDED,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockUserService.updateStatus).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when target user does not exist', async () => {
      mockUserService.updateStatus.mockRejectedValue(new NotFoundException('User not found'));

      await expect(
        service.updateUserStatus(targetUserId, adminId, {
          status: AccountStatus.SUSPENDED,
        }),
      ).rejects.toThrow(NotFoundException);

      expect(transaction.authSession.updateMany).not.toHaveBeenCalled();
    });

    it('should update status and revoke active refresh sessions when suspending', async () => {
      mockUserService.updateStatus.mockResolvedValue(updatedUser);
      transaction.authSession.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.updateUserStatus(targetUserId, adminId, {
        status: AccountStatus.SUSPENDED,
      });

      expect(mockUserService.updateStatus).toHaveBeenCalledWith(
        targetUserId,
        AccountStatus.SUSPENDED,
        adminId,
        transaction,
      );

      expect(transaction.authSession.updateMany).toHaveBeenCalledWith({
        where: {
          userId: targetUserId,
          revokedAt: null,
        },
        data: {
          revokedAt: expect.any(Date),
        },
      });

      expect(result).toMatchObject({
        id: targetUserId,
        status: AccountStatus.SUSPENDED,
      });
    });

    it('should not revoke sessions when reactivating a user', async () => {
      const activeUser = {
        ...updatedUser,
        status: AccountStatus.ACTIVE,
      };

      mockUserService.updateStatus.mockResolvedValue(activeUser);

      const result = await service.updateUserStatus(targetUserId, adminId, {
        status: AccountStatus.ACTIVE,
      });

      expect(mockUserService.updateStatus).toHaveBeenCalledWith(
        targetUserId,
        AccountStatus.ACTIVE,
        adminId,
        transaction,
      );

      expect(transaction.authSession.updateMany).not.toHaveBeenCalled();
      expect(result.status).toBe(AccountStatus.ACTIVE);
    });
  });

  // ---------------------------------------------------------------------------
  // Course listing
  // ---------------------------------------------------------------------------

  describe('listCourses', () => {
    it('should search, filter status/suspension, and paginate', async () => {
      mockPrisma.course.count.mockResolvedValue(7);
      mockPrisma.course.findMany.mockResolvedValue([]);

      const result = await service.listCourses({
        search: '  NestJS ',
        status: CourseStatus.PUBLISHED,
        suspended: true,
        page: 2,
        pageSize: 3,
      });

      const expectedWhere = {
        status: CourseStatus.PUBLISHED,
        isSuspended: true,
        OR: [
          { title: { contains: 'NestJS', mode: 'insensitive' } },
          { description: { contains: 'NestJS', mode: 'insensitive' } },
        ],
      };

      expect(mockPrisma.course.count).toHaveBeenCalledWith({
        where: expectedWhere,
      });

      expect(mockPrisma.course.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expectedWhere,
          skip: 3,
          take: 3,
          include: expect.objectContaining({
            lecturer: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          }),
        }),
      );

      expect(result).toEqual({
        items: [],
        page: 2,
        pageSize: 3,
        total: 7,
      });
    });

    it('should preserve suspended=false as a filter', async () => {
      mockPrisma.course.count.mockResolvedValue(0);
      mockPrisma.course.findMany.mockResolvedValue([]);

      await service.listCourses({
        suspended: false,
      });

      expect(mockPrisma.course.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            isSuspended: false,
          },
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Course suspension
  // ---------------------------------------------------------------------------

  describe('updateCourseSuspension', () => {
    const courseId = 'course-1';
    const adminId = 'admin-1';

    const updatedCourse = {
      id: courseId,
      title: 'NestJS Fundamentals',
      status: CourseStatus.PUBLISHED,
      isSuspended: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      lecturer: {
        id: 'lecturer-1',
        firstName: 'Nguyen',
        lastName: 'A',
      },
      _count: {
        enrollments: 3,
      },
    };

    it('should throw NotFoundException when course does not exist', async () => {
      transaction.course.findUnique.mockResolvedValue(null);

      await expect(
        service.updateCourseSuspension(courseId, adminId, {
          suspended: true,
        }),
      ).rejects.toThrow(NotFoundException);

      expect(transaction.course.update).not.toHaveBeenCalled();
      expect(mockAuditService.record).not.toHaveBeenCalled();
    });

    it('should update suspension and write audit entry', async () => {
      transaction.course.findUnique.mockResolvedValue({
        id: courseId,
        isSuspended: false,
      });
      transaction.course.update.mockResolvedValue(updatedCourse);

      const result = await service.updateCourseSuspension(courseId, adminId, {
        suspended: true,
      });

      expect(transaction.course.update).toHaveBeenCalledWith({
        where: { id: courseId },
        data: { isSuspended: true },
        include: expect.any(Object),
      });

      expect(mockAuditService.record).toHaveBeenCalledWith(
        {
          actorId: adminId,
          action: AuditAction.COURSE_STATUS_CHANGED,
          entityType: AuditEntityType.COURSE,
          entityId: courseId,
          metadata: {
            fromSuspended: false,
            toSuspended: true,
          },
        },
        transaction,
      );

      expect(result).toMatchObject({
        id: courseId,
        title: 'NestJS Fundamentals',
        isSuspended: true,
        lecturer: {
          id: 'lecturer-1',
          name: 'Nguyen A',
        },
        enrollmentCount: 3,
      });
    });
  });
});
