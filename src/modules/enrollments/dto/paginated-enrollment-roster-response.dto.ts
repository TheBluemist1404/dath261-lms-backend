// paginated-enrollment-roster-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { EnrollmentRosterItemDto } from './enrollment-roster-response.dto.js';

export class EnrollmentRosterPaginationMetaDto {
  @ApiProperty({ description: 'Total number of matching enrollments.', example: 42 })
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

export class PaginatedEnrollmentRosterResponseDto {
  @ApiProperty({ type: [EnrollmentRosterItemDto] })
  data: EnrollmentRosterItemDto[];

  @ApiProperty({ type: EnrollmentRosterPaginationMetaDto })
  meta: EnrollmentRosterPaginationMetaDto;
}
