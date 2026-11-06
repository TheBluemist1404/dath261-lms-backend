// quiz-student-response.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { QuestionType, QuizScoringMode } from '../../../generated/prisma/enums.js';

export class StudentQuizOptionResponseDto {
  @ApiProperty({ description: 'Option ID.', example: 'clxopt1' })
  id: string;

  @ApiProperty({ description: 'Option text.', example: 'Paris' })
  text: string;

  @ApiProperty({ description: 'Order within the question.', example: 0 })
  position: number;
}

export class StudentQuizQuestionResponseDto {
  @ApiProperty({ description: 'Question ID.', example: 'clxq1' })
  id: string;

  @ApiProperty({ enum: QuestionType, description: 'Question type.' })
  type: QuestionType;

  @ApiProperty({ description: 'Question text.' })
  text: string;

  @ApiProperty({ description: 'Points awarded for a correct answer.', example: 2 })
  points: number;

  @ApiProperty({ description: 'Order within the quiz.', example: 0 })
  position: number;

  @ApiPropertyOptional({
    description: 'Options for SINGLE_CHOICE / MULTIPLE_CHOICE. Null otherwise.',
    type: [StudentQuizOptionResponseDto],
    nullable: true,
  })
  options: StudentQuizOptionResponseDto[] | null;
  // NOTE: deliberately NO isCorrect, correctBoolean, acceptedAnswers.
}

export class QuizStudentResponseDto {
  @ApiProperty({ description: 'CourseBlock ID of the quiz.', example: 'clxblock1' })
  id: string;

  @ApiProperty({ description: 'Course ID.', example: 'clxcourse1' })
  courseId: string;

  @ApiProperty({ description: 'Quiz title.', example: 'Midterm Quiz' })
  title: string;

  @ApiProperty({ description: 'Maximum attempts allowed per Student.', example: 3 })
  maxAttempts: number;

  @ApiProperty({ enum: QuizScoringMode, description: 'Scoring mode across attempts.' })
  scoringMode: QuizScoringMode;

  @ApiPropertyOptional({ description: 'When the quiz becomes available.', nullable: true })
  availableFrom: Date | null;

  @ApiPropertyOptional({ description: 'Submission deadline.', nullable: true })
  deadline: Date | null;

  @ApiProperty({ description: 'Whether late submissions are accepted.', example: false })
  allowLate: boolean;

  @ApiPropertyOptional({
    description: 'When results were released to Students. Null = not released yet.',
    nullable: true,
  })
  resultsReleasedAt: Date | null;

  @ApiProperty({
    description: 'Questions without answer keys (Student view).',
    type: [StudentQuizQuestionResponseDto],
  })
  questions: StudentQuizQuestionResponseDto[];
}
