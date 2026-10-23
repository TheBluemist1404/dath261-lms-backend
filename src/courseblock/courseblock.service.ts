import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../infrastructure/database/prisma/prisma.service.js';
import { CreateCourseBlockDto } from './dto/create-course-block.dto.js';
import { UpdateCourseBlockDto } from './dto/update-course-block.dto.js';

@Injectable()
export class CourseBlockService {
  constructor(private readonly prisma: PrismaService) {}

  // Kiểm tra khóa học có tồn tại và thuộc lecturer hiện tại không
  private async checkCourseOwnership(courseId: string, lecturerId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
    });

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    // Đổi lecturerId thành đúng tên field trong schema.prisma
    if (course.lecturerId !== lecturerId) {
      throw new ForbiddenException('You do not own this course');
    }

    return course;
  }

  // Lấy danh sách block theo thứ tự
  async findAll(courseId: string, lecturerId: string) {
    await this.checkCourseOwnership(courseId, lecturerId);

    return this.prisma.courseBlock.findMany({
      where: { courseId },
      orderBy: { position: 'asc' },
    });
  }

  // Thêm block mới
  async create(courseId: string, lecturerId: string, dto: CreateCourseBlockDto) {
    await this.checkCourseOwnership(courseId, lecturerId);

    if (dto.position < 0) {
      throw new BadRequestException('Position must be non-negative');
    }

    return this.prisma.courseBlock.create({
      data: {
        courseId,
        type: dto.type,
        title: dto.title,
        position: dto.position,
        content: dto.content,
        parentModuleId: dto.parentModuleId ?? null,
      },
    });
  }

  // Cập nhật block
  async update(courseId: string, blockId: string, lecturerId: string, dto: UpdateCourseBlockDto) {
    await this.checkCourseOwnership(courseId, lecturerId);

    const block = await this.prisma.courseBlock.findFirst({
      where: { id: blockId, courseId },
    });

    if (!block) {
      throw new NotFoundException('Course block not found');
    }

    return this.prisma.courseBlock.update({
      where: { id: blockId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.position !== undefined && {
          position: dto.position,
        }),
        ...(dto.content !== undefined && {
          content: dto.content,
        }),
      },
    });
  }

  // Xóa block
  async remove(courseId: string, blockId: string, lecturerId: string) {
    await this.checkCourseOwnership(courseId, lecturerId);

    const block = await this.prisma.courseBlock.findFirst({
      where: { id: blockId, courseId },
    });

    if (!block) {
      throw new NotFoundException('Course block not found');
    }

    return this.prisma.courseBlock.delete({
      where: { id: blockId },
    });
  }

  // Sắp xếp lại thứ tự nhiều block
  async reorder(courseId: string, lecturerId: string, blockIds: string[]) {
    await this.checkCourseOwnership(courseId, lecturerId);

    if (new Set(blockIds).size !== blockIds.length) {
      throw new BadRequestException('Duplicate block IDs are not allowed');
    }

    const blocks = await this.prisma.courseBlock.findMany({
      where: {
        courseId,
        id: { in: blockIds },
      },
      select: { id: true },
    });

    if (blocks.length !== blockIds.length) {
      throw new BadRequestException('Some blocks do not belong to this course');
    }

    return this.prisma.$transaction(
      blockIds.map((id, position) =>
        this.prisma.courseBlock.update({
          where: { id },
          data: { position },
        }),
      ),
    );
  }
}
