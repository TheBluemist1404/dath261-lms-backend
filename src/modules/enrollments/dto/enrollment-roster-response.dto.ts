// enrollment-roster-response.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EnrollmentStatus } from '../../../generated/prisma/enums.js';

export class RosterStudentDto {
  @ApiProperty({ description: 'The ID of the student.', example: 'clxstudent1' })
  id: string;

  @ApiPropertyOptional({ description: 'Student first name.', nullable: true, example: 'An' })
  firstName: string | null;

  @ApiPropertyOptional({ description: 'Student last name.', nullable: true, example: 'Nguyen' })
  lastName: string | null;

  @ApiProperty({
    description: 'Student email address.',
    example: 'student@dath261.dev',
  })
  email: string;
}

export class RosterProgressDto {
  @ApiProperty({ description: 'Number of completed tracked blocks.', example: 4 })
  completedBlocks: number;

  @ApiProperty({ description: 'Total number of tracked blocks in the course.', example: 10 })
  totalBlocks: number;

  @ApiProperty({
    description:
      'Completion percentage (0..100, 2 decimals). Matches the percentage the student sees in the reader.',
    example: 40,
  })
  percent: number;
}

export class EnrollmentRosterItemDto {
  @ApiProperty({ description: 'The enrollment ID.', example: 'clxenroll1' })
  enrollmentId: string;

  @ApiProperty({ description: 'Current enrollment status.', enum: EnrollmentStatus })
  status: EnrollmentStatus;

  @ApiProperty({ description: 'When the student enrolled.', example: '2026-01-01T00:00:00.000Z' })
  enrolledAt: Date;

  @ApiPropertyOptional({
    description: 'When the enrollment was completed, or null.',
    nullable: true,
    example: null,
  })
  completedAt: Date | null;

  @ApiProperty({ type: RosterStudentDto })
  student: RosterStudentDto;

  @ApiProperty({ type: RosterProgressDto })
  progress: RosterProgressDto;

  @ApiPropertyOptional({
    description:
      'Mean of each quiz final score (per its scoringMode) over quizzes with a graded attempt, ' +
      'rounded to 2 decimals. Null when the student has no graded attempt.',
    nullable: true,
    type: Number,
    example: 8.5,
  })
  quizScore: number | null;
}
