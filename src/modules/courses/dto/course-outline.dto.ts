import { ApiProperty } from '@nestjs/swagger';
import { BlockType } from '../../../generated/prisma/enums.js';

export class CourseOutlineChildDto {
  @ApiProperty({ example: 'clx123abc' })
  id: string;

  @ApiProperty({ enum: BlockType, example: BlockType.VIDEO })
  type: BlockType;

  @ApiProperty({ example: 'Intro' })
  title: string;

  @ApiProperty({ example: 0 })
  position: number;
}

export class CourseOutlineItemDto {
  @ApiProperty({ example: 'clx456def' })
  id: string;

  @ApiProperty({ enum: BlockType, example: BlockType.MODULE })
  type: BlockType;

  @ApiProperty({ example: 'Week 1' })
  title: string;

  @ApiProperty({ example: 0 })
  position: number;

  @ApiProperty({ type: [CourseOutlineChildDto] })
  children: CourseOutlineChildDto[];
}
