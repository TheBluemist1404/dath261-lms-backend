import { ApiProperty } from '@nestjs/swagger';

import {
  AssignmentSubmissionStatus,
  EnrollmentStatus,
  Prisma,
  QuizAttemptStatus,
} from '../../../generated/prisma/client.js';

import { BlockProgressItemDto, ProgressMetricsDto } from './progress-response.dto.js';

export class LecturerEnrollmentInfoDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: EnrollmentStatus })
  status!: EnrollmentStatus;

  @ApiProperty()
  enrolledAt!: Date;

  @ApiProperty({ nullable: true })
  leftAt!: Date | null;

  @ApiProperty({ nullable: true })
  completedAt!: Date | null;
}

export class LecturerStudentInfoDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ nullable: true })
  firstName!: string | null;

  @ApiProperty({ nullable: true })
  lastName!: string | null;
}

export class QuizBlockSummaryDto {
  @ApiProperty()
  title!: string;
}

export class AssignmentBlockSummaryDto {
  @ApiProperty()
  title!: string;
}

export class LecturerQuizAttemptDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  courseBlockId!: string;

  @ApiProperty()
  attemptNumber!: number;

  @ApiProperty({ enum: QuizAttemptStatus })
  status!: QuizAttemptStatus;

  @ApiProperty({
    nullable: true,
    description: 'Submitted quiz answers in JSON format.',
  })
  answers!: Prisma.JsonValue;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Quiz score serialized as a decimal string.',
    example: '85.50',
  })
  score!: string | null;

  @ApiProperty()
  startedAt!: Date;

  @ApiProperty({ nullable: true })
  submittedAt!: Date | null;

  @ApiProperty({ nullable: true })
  gradedAt!: Date | null;

  @ApiProperty({ type: QuizBlockSummaryDto })
  quizBlock!: QuizBlockSummaryDto;
}

export class LecturerAssignmentSubmissionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  courseBlockId!: string;

  @ApiProperty()
  attemptNumber!: number;

  @ApiProperty({ nullable: true })
  textContent!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Submitted file metadata in JSON format.',
  })
  fileMetadata!: Prisma.JsonValue;

  @ApiProperty({ enum: AssignmentSubmissionStatus })
  status!: AssignmentSubmissionStatus;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Assignment score serialized as a decimal string.',
    example: '90.00',
  })
  score!: string | null;

  @ApiProperty({ nullable: true })
  feedback!: string | null;

  @ApiProperty()
  submittedAt!: Date;

  @ApiProperty({ nullable: true })
  gradedAt!: Date | null;

  @ApiProperty({ type: AssignmentBlockSummaryDto })
  assignmentBlock!: AssignmentBlockSummaryDto;
}

export class LecturerStudentProgressResponseDto {
  @ApiProperty({ type: LecturerEnrollmentInfoDto })
  enrollment!: LecturerEnrollmentInfoDto;

  @ApiProperty({ type: LecturerStudentInfoDto })
  student!: LecturerStudentInfoDto;

  @ApiProperty({ type: ProgressMetricsDto })
  progress!: ProgressMetricsDto;

  @ApiProperty({
    type: [BlockProgressItemDto],
  })
  items!: BlockProgressItemDto[];

  @ApiProperty({
    type: [LecturerQuizAttemptDto],
  })
  quizAttempts!: LecturerQuizAttemptDto[];

  @ApiProperty({
    type: [LecturerAssignmentSubmissionDto],
  })
  assignmentSubmissions!: LecturerAssignmentSubmissionDto[];
}
