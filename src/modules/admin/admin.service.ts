import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  AccountStatus,
  AuditAction,
  AuditEntityType,
  CourseStatus,
  EnrollmentStatus,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { UserService } from '../users/user.service.js';
import { AdminCourseItemDto } from './dto/admin-course-item.dto.js';
import { AdminUserItemDto } from './dto/admin-user-item.dto.js';
import { ListAdminCoursesQueryDto } from './dto/list-admin-courses-query.dto.js';
import { ListAdminUsersQueryDto } from './dto/list-admin-users-query.dto.js';
import { UpdateCourseSuspensionDto } from './dto/update-course-suspension.dto.js';
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
