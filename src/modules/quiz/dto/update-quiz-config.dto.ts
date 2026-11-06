// update-quiz-config.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { QuizScoringMode } from '../../../generated/prisma/enums.js';

export class UpdateQuizConfigDto {
  @ApiPropertyOptional({
    description: 'Maximum number of attempts allowed per Student.',
    example: 3,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxAttempts?: number;

  @ApiPropertyOptional({
    description: 'How multiple attempts contribute to the final quiz score.',
    enum: QuizScoringMode,
  })
  @IsOptional()
  @IsEnum(QuizScoringMode)
  scoringMode?: QuizScoringMode;

  @ApiPropertyOptional({
    description: 'When the quiz becomes available. ISO 8601 date string, or null to clear.',
    nullable: true,
  })
  @IsOptional()
  @IsDateString()
  availableFrom?: string | null;

  @ApiPropertyOptional({
    description: 'Submission deadline. ISO 8601 date string, or null to clear.',
    nullable: true,
  })
  @IsOptional()
  @IsDateString()
  deadline?: string | null;

  @ApiPropertyOptional({
    description: 'Whether submissions after the deadline are accepted (flagged as Late).',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  allowLate?: boolean;
}
