import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BlockType } from '../../generated/prisma/enums.js'; 

export class CourseBlockResponseDto {
  @ApiProperty({ description: 'Unique identifier of the course block', example: 'clx123abc' })
  id: string;

  @ApiProperty({ description: 'ID of the course this block belongs to', example: 'clx456def' })
  courseId: string;

  @ApiProperty({ enum: BlockType, description: 'Type of the block', example: BlockType.MODULE })
  type: BlockType;

  @ApiProperty({ description: 'Title of the block', example: 'Introduction to Programming' })
  title: string;

  @ApiProperty({ description: 'Order position within its parent list', example: 0 })
  position: number;

  @ApiPropertyOptional({ description: 'Content of the block (markdown/html)', example: '# Welcome', nullable: true })
  content: string | null;

  @ApiPropertyOptional({
    description: 'ID of the parent MODULE block, null if top-level',
    example: null,
    nullable: true,
  })
  parentModuleId: string | null;

  @ApiProperty({ description: 'Creation timestamp', example: '2026-10-25T10:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ description: 'Last update timestamp', example: '2026-10-25T10:00:00.000Z' })
  updatedAt: Date;
}