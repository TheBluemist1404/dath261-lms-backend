// course.service.ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { CourseStatus, EnrollmentStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { CourseQueryDto } from './dto/course-query.dto.js';
import { CourseResponseDto } from './dto/course-response.dto.js';
import { CreateCourseDto } from './dto/create-course.dto.js';
import { PaginatedCourseResponseDto } from './dto/paginated-course-response.dto.js';
import { UpdateCourseDto } from './dto/update-course.dto.js';
import { UpdateCourseStatusDto } from './dto/update-course-status.dto.js';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

@Injectable()
export class CourseService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Shared include
  // ---------------------------------------------------------------------------

  private readonly lecturerInclude = {
    lecturer: { select: { id: true, firstName: true, lastName: true } },
  } satisfies Prisma.CourseInclude;

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  async findAllByLecturer(lecturerId: string): Promise<CourseResponseDto[]> {
    const courses = await this.prisma.course.findMany({
      where: { lecturerId },
      orderBy: { createdAt: 'desc' },
      include: {
        ...this.lecturerInclude,
        _count: {
          select: {
            enrollments: { where: { status: EnrollmentStatus.ACTIVE } },
          },
        },
      },
    });
    return courses.map((course) =>
      this.toResponseDto(course, { enrollmentCount: course._count.enrollments }),
    );
  }

  async findAllPublished(query: CourseQueryDto): Promise<PaginatedCourseResponseDto> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const skip = (page - 1) * limit;

    const where = this.buildCatalogWhere(query);
    const orderBy = {
      [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc',
    } as Prisma.CourseOrderByWithRelationInput;

    const [total, courses] = await this.prisma.$transaction([
      this.prisma.course.count({ where }),
      this.prisma.course.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: this.lecturerInclude,
      }),
    ]);

    const totalPages = Math.ceil(total / limit) || 0;

    return {
      data: courses.map((course) => this.toResponseDto(course)),
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };
  }

  async findOne(courseId: string, requesterId: string): Promise<CourseResponseDto> {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      include: this.lecturerInclude,
    });

    if (!course) {
      throw new NotFoundException('Course not found.');
    }

    const isOwner = course.lecturerId === requesterId;

    // Draft protected content is not exposed through student-facing reads.
    // Suspended courses are also hidden from non-owners (existing learners will
    // be handled later via the Enrollment module).
    if (!isOwner && (course.status !== CourseStatus.PUBLISHED || course.isSuspended)) {
      throw new ForbiddenException('You do not have access to this course.');
    }

    return this.toResponseDto(course);
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  async create(lecturerId: string, dto: CreateCourseDto): Promise<CourseResponseDto> {
    this.assertValidEnrollmentWindow(dto.enrollmentStartAt, dto.enrollmentEndAt);

    const course = await this.prisma.course.create({
      data: {
        title: dto.title,
        description: dto.description ?? null,
        prerequisites: dto.prerequisites ?? null,
        enrollmentStartAt: dto.enrollmentStartAt ? new Date(dto.enrollmentStartAt) : null,
        enrollmentEndAt: dto.enrollmentEndAt ? new Date(dto.enrollmentEndAt) : null,
        lecturerId,
        status: CourseStatus.DRAFT,
        isSuspended: false,
      },
      include: this.lecturerInclude,
    });

    return this.toResponseDto(course);
  }

  async update(
    courseId: string,
    lecturerId: string,
    dto: UpdateCourseDto,
  ): Promise<CourseResponseDto> {
    const course = await this.assertOwnership(courseId, lecturerId);

    // Merge incoming values with existing ones to validate the final window.
    const nextStart =
      dto.enrollmentStartAt !== undefined
        ? dto.enrollmentStartAt
          ? new Date(dto.enrollmentStartAt)
          : null
        : course.enrollmentStartAt;

    const nextEnd =
      dto.enrollmentEndAt !== undefined
        ? dto.enrollmentEndAt
          ? new Date(dto.enrollmentEndAt)
          : null
        : course.enrollmentEndAt;

    this.assertValidEnrollmentWindow(nextStart, nextEnd);

    const updated = await this.prisma.course.update({
      where: { id: courseId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.prerequisites !== undefined && { prerequisites: dto.prerequisites }),
        ...(dto.enrollmentStartAt !== undefined && {
          enrollmentStartAt: dto.enrollmentStartAt ? new Date(dto.enrollmentStartAt) : null,
        }),
        ...(dto.enrollmentEndAt !== undefined && {
          enrollmentEndAt: dto.enrollmentEndAt ? new Date(dto.enrollmentEndAt) : null,
        }),
      },
      include: this.lecturerInclude,
    });

    return this.toResponseDto(updated);
  }

  async updateStatus(
    courseId: string,
    lecturerId: string,
    dto: UpdateCourseStatusDto,
  ): Promise<CourseResponseDto> {
    await this.assertOwnership(courseId, lecturerId);

    if (dto.status === CourseStatus.PUBLISHED) {
      const blockCount = await this.prisma.courseBlock.count({
        where: { courseId },
      });

      if (blockCount === 0) {
        throw new BadRequestException('Cannot publish an empty course.');
      }
    }

    const updated = await this.prisma.course.update({
      where: { id: courseId },
      data: { status: dto.status },
      include: this.lecturerInclude,
    });

    return this.toResponseDto(updated);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private buildCatalogWhere(query: CourseQueryDto): Prisma.CourseWhereInput {
    const where: Prisma.CourseWhereInput = {
      status: CourseStatus.PUBLISHED,
      isSuspended: false,
    };

    if (query.lecturerId) {
      where.lecturerId = query.lecturerId;
    }

    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { prerequisites: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (query.enrollmentOpen === 'true') {
      const now = new Date();
      // A null boundary is treated as open-ended.
      where.AND = [
        { OR: [{ enrollmentStartAt: null }, { enrollmentStartAt: { lte: now } }] },
        { OR: [{ enrollmentEndAt: null }, { enrollmentEndAt: { gte: now } }] },
      ];
    }

    return where;
  }

  private async assertOwnership(courseId: string, lecturerId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
    });

    if (!course) {
      throw new NotFoundException('Course not found.');
    }

    if (course.lecturerId !== lecturerId) {
      throw new ForbiddenException('You do not own this course.');
    }

    return course;
  }

  private assertValidEnrollmentWindow(
    start: Date | string | null | undefined,
    end: Date | string | null | undefined,
  ): void {
    if (!start || !end) {
      return;
    }

    const startDate = start instanceof Date ? start : new Date(start);
    const endDate = end instanceof Date ? end : new Date(end);

    if (startDate >= endDate) {
      throw new BadRequestException('enrollmentStartAt must be before enrollmentEndAt.');
    }
  }

  private toResponseDto(
    course: {
      id: string;
      title: string;
      description: string | null;
      prerequisites: string | null;
      status: CourseStatus;
      isSuspended: boolean;
      lecturerId: string;
      enrollmentStartAt: Date | null;
      enrollmentEndAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      lecturer: { id: string; firstName: string | null; lastName: string | null };
    },
    extra?: { enrollmentCount?: number },
  ): CourseResponseDto {
    const name =
      [course.lecturer.firstName, course.lecturer.lastName]
        .filter((part): part is string => Boolean(part))
        .join(' ')
        .trim() || 'Unknown';

    return {
      id: course.id,
      title: course.title,
      description: course.description,
      prerequisites: course.prerequisites,
      status: course.status,
      isSuspended: course.isSuspended,
      lecturerId: course.lecturerId,
      lecturer: { id: course.lecturer.id, name },
      ...(extra?.enrollmentCount !== undefined && { enrollmentCount: extra.enrollmentCount }),
      enrollmentStartAt: course.enrollmentStartAt,
      enrollmentEndAt: course.enrollmentEndAt,
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
    };
  }
}
