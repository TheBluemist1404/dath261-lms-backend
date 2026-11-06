// quiz-attempt-response.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { QuizAttemptStatus } from '../../../generated/prisma/enums.js';

export class StudentAttemptAnswerResultDto {
  @ApiProperty({ description: 'Question ID.', example: 'clxq1' })
  questionId: string;

  @ApiProperty({ description: 'Max points for this question.', example: 2 })
  points: number;

  @ApiProperty({ description: 'Points earned by the Student.', example: 2 })
  earnedPoints: number;

  @ApiProperty({ description: 'Whether the answer was fully correct.', example: true })
  isCorrect: boolean;

  @ApiPropertyOptional({
    description: 'Correct answer (only when results were released).',
    nullable: true,
  })
  correctAnswer: unknown;

  @ApiPropertyOptional({
    description: 'What the Student submitted (only when results were released).',
    nullable: true,
  })
  studentAnswer: unknown;
}

export class QuizAttemptResponseDto {
  @ApiProperty({ description: 'Attempt ID.', example: 'clxatt1' })
  id: string;

  @ApiProperty({ description: 'CourseBlock ID of the quiz.', example: 'clxblock1' })
  courseBlockId: string;

  @ApiProperty({ description: 'Attempt number (1-based).', example: 1 })
  attemptNumber: number;

  @ApiProperty({ enum: QuizAttemptStatus, description: 'Attempt status.' })
  status: QuizAttemptStatus;

  @ApiPropertyOptional({
    description: 'Score 0.00–100.00. Null when not yet submitted.',
    example: 80.0,
    nullable: true,
  })
  score: number | null;

  @ApiProperty({
    description: 'Whether the attempt was submitted after the deadline.',
    example: false,
  })
  isLate: boolean;

  @ApiPropertyOptional({ description: 'Submission timestamp.', nullable: true })
  submittedAt: Date | null;

  @ApiProperty({ description: 'Whether the Lecturer has released results.', example: false })
  resultsReleased: boolean;

  @ApiPropertyOptional({
    description:
      'Per-question result. Null when results have not been released yet ' +
      '(or the attempt is still in progress).',
    type: [StudentAttemptAnswerResultDto],
    nullable: true,
  })
  answers: StudentAttemptAnswerResultDto[] | null;
}
