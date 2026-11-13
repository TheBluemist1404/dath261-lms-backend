import { ApiProperty } from '@nestjs/swagger';
import { ReportStatus, ReportTargetType } from '../../../generated/prisma/enums.js';

export class AdminReportReporterDto {
  @ApiProperty({ example: 'cm123user' })
  id!: string;

  @ApiProperty({ example: 'An Nguyen' })
  name!: string;
}

export class AdminReportTargetDto {
  @ApiProperty({ enum: ReportTargetType })
  type!: ReportTargetType;

  @ApiProperty({ example: 'cm123target' })
  id!: string;

  @ApiProperty({ example: 'Message by An Nguyen' })
  name!: string;

  @ApiProperty({ example: true })
  available!: boolean;
}

export class AdminReportItemDto {
  @ApiProperty({ example: 'cm123report' })
  id!: string;

  @ApiProperty({ enum: ReportStatus })
  status!: ReportStatus;

  @ApiProperty({ example: 'Harassment or abuse' })
  reason!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ example: '2026-11-10T10:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ type: AdminReportReporterDto })
  reporter!: AdminReportReporterDto;

  @ApiProperty({ type: AdminReportTargetDto })
  target!: AdminReportTargetDto;
}
