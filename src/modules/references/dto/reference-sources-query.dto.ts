import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { BlockType } from '../../../generated/prisma/enums.js';
import { trim } from '../../workspaces/dto/trim.js';

export const REFERENCEABLE_TYPES = [BlockType.FILE, BlockType.VIDEO] as const;

export type ReferenceableType = (typeof REFERENCEABLE_TYPES)[number];

export class ReferenceSourcesQueryDto {
  @ApiProperty({ enum: REFERENCEABLE_TYPES })
  @IsIn(REFERENCEABLE_TYPES)
  type!: ReferenceableType;

  @ApiPropertyOptional({ description: 'Matches the block title or the course title.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  q?: string;
}
