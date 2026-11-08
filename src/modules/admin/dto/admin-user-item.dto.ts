import { ApiProperty } from '@nestjs/swagger';
import { AccountStatus, UserRole } from '../../../generated/prisma/enums.js';

export class AdminUserItemDto {
  @ApiProperty({ example: 'cm123abc' })
  id!: string;

  @ApiProperty({ example: 'student@example.com' })
  email!: string;

  @ApiProperty({ example: 'Nguyen', nullable: true })
  firstName!: string | null;

  @ApiProperty({ example: 'An', nullable: true })
  lastName!: string | null;

  @ApiProperty({ enum: UserRole, example: UserRole.STUDENT })
  role!: UserRole;

  @ApiProperty({ enum: AccountStatus, example: AccountStatus.ACTIVE })
  status!: AccountStatus;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  createdAt!: Date;
}
