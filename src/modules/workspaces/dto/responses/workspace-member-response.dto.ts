import { ApiProperty } from '@nestjs/swagger';
import { WorkspaceMemberRole } from '../../../../generated/prisma/enums.js';

export class WorkspaceMemberUserDto {
  @ApiProperty({ example: 'cm123abc456' })
  id!: string;

  @ApiProperty({ example: 'classmate@example.com', format: 'email' })
  email!: string;

  @ApiProperty({ type: String, nullable: true, example: 'An' })
  firstName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Nguyen' })
  lastName!: string | null;
}

export class WorkspaceMemberResponseDto {
  @ApiProperty({ example: 'cm123abc456' })
  userId!: string;

  @ApiProperty({ enum: WorkspaceMemberRole, enumName: 'WorkspaceMemberRole' })
  role!: WorkspaceMemberRole;

  @ApiProperty({ type: String, format: 'date-time' })
  joinedAt!: Date;

  @ApiProperty({ type: WorkspaceMemberUserDto })
  user!: WorkspaceMemberUserDto;
}
