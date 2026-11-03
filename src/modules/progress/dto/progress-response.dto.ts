import { ApiProperty } from '@nestjs/swagger';
import { BlockType, EnrollmentStatus } from '../../../generated/prisma/client.js';

import { MyEnrollmentState } from '../../enrollments/enums/my-enrollment-state.enum.js';
import type { ResumeData } from '../types/resume-data.type.js';

export class ProgressMetricsDto {
  @ApiProperty({ example: 10 })
  totalItems!: number;

  @ApiProperty({ example: 6 })
  completedItems!: number;

  @ApiProperty({ example: 60 })
  learningProgressPercentage!: number;

  @ApiProperty({ example: 4 })
  totalQuizzes!: number;

  @ApiProperty({ example: 2 })
  completedQuizzes!: number;

  @ApiProperty({ example: 50 })
  quizCompletionPercentage!: number;
}

export class BlockProgressItemDto {
  @ApiProperty()
  courseBlockId!: string;

  @ApiProperty({ enum: BlockType })
  type!: BlockType;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  position!: number;

  @ApiProperty({ nullable: true })
  parentModuleId!: string | null;

  @ApiProperty()
  completed!: boolean;

  @ApiProperty({ nullable: true })
  completedAt!: Date | null;
}

export class StudentProgressResponseDto {
  @ApiProperty()
  enrollmentId!: string;

  @ApiProperty({ enum: EnrollmentStatus })
  enrollmentStatus!: EnrollmentStatus;

  @ApiProperty({ type: ProgressMetricsDto })
  progress!: ProgressMetricsDto;

  @ApiProperty({ type: [BlockProgressItemDto] })
  items!: BlockProgressItemDto[];
}

export class ResumeBlockDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: BlockType })
  type!: BlockType;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  position!: number;

  @ApiProperty({ nullable: true })
  parentModuleId!: string | null;
}

export class ResumePositionResponseDto {
  @ApiProperty()
  hasResumePosition!: boolean;

  @ApiProperty({ nullable: true })
  lastVisitedAt!: Date | null;

  @ApiProperty({
    type: ResumeBlockDto,
    nullable: true,
  })
  block!: ResumeBlockDto | null;

  @ApiProperty({
    nullable: true,
    description: 'Type-specific resume data.',
    type: 'object',
    additionalProperties: true,
  })
  resumeData!: ResumeData | null;
}

export class BlockProgressMutationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  courseBlockId!: string;

  @ApiProperty()
  completed!: boolean;

  @ApiProperty({ nullable: true })
  completedAt!: Date | null;

  @ApiProperty({ nullable: true })
  lastVisitedAt!: Date | null;
}
