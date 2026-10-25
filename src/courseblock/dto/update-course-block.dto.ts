import { IsEnum, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Min } from 'class-validator';
import { BlockType } from '../../generated/prisma/client.js';
import type { Prisma } from '../../generated/prisma/client.js';

export class UpdateCourseBlockDto {
  @IsOptional()
  @IsEnum(BlockType)
  type?: BlockType;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @IsOptional()
  @IsObject()
  content?: Prisma.InputJsonValue;
}
