import { ApiProperty } from '@nestjs/swagger';
import { WorkspaceType } from '../../../../generated/prisma/enums.js';
import { PageSummaryResponseDto } from '../../../pages/dto/responses/page-response.dto.js';

export class PageHitWorkspaceDto {
  @ApiProperty({ example: 'cm123workspace' })
  id!: string;

  @ApiProperty({ example: 'Algorithms study group' })
  name!: string;

  @ApiProperty({ enum: WorkspaceType, enumName: 'WorkspaceType' })
  type!: WorkspaceType;
}

export class PageHitResponseDto {
  @ApiProperty({ type: PageSummaryResponseDto })
  page!: PageSummaryResponseDto;

  @ApiProperty({ type: PageHitWorkspaceDto })
  workspace!: PageHitWorkspaceDto;

  @ApiProperty({ type: [String], description: 'Ancestor page titles, root first.' })
  path!: string[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Text around the first match in the page content.',
  })
  snippet!: string | null;
}
