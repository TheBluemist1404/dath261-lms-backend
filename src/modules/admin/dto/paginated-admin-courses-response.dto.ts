import { ApiProperty } from '@nestjs/swagger';
import { AdminCourseItemDto } from './admin-course-item.dto.js';

export class PaginatedAdminCoursesResponseDto {
  @ApiProperty({ type: [AdminCourseItemDto] })
  items!: AdminCourseItemDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  pageSize!: number;

  @ApiProperty({ example: 125 })
  total!: number;
}
