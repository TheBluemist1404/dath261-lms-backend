import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { REFERENCEABLE_TYPES, type ReferenceableType } from '../reference-sources-query.dto.js';

export const REFERENCE_STATUSES = ['AVAILABLE', 'LOCKED', 'UNAVAILABLE'] as const;

export type ReferenceStatus = (typeof REFERENCE_STATUSES)[number];

export class ReferencedBlockResponseDto {
  @ApiProperty({ example: 'cm123block' })
  id!: string;

  @ApiProperty({ enum: REFERENCEABLE_TYPES })
  type!: ReferenceableType;

  @ApiProperty({ example: 'Lecture 3: Graphs' })
  title!: string;

  @ApiProperty({ example: 'cm123course' })
  courseId!: string;

  @ApiProperty({ example: 'Algorithms' })
  courseTitle!: string;

  @ApiProperty({ type: Number, nullable: true, description: 'Video length when known.' })
  durationSeconds!: number | null;
}

export class CourseReferenceResponseDto {
  @ApiProperty({ example: 'cm123ref' })
  id!: string;

  @ApiProperty({ example: 'cm123page' })
  pageId!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({
    enum: REFERENCE_STATUSES,
    description:
      'Re-checked for the viewer on every read. LOCKED and UNAVAILABLE carry no block metadata.',
  })
  status!: ReferenceStatus;

  @ApiPropertyOptional({ type: ReferencedBlockResponseDto, description: 'AVAILABLE only.' })
  block?: ReferencedBlockResponseDto;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'AVAILABLE only.' })
  timestampSeconds?: number | null;
}
