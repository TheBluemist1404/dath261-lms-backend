// submit-quiz-attempt.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/**
 * One answer for one question. Shape must match the question type:
 * - SINGLE_CHOICE / MULTIPLE_CHOICE: `selectedOptionIds`
 * - TRUE_FALSE:                     `booleanAnswer`
 * - FILL_IN_BLANK:                  `textAnswer`
 *
 * The DTO only validates structural shape; type-specific enforcement
 * happens in QuizService (it has the questions loaded and can ignore
 * answers with a mismatched payload rather than reject the whole request).
 */
export class SubmitAnswerDto {
  @ApiProperty({ description: 'ID of the question this answer belongs to.' })
  @IsString()
  @IsNotEmpty()
  questionId: string;

  @ApiPropertyOptional({
    description: 'Selected option IDs (SINGLE_CHOICE / MULTIPLE_CHOICE).',
    type: [String],
  })
  @ValidateIf((o: SubmitAnswerDto) => o.selectedOptionIds !== undefined)
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  selectedOptionIds?: string[];

  @ApiPropertyOptional({ description: 'Free-text answer (FILL_IN_BLANK).' })
  @ValidateIf((o: SubmitAnswerDto) => o.textAnswer !== undefined)
  @IsString()
  textAnswer?: string;

  @ApiPropertyOptional({ description: 'Boolean answer (TRUE_FALSE).' })
  @ValidateIf((o: SubmitAnswerDto) => o.booleanAnswer !== undefined)
  @IsBoolean()
  booleanAnswer?: boolean;
}

export class SubmitQuizAttemptDto {
  @ApiProperty({
    description: 'Answers for this attempt. May be empty (Student submits without answering).',
    type: [SubmitAnswerDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubmitAnswerDto)
  answers: SubmitAnswerDto[];
}
