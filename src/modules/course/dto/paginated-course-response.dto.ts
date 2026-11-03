// paginated-course-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { CourseResponseDto } from './course-response.dto.js';

export class PaginationMetaDto {
  @ApiProperty({ description: 'Total number of matching courses.', example: 42 })
  total: number;

  @ApiProperty({ description: 'Current page (1-based).', example: 1 })
  page: number;

  @ApiProperty({ description: 'Number of items per page.', example: 20 })
  limit: number;

  @ApiProperty({ description: 'Total number of pages.', example: 3 })
  totalPages: number;

  @ApiProperty({ description: 'Whether a next page exists.', example: true })
  hasNextPage: boolean;

  @ApiProperty({ description: 'Whether a previous page exists.', example: false })
  hasPrevPage: boolean;
}

export class PaginatedCourseResponseDto {
  @ApiProperty({ type: [CourseResponseDto] })
  data: CourseResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}