import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  AccountStatus,
  AuditAction,
  AuditEntityType,
  EnrollmentStatus,
  ReportStatus,
  ReportTargetType,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { UserService } from '../users/user.service.js';
import { AdminCourseItemDto } from './dto/admin-course-item.dto.js';
import {
  AdminReportDetailDto,
  AdminReportHistoryAction,
  AdminReportHistoryItemDto,
} from './dto/admin-report-detail.dto.js';
import { AdminReportItemDto } from './dto/admin-report-item.dto.js';
import { AdminUserItemDto } from './dto/admin-user-item.dto.js';
import { ListAdminCoursesQueryDto } from './dto/list-admin-courses-query.dto.js';
import { ListAdminReportsQueryDto } from './dto/list-admin-reports-query.dto.js';
import { ListAdminUsersQueryDto } from './dto/list-admin-users-query.dto.js';
import { UpdateCourseSuspensionDto } from './dto/update-course-suspension.dto.js';
import { UpdateReportStatusDto } from './dto/update-report-status.dto.js';
import { UpdateUserStatusDto } from './dto/update-user-status.dto.js';

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;

const adminUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  status: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

const adminReportInclude = {
  reporter: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
    },
  },
} satisfies Prisma.ReportInclude;

type AdminReportRecord = Prisma.ReportGetPayload<{
  include: typeof adminReportInclude;
}>;

const adminCourseInclude = {
  lecturer: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  },
  _count: {
    select: {
      enrollments: {
        where: { status: EnrollmentStatus.ACTIVE },
      },
    },
  },
} satisfies Prisma.CourseInclude;

type AdminCourseRecord = Prisma.CourseGetPayload<{
  include: typeof adminCourseInclude;
}>;

