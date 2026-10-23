import { ApiProperty } from '@nestjs/swagger';
import { WorkspaceMemberRole, WorkspaceType } from '../../../../generated/prisma/enums.js';

export class WorkspaceResponseDto {
  @ApiProperty({ example: 'cm123abc456' })
  id!: string;

  @ApiProperty({ example: 'Algorithms study group' })
  name!: string;

  @ApiProperty({ enum: WorkspaceType, enumName: 'WorkspaceType' })
  type!: WorkspaceType;

  @ApiProperty({ enum: WorkspaceMemberRole, enumName: 'WorkspaceMemberRole' })
  currentUserRole!: WorkspaceMemberRole;

  @ApiProperty({ example: 4 })
  pageCount!: number;

  @ApiProperty({ example: 3 })
  memberCount!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  archivedAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}
