// quiz-response.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { QuestionType, QuizScoringMode } from '../../../generated/prisma/enums.js';

export class QuizOptionResponseDto {
  @ApiProperty({ description: 'Option ID.', example: 'clxopt1' })
  id: string;

  @ApiProperty({ description: 'Option text.', example: 'Paris' })
  text: string;

  @ApiProperty({ description: 'Whether this option is correct.', example: true })
  isCorrect: boolean;

  @ApiProperty({ description: 'Order within the question.', example: 0 })
  position: number;
}

export class QuizQuestionResponseDto {
  @ApiProperty({ description: 'Question ID.', example: 'clxq1' })
  id: string;

  @ApiProperty({ enum: QuestionType, description: 'Question type.' })
  type: QuestionType;

  @ApiProperty({ description: 'Question text.', example: 'What is the capital of France?' })
  text: string;

  @ApiProperty({ description: 'Points awarded for a correct answer.', example: 2 })
  points: number;

  @ApiProperty({ description: 'Order within the quiz.', example: 0 })
  position: number;

  @ApiPropertyOptional({
    description: 'Options for SINGLE_CHOICE / MULTIPLE_CHOICE. Null otherwise.',
    type: [QuizOptionResponseDto],
    nullable: true,
  })
  options: QuizOptionResponseDto[] | null;

  @ApiPropertyOptional({
    description: 'Correct boolean for TRUE_FALSE. Null otherwise.',
    example: true,
    nullable: true,
  })
  correctBoolean: boolean | null;

  @ApiPropertyOptional({
    description: 'Accepted answers for FILL_IN_BLANK. Null otherwise.',
    type: [String],
    nullable: true,
  })
  acceptedAnswers: string[] | null;
}

export class QuizResponseDto {
  @ApiProperty({ description: 'CourseBlock ID of the quiz.', example: 'clxblock1' })
  id: string;

  @ApiProperty({ description: 'Course ID the quiz belongs to.', example: 'clxcourse1' })
  courseId: string;

  @ApiProperty({ description: 'Quiz title (CourseBlock.title).', example: 'Midterm Quiz' })
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
    description: 'Questions with answer keys (Lecturer view).',
    type: [QuizQuestionResponseDto],
  })
  questions: QuizQuestionResponseDto[];

  @ApiProperty({ description: 'Created at.', example: '2026-01-01T00:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ description: 'Updated at.', example: '2026-01-01T00:00:00.000Z' })
  updatedAt: Date;
}