type DisplayNameSource = {
  firstName: string | null;
  lastName: string | null;
  email?: string;
};

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly auditService: AuditService,
  ) {}

  async listUsers(query: ListAdminUsersQueryDto) {
    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const skip = (page - 1) * pageSize;

    const where: Prisma.UserWhereInput = {};

    if (query.role !== undefined) {
      where.role = query.role;
    }

    if (query.status !== undefined) {
      where.status = query.status;
    }

    const search = query.search?.trim();

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: adminUserSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
      }),
    ]);

    return {
      items: users.map((user) => this.toAdminUserItem(user)),
      page,
      pageSize,
      total,
    };
  }

  async updateUserStatus(
    userId: string,
    adminId: string,
    dto: UpdateUserStatusDto,
  ): Promise<AdminUserItemDto> {
    if (userId === adminId && dto.status === AccountStatus.SUSPENDED) {
      throw new BadRequestException('You cannot suspend your own account.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // UserService updates the status and writes the audit entry using this tx.
      const user = await this.userService.updateStatus(userId, dto.status, adminId, tx, dto.reason);

      // Revoke every active refresh session when suspending.
      if (dto.status === AccountStatus.SUSPENDED) {
        await tx.authSession.updateMany({
          where: {
            userId,
            revokedAt: null,
          },
          data: {
            revokedAt: new Date(),
          },
        });
      }

      return user;
    });

    return this.toAdminUserItem(updated);
  }

  async listCourses(query: ListAdminCoursesQueryDto) {
    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const skip = (page - 1) * pageSize;

    const where: Prisma.CourseWhereInput = {};

    if (query.status !== undefined) {
      where.status = query.status;
    }

    if (query.suspended !== undefined) {
      where.isSuspended = query.suspended;
    }

    const search = query.search?.trim();

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, courses] = await Promise.all([
      this.prisma.course.count({ where }),
      this.prisma.course.findMany({
        where,
        include: adminCourseInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
      }),
    ]);

    return {
      items: courses.map((course) => this.toAdminCourseItem(course)),
      page,
      pageSize,
      total,
    };
  }

  async updateCourseSuspension(
    courseId: string,
    adminId: string,
    dto: UpdateCourseSuspensionDto,
  ): Promise<AdminCourseItemDto> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.course.findUnique({
        where: { id: courseId },
        select: {
          id: true,
          isSuspended: true,
        },
      });

      if (!current) {
        throw new NotFoundException('Course not found.');
      }

      const course = await tx.course.update({
        where: { id: courseId },
        data: {
          isSuspended: dto.suspended,
        },
        include: adminCourseInclude,
      });

      await this.auditService.record(
        {
          actorId: adminId,
          action: AuditAction.COURSE_STATUS_CHANGED,
          entityType: AuditEntityType.COURSE,
          entityId: courseId,
          metadata: {
            fromSuspended: current.isSuspended,
            toSuspended: dto.suspended,
            ...(dto.reason !== undefined && { reason: dto.reason }),
          },
        },
        tx,
      );

      return course;
    });

    return this.toAdminCourseItem(updated);
  }

  async listReports(query: ListAdminReportsQueryDto) {
    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const skip = (page - 1) * pageSize;

    const where: Prisma.ReportWhereInput = {};

    if (query.status !== undefined) {
      where.status = query.status;
    }

    if (query.targetType !== undefined) {
      where.targetType = query.targetType;
    }

    const [total, reports] = await Promise.all([
      this.prisma.report.count({ where }),
      this.prisma.report.findMany({
        where,
        include: adminReportInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
      }),
    ]);

    return {
      items: await Promise.all(reports.map((report) => this.toAdminReportItem(report))),
      page,
      pageSize,
      total,
    };
  }

  async getReport(reportId: string): Promise<AdminReportDetailDto> {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: adminReportInclude,
    });

    if (!report) {
      throw new NotFoundException('Report not found.');
    }

    const [item, message, auditEntries] = await Promise.all([
      this.toAdminReportItem(report),
      report.targetType === ReportTargetType.MESSAGE
        ? this.prisma.message.findUnique({
            where: { id: report.targetId },
            select: {
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
            },
          })
        : Promise.resolve(null),

      this.findReportHistoryEntries(report),
    ]);

    const history: AdminReportHistoryItemDto[] = [
      {
        id: `received:${report.id}`,
        action: 'RECEIVED',
        actor: {
          id: report.reporter.id,
          name: this.getDisplayName(report.reporter),
        },
        createdAt: report.createdAt,
        reasonRecorded: report.reason,
      },
      ...auditEntries
        .map((entry) => this.toReportHistoryItem(entry, report.targetType))
        .filter((entry): entry is AdminReportHistoryItemDto => entry !== null),
    ];

    history.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    return {
      ...item,
      ...(message
        ? {
            message: {
              location: `${message.page.workspace.name} → ${message.page.title}`,
              author: {
                id: message.sender.id,
                name: this.getDisplayName(message.sender),
              },
              content: message.content,
            },
          }
        : {}),
      history,
    };
  }

  async reviewReport(
    reportId: string,
    adminId: string,
    dto: UpdateReportStatusDto,
  ): Promise<AdminReportItemDto> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.report.findUnique({
        where: { id: reportId },
        select: {
          id: true,
          status: true,
        },
      });

      if (!current) {
        throw new NotFoundException('Report not found.');
      }

      if (current.status !== ReportStatus.PENDING) {
        throw new ConflictException('This report has already been reviewed.');
      }

      const reviewedAt = new Date();

      // Conditional update also protects against concurrent review requests.
      const updateResult = await tx.report.updateMany({
        where: {
          id: reportId,
          status: ReportStatus.PENDING,
        },
        data: {
          status: dto.status,
          reviewedAt,
        },
      });

      if (updateResult.count !== 1) {
        throw new ConflictException('This report has already been reviewed.');
      }

      const report = await tx.report.findUnique({
        where: { id: reportId },
        include: adminReportInclude,
      });

      if (!report) {
        throw new NotFoundException('Report not found.');
      }

      await this.auditService.record(
        {
          actorId: adminId,
          action: AuditAction.REPORT_REVIEWED,
          entityType: AuditEntityType.REPORT,
          entityId: reportId,
          metadata: {
            status: dto.status,
            reason: dto.reason,
          },
        },
        tx,
      );

      return report;
    });

    return this.toAdminReportItem(updated);
  }

  // ---------------------------------------------------------------------------
  // REPORT HELPERS
  // ---------------------------------------------------------------------------

  private async toAdminReportItem(report: AdminReportRecord): Promise<AdminReportItemDto> {
    const target = await this.resolveTarget(report.targetType, report.targetId);

    return {
      id: report.id,
      status: report.status,
      reason: report.reason,
      description: report.description,
      createdAt: report.createdAt,
      reporter: {
        id: report.reporter.id,
        name: this.getDisplayName(report.reporter),
      },
      target,
    };
  }

  private async resolveTarget(
    targetType: ReportTargetType,
    targetId: string,
  ): Promise<{
    type: ReportTargetType;
    id: string;
    name: string;
    available: boolean;
  }> {
    switch (targetType) {
      case ReportTargetType.MESSAGE: {
        const message = await this.prisma.message.findUnique({
          where: { id: targetId },
          select: {
            id: true,
            sender: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        });

        if (!message) {
          return {
            type: targetType,
            id: targetId,
            name: '[Deleted]',
            available: false,
          };
        }

        return {
          type: targetType,
          id: message.id,
          name: `Message by ${this.getDisplayName(message.sender)}`,
          available: true,
        };
      }

      case ReportTargetType.USER: {
        const user = await this.prisma.user.findUnique({
          where: { id: targetId },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        });

        if (!user) {
          return {
            type: targetType,
            id: targetId,
            name: '[Deleted]',
            available: false,
          };
        }

        return {
          type: targetType,
          id: user.id,
          name: this.getDisplayName(user),
          available: true,
        };
      }

      case ReportTargetType.COURSE: {
        const course = await this.prisma.course.findUnique({
          where: { id: targetId },
          select: {
            id: true,
            title: true,
          },
        });

        if (!course) {
          return {
            type: targetType,
            id: targetId,
            name: '[Deleted]',
            available: false,
          };
        }

        return {
          type: targetType,
          id: course.id,
          name: course.title,
          available: true,
        };
      }

      default:
        return {
          type: targetType,
          id: targetId,
          name: '[Unavailable]',
          available: false,
        };
    }
  }

  private async findReportHistoryEntries(report: AdminReportRecord) {
    const conditions: Prisma.AuditEntryWhereInput[] = [
      {
        entityType: AuditEntityType.REPORT,
        entityId: report.id,
        action: AuditAction.REPORT_REVIEWED,
      },
    ];

    if (report.targetType === ReportTargetType.USER) {
      conditions.push({
        entityType: AuditEntityType.USER,
        entityId: report.targetId,
        action: AuditAction.ACCOUNT_STATUS_CHANGED,
      });
    }

    if (report.targetType === ReportTargetType.COURSE) {
      conditions.push({
        entityType: AuditEntityType.COURSE,
        entityId: report.targetId,
        action: AuditAction.COURSE_STATUS_CHANGED,
      });
    }

    return this.prisma.auditEntry.findMany({
      where: {
        OR: conditions,
        createdAt: {
          gte: report.createdAt,
        },
      },
      select: {
        id: true,
        action: true,
        entityType: true,
        metadata: true,
        createdAt: true,
        actor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  private toReportHistoryItem(
    entry: {
      id: string;
      action: AuditAction;
      entityType: AuditEntityType;
      metadata: Prisma.JsonValue | null;
      createdAt: Date;
      actor: {
        id: string;
        firstName: string | null;
        lastName: string | null;
      };
    },
    targetType: ReportTargetType,
  ): AdminReportHistoryItemDto | null {
    const metadata = this.asJsonObject(entry.metadata);

    let action: AdminReportHistoryAction | null = null;

    if (
      entry.entityType === AuditEntityType.REPORT &&
      entry.action === AuditAction.REPORT_REVIEWED &&
      metadata.status === ReportStatus.DISMISSED
    ) {
      action = 'DISMISSED';
    }

    if (
      targetType === ReportTargetType.USER &&
      entry.entityType === AuditEntityType.USER &&
      entry.action === AuditAction.ACCOUNT_STATUS_CHANGED &&
      metadata.from === AccountStatus.ACTIVE &&
      metadata.to === AccountStatus.SUSPENDED
    ) {
      action = 'USER_SUSPENDED';
    }

    if (
      targetType === ReportTargetType.COURSE &&
      entry.entityType === AuditEntityType.COURSE &&
      entry.action === AuditAction.COURSE_STATUS_CHANGED &&
      metadata.fromSuspended === false &&
      metadata.toSuspended === true
    ) {
      action = 'COURSE_SUSPENDED';
    }

    if (!action) {
      return null;
    }

    return {
      id: entry.id,
      action,
      actor: {
        id: entry.actor.id,
        name: this.getDisplayName(entry.actor),
      },
      createdAt: entry.createdAt,
      reasonRecorded: typeof metadata.reason === 'string' ? metadata.reason : null,
    };
  }

  private asJsonObject(value: Prisma.JsonValue | null): Prisma.JsonObject {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return value as Prisma.JsonObject;
    }

    return {};
  }

  private getDisplayName(user: DisplayNameSource): string {
    const name = [user.firstName, user.lastName]
      .filter((part): part is string => Boolean(part))
      .join(' ')
      .trim();

    return name || user.email || 'Unknown';
  }

  private toAdminUserItem(user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    role: AdminUserItemDto['role'];
    status: AdminUserItemDto['status'];
    createdAt: Date;
  }): AdminUserItemDto {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
    };
  }

  private toAdminCourseItem(course: AdminCourseRecord): AdminCourseItemDto {
    const name =
      [course.lecturer.firstName, course.lecturer.lastName]
        .filter((part): part is string => Boolean(part))
        .join(' ')
        .trim() || 'Unknown';

    return {
      id: course.id,
      title: course.title,
      status: course.status,
      isSuspended: course.isSuspended,
      lecturer: {
        id: course.lecturer.id,
        name,
      },
      enrollmentCount: course._count.enrollments,
      createdAt: course.createdAt,
    };
  }
}
