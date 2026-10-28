//courseblock.service.ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BlockType } from '../generated/prisma/enums.js';
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

    // If parent module id is not null, check if it existed and had same courseId
    if (dto.parentModuleId) {
      const parent = await this.prisma.courseBlock.findFirst({
        where: {
          id: dto.parentModuleId,
          courseId,
        },
      });

      if (!parent) {
        throw new BadRequestException('Parent module must belong to the same course');
      }

      if (parent.type !== BlockType.MODULE) {
        throw new BadRequestException('Parent block must be a MODULE');
      }
    }

    const parentModuleId = dto.parentModuleId ?? null;

    // Compute next position
    const aggregate = await this.prisma.courseBlock.aggregate({
      where: { courseId, parentModuleId },
      _max: { position: true },
    });

    const nextPosition = (aggregate._max.position ?? -1) + 1;

    return this.prisma.courseBlock.create({
      data: {
        courseId,
        type: dto.type,
        title: dto.title,
        content: dto.content,
        position: nextPosition,
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

    // Không cho đổi MODULE thành loại khác khi vẫn còn block con
    if (
      block.type === BlockType.MODULE &&
      dto.type !== undefined &&
      dto.type !== BlockType.MODULE
    ) {
      const childrenCount = await this.prisma.courseBlock.count({
        where: {
          parentModuleId: blockId,
        },
      });

      if (childrenCount > 0) {
        throw new BadRequestException('Cannot change a MODULE that has children');
      }
    }

    return this.prisma.courseBlock.update({
      where: { id: blockId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.type !== undefined && { type: dto.type }),
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
  async reorder(courseId: string, blockIds: string[], lecturerId: string) {
    if (new Set(blockIds).size !== blockIds.length) {
      throw new BadRequestException('Duplicate block IDs are not allowed');
    }

    await this.checkCourseOwnership(courseId, lecturerId);

    // 1. Lấy các thông tin cần thiết của các block được yêu cầu reorder
    const blocks = await this.prisma.courseBlock.findMany({
      where: {
        courseId,
        id: { in: blockIds },
      },
      select: {
        id: true,
        parentModuleId: true,
        position: true,
      },
    });

    // Kiểm tra blockIds có khai báo block bị thừa, ko tồn tại
    if (blocks.length !== blockIds.length) {
      //blocks.length < blockIds.length
      throw new BadRequestException('Some blocks do not belong to this course');
    }

    // 2. Các block phải cùng 1 parent module id
    const parentModuleId = blocks[0].parentModuleId;

    if (
      blocks.some((block) => block.parentModuleId !== parentModuleId) // throw exception if at least one different block's parentModuleId
    ) {
      throw new BadRequestException('All blocks must belong to the same sibling list');
    }

    // 3. Lấy tất cả các block cùng parentModuleId trong courseId
    const siblings = await this.prisma.courseBlock.findMany({
      where: {
        courseId,
        parentModuleId,
      },
      select: {
        id: true,
        position: true,
      },
    });

    // Kiểm tra blockIds có khai báo thiếu blocks trong cùng parent module id
    if (siblings.length !== blockIds.length) {
      //sibling.length > blockIds.length
      throw new BadRequestException('You must provide all blocks in the parent module');
    }

    // Đảm bảo siblingIds và blocks.id có cùng id
    const siblingIds = new Set(siblings.map((block) => block.id));

    if (!blockIds.every((id) => siblingIds.has(id))) {
      throw new BadRequestException('Block IDs must match the sibling list');
    }

    // 4. Chọn các vị trí tạm lớn hơn mọi position hiện tại
    const maxPosition = Math.max(-1, ...siblings.map((block) => block.position));

    return this.prisma.$transaction(async (tx) => {
      // Giai đoạn 1: chuyển sang vị trí tạm để tránh xung đột
      for (let i = 0; i < blockIds.length; i++) {
        await tx.courseBlock.update({
          where: { id: blockIds[i] },
          data: {
            position: maxPosition + 1 + i,
          },
        });
      }

      // Giai đoạn 2: gán vị trí chính thức theo thứ tự yêu cầu
      const reorderedBlocks = [];

      for (let position = 0; position < blockIds.length; position++) {
        const block = await tx.courseBlock.update({
          where: { id: blockIds[position] },
          data: { position },
        });

        reorderedBlocks.push(block);
      }

      return reorderedBlocks;
    });
  }
}
