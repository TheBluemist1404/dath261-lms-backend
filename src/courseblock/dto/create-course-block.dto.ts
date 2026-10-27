import { IsEnum, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Min } from 'class-validator';
import { BlockType, Prisma } from '../../generated/prisma/client.js';

export class CreateCourseBlockDto {
  @IsEnum(BlockType)
  type: BlockType;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsObject()
  content?: Prisma.InputJsonValue;

  @IsOptional()
  @IsString()
  parentModuleId?: string | null;
}
