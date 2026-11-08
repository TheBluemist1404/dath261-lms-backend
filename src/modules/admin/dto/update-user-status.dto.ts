import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { AccountStatus } from '../../../generated/prisma/enums.js';

export class UpdateUserStatusDto {
  @ApiProperty({
    enum: AccountStatus,
    example: AccountStatus.SUSPENDED,
    description: 'New account status.',
  })
  @IsEnum(AccountStatus)
  status!: AccountStatus;

  @ApiPropertyOptional({
    example: 'Repeated violations of platform policies.',
    description: 'Optional reason for changing the account status.',
    maxLength: 500,
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value))
  @IsString()
  @MaxLength(500)
  reason?: string;
}
