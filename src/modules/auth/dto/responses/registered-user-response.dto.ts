import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountStatus, UserRole } from '../../../../generated/prisma/enums.js';

export class RegisteredUserResponseDto {
  @ApiProperty({ example: 'cm123abc456' })
  id!: string;

  @ApiProperty({ example: 'student@example.com', format: 'email' })
  email!: string;

  @ApiProperty({ enum: UserRole, enumName: 'UserRole' })
  role!: UserRole;

  @ApiProperty({ enum: AccountStatus, enumName: 'AccountStatus' })
  status!: AccountStatus;

  @ApiPropertyOptional({ example: 'An', nullable: true })
  firstName?: string | null;

  @ApiPropertyOptional({ example: 'Nguyen', nullable: true })
  lastName?: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}
