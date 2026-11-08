// quiz-attempt-detail-response.dto.ts
//Lecturer
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { QuizAttemptStatus } from '../../../generated/prisma/enums.js';
import { StudentAttemptAnswerResultDto } from './quiz-attempt-response.dto.js';

export class AttemptStudentSummaryDto {
  @ApiProperty({ description: 'Student user ID.', example: 'clxstudent1' })
  userId: string;

  @ApiProperty({ description: 'Student email.', example: 'student@example.com' })
  email: string;

  @ApiPropertyOptional({ description: 'First name.', nullable: true })
  firstName: string | null;

  @ApiPropertyOptional({ description: 'Last name.', nullable: true })
  lastName: string | null;
}

export class QuizAttemptDetailResponseDto {
  @ApiProperty({ description: 'Attempt ID.' })
  id: string;

  @ApiProperty({ description: 'CourseBlock ID of the quiz.' })
  courseBlockId: string;

  @ApiProperty({ description: 'Enrollment ID of the Student.' })
  enrollmentId: string;

  @ApiProperty({ description: 'Attempt number (1-based).', example: 1 })
  attemptNumber: number;

  @ApiProperty({ enum: QuizAttemptStatus, description: 'Attempt status.' })
  status: QuizAttemptStatus;

  @ApiPropertyOptional({
    description: 'Score 0.00–100.00. Null when not yet graded.',
    nullable: true,
  })
  score: number | null;

  @ApiProperty({ description: 'Whether the attempt was submitted after the deadline.' })
  isLate: boolean;

  @ApiProperty({ description: 'When the attempt was started.' })
  startedAt: Date;

  @ApiPropertyOptional({ description: 'Submission timestamp.', nullable: true })
  submittedAt: Date | null;

  @ApiPropertyOptional({ description: 'Grading timestamp.', nullable: true })
  gradedAt: Date | null;

  @ApiProperty({ description: 'Student who owns this attempt.', type: AttemptStudentSummaryDto })
  student: AttemptStudentSummaryDto;

  @ApiProperty({
    description: 'Per-question result with correct answers (Lecturer always sees this).',
    type: [StudentAttemptAnswerResultDto],
  })
  answers: StudentAttemptAnswerResultDto[];
}
