import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsObject, IsOptional, IsString, ValidateIf } from 'class-validator';
import type { Prisma } from '../../generated/prisma/client.js';
import { BlockType } from '../../generated/prisma/client.js';

export class UpdateCourseBlockDto {
  @IsOptional()
  @IsEnum(BlockType)
  type?: BlockType;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Type-specific JSON object payload. Omit to leave content unchanged.',
    example: { url: 'https://example.com/video.mp4', durationSeconds: 120 },
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  content?: Prisma.InputJsonObject;
}
