import { ApiProperty } from '@nestjs/swagger';

export class PageSummaryResponseDto {
  @ApiProperty({ example: 'cm123abc456' })
  id!: string;

  @ApiProperty({ example: 'cm123workspace' })
  workspaceId!: string;

  @ApiProperty({ example: 'Week 3 notes' })
  title!: string;

  @ApiProperty({ type: String, nullable: true })
  parentPageId!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Set while the page is archived; archived pages are read-only.',
  })
  archivedAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class PageResponseDto extends PageSummaryResponseDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'The editor document as JSON.',
  })
  content!: unknown;
}
