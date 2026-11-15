import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ReportStatus } from '../../../generated/prisma/enums.js';

export const REVIEWABLE_REPORT_STATUSES = [
  ReportStatus.DISMISSED,
  ReportStatus.ACTION_TAKEN,
] as const;

export class UpdateReportStatusDto {
  @ApiProperty({
    enum: REVIEWABLE_REPORT_STATUSES,
    example: ReportStatus.ACTION_TAKEN,
  })
  @IsIn(REVIEWABLE_REPORT_STATUSES)
  status!: (typeof REVIEWABLE_REPORT_STATUSES)[number];

  @ApiProperty({
    example: 'The reported content violated platform policies.',
    minLength: 1,
    maxLength: 500,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
