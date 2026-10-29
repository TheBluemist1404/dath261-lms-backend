// course.service.ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CourseStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../infrastructure/database/prisma/prisma.service.js';
import { CourseResponseDto } from './dto/course-response.dto.js';
import { CreateCourseDto } from './dto/create-course.dto.js';
import { UpdateCourseDto } from './dto/update-course.dto.js';
import { UpdateCourseStatusDto } from './dto/update-course-status.dto.js';

@Injectable()
export class CourseService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  async findAllByLecturer(lecturerId: string): Promise<CourseResponseDto[]> {
    const courses = await this.prisma.course.findMany({
      where: { lecturerId },
      orderBy: { createdAt: 'desc' },
    });

    return courses.map((course) => this.toResponseDto(course));
  }

  async findAllPublished(): Promise<CourseResponseDto[]> {
    const courses = await this.prisma.course.findMany({
      where: {
        status: CourseStatus.PUBLISHED,
        isSuspended: false,
      },
      orderBy: { createdAt: 'desc' },
    });

    return courses.map((course) => this.toResponseDto(course));
  }

  async findOne(courseId: string, requesterId: string): Promise<CourseResponseDto> {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
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
    });

    return this.toResponseDto(updated);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

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

  private toResponseDto(course: {
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
  }): CourseResponseDto {
    return {
      id: course.id,
      title: course.title,
      description: course.description,
      prerequisites: course.prerequisites,
      status: course.status,
      isSuspended: course.isSuspended,
      lecturerId: course.lecturerId,
      enrollmentStartAt: course.enrollmentStartAt,
      enrollmentEndAt: course.enrollmentEndAt,
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
    };
  }
}
