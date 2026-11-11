import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AccountStatus,
  AuditAction,
  AuditEntityType,
  CourseStatus,
  ReportStatus,
  ReportTargetType,
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
    report: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  };

  const mockPrisma = {
    user: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    course: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    report: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    message: {
      findUnique: vi.fn(),
    },
    auditEntry: {
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
        undefined,
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
        undefined,
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

  // ---------------------------------------------------------------------------
  // Reports
  // ---------------------------------------------------------------------------

  describe('reports', () => {
    const createdAt = new Date('2026-11-10T10:00:00.000Z');

    const reporter = {
      id: 'reporter-1',
      email: 'reporter@example.com',
      firstName: 'An',
      lastName: 'Nguyen',
    };

    const buildReport = (overrides: Record<string, unknown> = {}) => ({
      id: 'report-1',
      reporterId: reporter.id,
      reporter,
      targetType: ReportTargetType.USER,
      targetId: 'target-1',
      reason: 'Harassment',
      description: null,
      status: ReportStatus.PENDING,
      reviewedAt: null,
      createdAt,
      ...overrides,
    });

    it('1. should return an empty list with default pagination', async () => {
      mockPrisma.report.count.mockResolvedValue(0);
      mockPrisma.report.findMany.mockResolvedValue([]);

      const result = await service.listReports({});

      expect(mockPrisma.report.count).toHaveBeenCalledWith({
        where: {},
      });

      expect(mockPrisma.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          skip: 0,
          take: 20,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
      );

      expect(result).toEqual({
        items: [],
        page: 1,
        pageSize: 20,
        total: 0,
      });
    });

    it('2. should apply status, targetType and pagination filters', async () => {
      mockPrisma.report.count.mockResolvedValue(0);
      mockPrisma.report.findMany.mockResolvedValue([]);

      await service.listReports({
        status: ReportStatus.PENDING,
        targetType: ReportTargetType.MESSAGE,
        page: 2,
        pageSize: 10,
      });

      const where = {
        status: ReportStatus.PENDING,
        targetType: ReportTargetType.MESSAGE,
      };

      expect(mockPrisma.report.count).toHaveBeenCalledWith({ where });

      expect(mockPrisma.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where,
          skip: 10,
          take: 10,
        }),
      );
    });

    it('3. should resolve MESSAGE target and expose its sender name', async () => {
      mockPrisma.report.count.mockResolvedValue(1);
      mockPrisma.report.findMany.mockResolvedValue([
        buildReport({
          targetType: ReportTargetType.MESSAGE,
          targetId: 'message-1',
        }),
      ]);

      mockPrisma.message.findUnique.mockResolvedValue({
        id: 'message-1',
        sender: {
          firstName: 'Mai',
          lastName: 'Tran',
        },
        page: { archivedAt: null, workspace: { archivedAt: null } },
      });

      const result = await service.listReports({});

      expect(result.items[0]).toEqual({
        id: 'report-1',
        status: ReportStatus.PENDING,
        reason: 'Harassment',
        description: null,
        createdAt,
        reporter: {
          id: reporter.id,
          name: 'An Nguyen',
        },
        target: {
          type: ReportTargetType.MESSAGE,
          id: 'message-1',
          name: 'Message by Mai Tran',
          available: true,
        },
      });
    });

    it('4. should resolve USER and COURSE targets', async () => {
      mockPrisma.report.count.mockResolvedValue(2);
      mockPrisma.report.findMany.mockResolvedValue([
        buildReport({
          id: 'report-user',
          targetType: ReportTargetType.USER,
          targetId: 'user-1',
        }),
        buildReport({
          id: 'report-course',
          targetType: ReportTargetType.COURSE,
          targetId: 'course-1',
        }),
      ]);

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'target@example.com',
        firstName: 'Target',
        lastName: 'User',
        status: AccountStatus.ACTIVE,
      });

      mockPrisma.course.findUnique.mockResolvedValue({
        id: 'course-1',
        title: 'Introduction to NestJS',
        isSuspended: false,
        status: CourseStatus.PUBLISHED,
      });

      const result = await service.listReports({});

      expect(result.items[0].target).toEqual({
        type: ReportTargetType.USER,
        id: 'user-1',
        name: 'Target User',
        available: true,
      });

      expect(result.items[1].target).toEqual({
        type: ReportTargetType.COURSE,
        id: 'course-1',
        name: 'Introduction to NestJS',
        available: true,
      });
    });

    it('5. should return [Deleted] for a hard-deleted target', async () => {
      mockPrisma.report.count.mockResolvedValue(1);
      mockPrisma.report.findMany.mockResolvedValue([
        buildReport({
          targetType: ReportTargetType.COURSE,
          targetId: 'deleted-course',
        }),
      ]);
      mockPrisma.course.findUnique.mockResolvedValue(null);

      const result = await service.listReports({});

      expect(result.items[0].target).toEqual({
        type: ReportTargetType.COURSE,
        id: 'deleted-course',
        name: '[Deleted]',
        available: false,
      });
    });

    it('6. should throw 404 when the report does not exist', async () => {
      mockPrisma.report.findUnique.mockResolvedValue(null);

      await expect(service.getReport('missing-report')).rejects.toThrow(NotFoundException);
    });

    it('7. should return MESSAGE detail and synthesize RECEIVED history', async () => {
      mockPrisma.report.findUnique.mockResolvedValue(
        buildReport({
          targetType: ReportTargetType.MESSAGE,
          targetId: 'message-1',
        }),
      );

      mockPrisma.message.findUnique
        .mockResolvedValueOnce({
          id: 'message-1',
          sender: {
            firstName: 'Mai',
            lastName: 'Tran',
          },
          page: { archivedAt: null, workspace: { archivedAt: null } },
        })
        .mockResolvedValueOnce({
          id: 'message-1',
          content: 'Reported message content',
          sender: {
            id: 'sender-1',
            firstName: 'Mai',
            lastName: 'Tran',
          },
          page: {
            title: 'Project Discussion',
            workspace: {
              name: 'Collaborative Workspace',
            },
          },
        });

      mockPrisma.auditEntry.findMany.mockResolvedValue([
        {
          id: 'audit-dismissed',
          action: AuditAction.REPORT_REVIEWED,
          entityType: AuditEntityType.REPORT,
          metadata: {
            status: ReportStatus.DISMISSED,
            reason: 'The report does not violate policy',
          },
          createdAt: new Date('2026-11-10T11:00:00.000Z'),
          actor: {
            id: 'admin-1',
            firstName: 'Admin',
            lastName: 'User',
          },
        },
      ]);

      const result = await service.getReport('report-1');

      expect(result.message).toEqual({
        location: 'Collaborative Workspace → Project Discussion',
        author: {
          id: 'sender-1',
          name: 'Mai Tran',
        },
        content: 'Reported message content',
      });

      expect(result.history).toEqual([
        {
          id: 'received:report-1',
          action: 'RECEIVED',
          actor: {
            id: reporter.id,
            name: 'An Nguyen',
          },
          createdAt,
          reasonRecorded: 'Harassment',
        },
        {
          id: 'audit-dismissed',
          action: 'DISMISSED',
          actor: {
            id: 'admin-1',
            name: 'Admin User',
          },
          createdAt: new Date('2026-11-10T11:00:00.000Z'),
          reasonRecorded: 'The report does not violate policy',
        },
      ]);

      const detailQuery = mockPrisma.message.findUnique.mock.calls[1][0];

      expect(detailQuery.select).toEqual({
        id: true,
        content: true,
        sender: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        page: {
          select: {
            title: true,
            workspace: {
              select: {
                name: true,
              },
            },
          },
        },
      });

      expect(detailQuery.select.page.select).not.toHaveProperty('content');
      expect(detailQuery.select.page.select).not.toHaveProperty('yjsState');
      expect(detailQuery.select.page.select).not.toHaveProperty('messages');
    });

    it.each([
      {
        targetType: ReportTargetType.USER,
        targetId: 'user-1',
        entityType: AuditEntityType.USER,
        action: AuditAction.ACCOUNT_STATUS_CHANGED,
        metadata: {
          from: AccountStatus.ACTIVE,
          to: AccountStatus.SUSPENDED,
          reason: 'Repeated violations',
        },
        expectedHistoryAction: 'USER_SUSPENDED',
      },
      {
        targetType: ReportTargetType.COURSE,
        targetId: 'course-1',
        entityType: AuditEntityType.COURSE,
        action: AuditAction.COURSE_STATUS_CHANGED,
        metadata: {
          fromSuspended: false,
          toSuspended: true,
          reason: 'Course content requires review',
        },
        expectedHistoryAction: 'COURSE_SUSPENDED',
      },
    ])('8. should map $expectedHistoryAction from target audit entries', async ({
      targetType,
      targetId,
      entityType,
      action,
      metadata,
      expectedHistoryAction,
    }) => {
      mockPrisma.report.findUnique.mockResolvedValue(
        buildReport({
          targetType,
          targetId,
        }),
      );

      if (targetType === ReportTargetType.USER) {
        mockPrisma.user.findUnique.mockResolvedValue({
          id: targetId,
          email: 'target@example.com',
          firstName: 'Target',
          lastName: 'User',
          status: AccountStatus.ACTIVE,
        });
      } else {
        mockPrisma.course.findUnique.mockResolvedValue({
          id: targetId,
          title: 'Course title',
          isSuspended: false,
        });
      }

      mockPrisma.auditEntry.findMany.mockResolvedValue([
        {
          id: 'audit-action',
          action,
          entityType,
          metadata,
          createdAt: new Date('2026-11-10T11:00:00.000Z'),
          actor: {
            id: 'admin-1',
            firstName: 'Admin',
            lastName: 'User',
          },
        },
      ]);

      const result = await service.getReport('report-1');

      expect(result.history).toContainEqual({
        id: 'audit-action',
        action: expectedHistoryAction,
        actor: {
          id: 'admin-1',
          name: 'Admin User',
        },
        createdAt: new Date('2026-11-10T11:00:00.000Z'),
        reasonRecorded: metadata.reason,
      });
    });

    it.each([
      {
        current: null,
        expected: NotFoundException,
      },
      {
        current: {
          id: 'report-1',
          status: ReportStatus.DISMISSED,
        },
        expected: ConflictException,
      },
    ])('9. should reject reviewing a missing or non-pending report', async ({
      current,
      expected,
    }) => {
      transaction.report.findUnique.mockResolvedValue(current);

      await expect(
        service.reviewReport('report-1', 'admin-1', {
          status: ReportStatus.ACTION_TAKEN,
          reason: 'Policy violation confirmed',
        }),
      ).rejects.toThrow(expected);

      expect(transaction.report.updateMany).not.toHaveBeenCalled();
      expect(mockAuditService.record).not.toHaveBeenCalled();
    });

    it('10. should review a pending report and write audit metadata', async () => {
      const reviewedReport = buildReport({
        targetType: ReportTargetType.USER,
        targetId: 'target-1',
        status: ReportStatus.ACTION_TAKEN,
        reviewedAt: new Date('2026-11-10T11:00:00.000Z'),
      });

      transaction.report.findUnique
        .mockResolvedValueOnce({
          id: 'report-1',
          status: ReportStatus.PENDING,
        })
        .mockResolvedValueOnce(reviewedReport);

      transaction.report.updateMany.mockResolvedValue({ count: 1 });

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'target-1',
        email: 'target@example.com',
        firstName: 'Target',
        lastName: 'User',
        status: AccountStatus.ACTIVE,
      });

      mockAuditService.record.mockResolvedValue({ id: 'audit-1' });

      const result = await service.reviewReport('report-1', 'admin-1', {
        status: ReportStatus.ACTION_TAKEN,
        reason: 'Policy violation confirmed',
      });

      expect(transaction.report.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'report-1',
          status: ReportStatus.PENDING,
        },
        data: {
          status: ReportStatus.ACTION_TAKEN,
          reviewedAt: expect.any(Date),
        },
      });

      expect(mockAuditService.record).toHaveBeenCalledWith(
        {
          actorId: 'admin-1',
          action: AuditAction.REPORT_REVIEWED,
          entityType: AuditEntityType.REPORT,
          entityId: 'report-1',
          metadata: {
            status: ReportStatus.ACTION_TAKEN,
            reason: 'Policy violation confirmed',
          },
        },
        transaction,
      );

      expect(result.status).toBe(ReportStatus.ACTION_TAKEN);
      expect(result.target.available).toBe(true);
    });

    describe('resolveTarget - MESSAGE availability', () => {
      const setupMessageReport = () => {
        mockPrisma.report.count.mockResolvedValue(1);
        mockPrisma.report.findMany.mockResolvedValue([
          buildReport({
            targetType: ReportTargetType.MESSAGE,
            targetId: 'message-1',
          }),
        ]);
      };

      const buildMessage = (pageArchivedAt: Date | null, workspaceArchivedAt: Date | null) => ({
        id: 'message-1',
        sender: {
          firstName: 'Mai',
          lastName: 'Tran',
        },
        page: {
          title: 'Project Discussion',
          archivedAt: pageArchivedAt,
          workspace: {
            name: 'Collaborative Workspace',
            archivedAt: workspaceArchivedAt,
          },
        },
      });

      it('should mark a message as available when its page and workspace are active', async () => {
        setupMessageReport();

        mockPrisma.message.findUnique.mockResolvedValue(buildMessage(null, null));

        const result = await service.listReports({});

        expect(result.items[0].target.available).toBe(true);

        expect(mockPrisma.message.findUnique).toHaveBeenCalledWith({
          where: { id: 'message-1' },
          select: {
            id: true,
            sender: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
            page: {
              select: {
                title: true,
                archivedAt: true,
                workspace: {
                  select: {
                    name: true,
                    archivedAt: true,
                  },
                },
              },
            },
          },
        });
      });

      it('should mark a message as unavailable when its page is archived', async () => {
        setupMessageReport();

        mockPrisma.message.findUnique.mockResolvedValue(
          buildMessage(new Date('2026-11-10T10:00:00.000Z'), null),
        );

        const result = await service.listReports({});

        expect(result.items[0].target.available).toBe(false);
      });

      it('should mark a message as unavailable when its workspace is archived', async () => {
        setupMessageReport();

        mockPrisma.message.findUnique.mockResolvedValue(
          buildMessage(null, new Date('2026-11-10T10:00:00.000Z')),
        );

        const result = await service.listReports({});

        expect(result.items[0].target.available).toBe(false);
      });
    });

    describe('resolveTarget - USER availability', () => {
      const setupUserReport = () => {
        mockPrisma.report.count.mockResolvedValue(1);
        mockPrisma.report.findMany.mockResolvedValue([
          buildReport({
            targetType: ReportTargetType.USER,
            targetId: 'user-1',
          }),
        ]);
      };

      const buildUser = (status: AccountStatus) => ({
        id: 'user-1',
        email: 'target@example.com',
        firstName: 'Target',
        lastName: 'User',
        status,
      });

      it('should mark an ACTIVE user as available', async () => {
        setupUserReport();

        mockPrisma.user.findUnique.mockResolvedValue(buildUser(AccountStatus.ACTIVE));

        const result = await service.listReports({});

        expect(result.items[0].target).toEqual({
          type: ReportTargetType.USER,
          id: 'user-1',
          name: 'Target User',
          available: true,
        });

        expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
          where: { id: 'user-1' },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            status: true,
          },
        });
      });

      it('should mark a SUSPENDED user as unavailable', async () => {
        setupUserReport();

        mockPrisma.user.findUnique.mockResolvedValue(buildUser(AccountStatus.SUSPENDED));

        const result = await service.listReports({});

        expect(result.items[0].target).toEqual({
          type: ReportTargetType.USER,
          id: 'user-1',
          name: 'Target User',
          available: false,
        });
      });
    });

    describe('resolveTarget - COURSE availability', () => {
      const setupCourseReport = () => {
        mockPrisma.report.count.mockResolvedValue(1);
        mockPrisma.report.findMany.mockResolvedValue([
          buildReport({
            targetType: ReportTargetType.COURSE,
            targetId: 'course-1',
          }),
        ]);
      };

      const buildCourseTarget = (status: CourseStatus, isSuspended: boolean) => ({
        id: 'course-1',
        title: 'Introduction to NestJS',
        status,
        isSuspended,
      });

      it('should mark a PUBLISHED non-suspended course as available', async () => {
        setupCourseReport();

        mockPrisma.course.findUnique.mockResolvedValue(
          buildCourseTarget(CourseStatus.PUBLISHED, false),
        );

        const result = await service.listReports({});

        expect(result.items[0].target).toEqual({
          type: ReportTargetType.COURSE,
          id: 'course-1',
          name: 'Introduction to NestJS',
          available: true,
        });

        expect(mockPrisma.course.findUnique).toHaveBeenCalledWith({
          where: { id: 'course-1' },
          select: {
            id: true,
            title: true,
            status: true,
            isSuspended: true,
          },
        });
      });

      it('should mark a suspended PUBLISHED course as unavailable', async () => {
        setupCourseReport();

        mockPrisma.course.findUnique.mockResolvedValue(
          buildCourseTarget(CourseStatus.PUBLISHED, true),
        );

        const result = await service.listReports({});

        expect(result.items[0].target.available).toBe(false);
      });

      it('should mark a non-suspended DRAFT course as unavailable', async () => {
        setupCourseReport();

        mockPrisma.course.findUnique.mockResolvedValue(
          buildCourseTarget(CourseStatus.DRAFT, false),
        );

        const result = await service.listReports({});

        expect(result.items[0].target.available).toBe(false);
      });
    });
  });
});
