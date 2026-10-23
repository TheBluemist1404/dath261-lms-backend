import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, MaxLength } from 'class-validator';
import { WorkspaceMemberRole } from '../../../generated/prisma/enums.js';

export const ADDABLE_ROLES = [WorkspaceMemberRole.MEMBER, WorkspaceMemberRole.CO_OWNER] as const;

export class AddMemberDto {
  @ApiProperty({ example: 'classmate@example.com', format: 'email' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ enum: ADDABLE_ROLES })
  @IsIn(ADDABLE_ROLES)
  role!: (typeof ADDABLE_ROLES)[number];
}
