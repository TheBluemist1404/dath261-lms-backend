// course-query.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const COURSE_SORT_FIELDS = ['createdAt', 'title', 'enrollmentStartAt'] as const;
export type CourseSortField = (typeof COURSE_SORT_FIELDS)[number];

export const COURSE_SORT_ORDERS = ['asc', 'desc'] as const;
export type CourseSortOrder = (typeof COURSE_SORT_ORDERS)[number];

export class CourseQueryDto {
  @ApiPropertyOptional({
    description: 'Search term matched against title, description, and prerequisites.',
    example: 'nestjs',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter courses by the lecturer who owns them.',
    example: 'clx789ghi',
  })
  @IsOptional()
  @IsString()
  lecturerId?: string;

  @ApiPropertyOptional({
    description:
      'When "true", only courses whose enrollment window is currently open are returned. ' +
      'A null boundary is treated as open-ended.',
    enum: ['true', 'false'],
    example: 'true',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  enrollmentOpen?: 'true' | 'false';

  @ApiPropertyOptional({
    description: 'Field to sort by.',
    enum: COURSE_SORT_FIELDS,
    default: 'createdAt',
  })
  @IsOptional()
  @IsIn(COURSE_SORT_FIELDS)
  sortBy?: CourseSortField;

  @ApiPropertyOptional({
    description: 'Sort direction.',
    enum: COURSE_SORT_ORDERS,
    default: 'desc',
  })
  @IsOptional()
  @IsIn(COURSE_SORT_ORDERS)
  sortOrder?: CourseSortOrder;

  @ApiPropertyOptional({
    description: 'Page number (1-based).',
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: 'Number of items per page.',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
