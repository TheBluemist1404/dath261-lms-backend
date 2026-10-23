import { ApiProperty } from '@nestjs/swagger';
import { ReportStatus } from '../../../../generated/prisma/enums.js';

export class MessageSenderResponseDto {
  @ApiProperty({ example: 'cm123user' })
  id!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Mai' })
  firstName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Tran' })
  lastName!: string | null;
}

export class PageMessageResponseDto {
  @ApiProperty({ example: 'cm123message' })
  id!: string;

  @ApiProperty({ example: 'cm123page' })
  pageId!: string;

  @ApiProperty({ type: MessageSenderResponseDto })
  sender!: MessageSenderResponseDto;

  @ApiProperty({ example: 'Does round robin need a fixed quantum?' })
  content!: string;

  @ApiProperty()
  createdAt!: Date;
}

export class ReportResponseDto {
  @ApiProperty({ example: 'cm123report' })
  id!: string;

  @ApiProperty({ enum: ReportStatus })
  status!: ReportStatus;
}
