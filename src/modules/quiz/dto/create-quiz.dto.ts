// create-quiz.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { QuizScoringMode } from '../../../generated/prisma/enums.js';
import { QuizQuestionInputDto } from './quiz-question-input.dto.js';

export class CreateQuizDto {
  @ApiProperty({ description: 'Quiz title (stored on the CourseBlock).', example: 'Midterm Quiz' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({
    description: 'Maximum number of attempts allowed per Student. Defaults to 1.',
    example: 3,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxAttempts?: number;

  @ApiPropertyOptional({
    description: 'How multiple attempts contribute to the final quiz score. Defaults to HIGHEST.',
    enum: QuizScoringMode,
    example: QuizScoringMode.HIGHEST,
  })
  @IsOptional()
  @IsEnum(QuizScoringMode)
  scoringMode?: QuizScoringMode;

  @ApiPropertyOptional({
    description: 'When the quiz becomes available. ISO 8601 date string.',
    example: '2026-01-01T00:00:00.000Z',
    nullable: true,
  })
  @IsOptional()
  @IsDateString()
  availableFrom?: string | null;

  @ApiPropertyOptional({
    description: 'Submission deadline. ISO 8601 date string.',
    example: '2026-02-01T00:00:00.000Z',
    nullable: true,
  })
  @IsOptional()
  @IsDateString()
  deadline?: string | null;

  @ApiPropertyOptional({
    description:
      'Whether submissions after the deadline are accepted (flagged as Late). Defaults to false.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  allowLate?: boolean;

  @ApiProperty({
    description: 'Questions to include in the quiz. Must contain at least one question.',
    type: [QuizQuestionInputDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuizQuestionInputDto)
  questions: QuizQuestionInputDto[];
}
