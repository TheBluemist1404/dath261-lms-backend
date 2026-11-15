import { ApiProperty } from '@nestjs/swagger';
import { AdminReportItemDto } from './admin-report-item.dto.js';

export class PaginatedAdminReportsResponseDto {
  @ApiProperty({ type: [AdminReportItemDto] })
  items!: AdminReportItemDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  pageSize!: number;

  @ApiProperty({ example: 125 })
  total!: number;
}
