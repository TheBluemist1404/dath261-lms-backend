import { ApiProperty } from '@nestjs/swagger';
import { AdminReportItemDto } from './admin-report-item.dto.js';

export const ADMIN_REPORT_HISTORY_ACTIONS = [
  'RECEIVED',
  'DISMISSED',
  'ACTION_TAKEN',
  'COURSE_SUSPENDED',
  'USER_SUSPENDED',
] as const;

export type AdminReportHistoryAction = (typeof ADMIN_REPORT_HISTORY_ACTIONS)[number];

export class AdminReportMessageAuthorDto {
  @ApiProperty({ example: 'cm123user' })
  id!: string;

  @ApiProperty({ example: 'An Nguyen' })
  name!: string;
}

export class AdminReportMessageDetailDto {
  @ApiProperty({
    example: 'Collaborative Workspace → Project Discussion',
  })
  location!: string;

  @ApiProperty({ type: AdminReportMessageAuthorDto })
  author!: AdminReportMessageAuthorDto;

  @ApiProperty({ example: 'This is the reported message content.' })
  content!: string;
}

export class AdminReportHistoryActorDto {
  @ApiProperty({ example: 'cm123user' })
  id!: string;

  @ApiProperty({ example: 'Admin User' })
  name!: string;
}

export class AdminReportHistoryItemDto {
  @ApiProperty({
    enum: ADMIN_REPORT_HISTORY_ACTIONS,
    example: 'RECEIVED',
  })
  action!: AdminReportHistoryAction;

  @ApiProperty({ example: 'received:cm123report' })
  id!: string;

  @ApiProperty({ type: AdminReportHistoryActorDto })
  actor!: AdminReportHistoryActorDto;

  @ApiProperty({ example: '2026-11-10T10:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Repeated harassment',
  })
  reasonRecorded!: string | null;
}

export class AdminReportDetailDto extends AdminReportItemDto {
  @ApiProperty({
    type: AdminReportMessageDetailDto,
    required: false,
    description: 'Only returned for MESSAGE targets that still exist.',
  })
  message?: AdminReportMessageDetailDto;

  @ApiProperty({ type: [AdminReportHistoryItemDto] })
  history!: AdminReportHistoryItemDto[];
}
