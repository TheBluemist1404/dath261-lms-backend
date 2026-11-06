import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { AccountStatus } from '../../../generated/prisma/enums.js';

export class UpdateUserStatusDto {
  @ApiProperty({
    enum: AccountStatus,
    example: AccountStatus.SUSPENDED,
    description: 'New account status.',
  })
  @IsEnum(AccountStatus)
  status!: AccountStatus;
}
