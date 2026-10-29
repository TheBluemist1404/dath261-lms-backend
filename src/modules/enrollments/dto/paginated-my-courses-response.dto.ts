import { ApiProperty } from '@nestjs/swagger';
import { MyCourseEnrollmentResponseDto } from './my-course-enrollment-response.dto.js';
import { PaginationMetaDto } from './pagination-meta.dto.js';

export class PaginatedMyCoursesResponseDto {
  @ApiProperty({
    type: [MyCourseEnrollmentResponseDto],
    description: 'Enrollments for the requested page',
  })
  data!: MyCourseEnrollmentResponseDto[];

  @ApiProperty({
    type: PaginationMetaDto,
  })
  meta!: PaginationMetaDto;
}
