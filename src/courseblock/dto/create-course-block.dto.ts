import { IsEnum, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Min } from 'class-validator';
import { BlockType } from '../../generated/prisma/client.js';

export class CreateCourseBlockDto {
  @IsString()
  courseId: string;

  @IsEnum(BlockType)
  type: BlockType;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsInt()
  @Min(0)
  position: number;

  @IsOptional()
  @IsObject()
  content?: Record<string, undefined>;

  @IsOptional()
  @IsString()
  parentModuleId?: string;
}
