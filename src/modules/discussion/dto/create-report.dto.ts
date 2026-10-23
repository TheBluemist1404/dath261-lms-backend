import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { trim } from '../../workspaces/dto/trim.js';

/** Only discussion messages can be reported from the workspace so far. */
export const REPORTABLE_TARGETS = ['MESSAGE'] as const;

export class CreateReportDto {
  @ApiProperty({ enum: REPORTABLE_TARGETS })
  @IsIn(REPORTABLE_TARGETS)
  targetType!: (typeof REPORTABLE_TARGETS)[number];

  @ApiProperty({ example: 'cm123message' })
  @IsString()
  @IsNotEmpty()
  targetId!: string;

  @ApiProperty({ example: 'Harassment or abuse', minLength: 1, maxLength: 100 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  reason!: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
