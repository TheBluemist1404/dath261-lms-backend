// quiz-question-input.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { QuestionType } from '../../../generated/prisma/enums.js';

export class QuizOptionInputDto {
  @ApiProperty({ description: 'Option text.', example: 'Paris' })
  @IsString()
  @IsNotEmpty()
  text: string;

  @ApiProperty({ description: 'Whether this option is a correct answer.', example: true })
  @IsBoolean()
  isCorrect: boolean;
}

export class QuizQuestionInputDto {
  @ApiProperty({
    description: 'Question type.',
    enum: QuestionType,
    example: QuestionType.SINGLE_CHOICE,
  })
  @IsEnum(QuestionType)
  type: QuestionType;

  @ApiProperty({ description: 'Question text.', example: 'What is the capital of France?' })
  @IsString()
  @IsNotEmpty()
  text: string;

  @ApiPropertyOptional({
    description: 'Points awarded for a correct answer. Defaults to 1.',
    example: 2,
    minimum: 0.01,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  points?: number;

  // --- SINGLE_CHOICE / MULTIPLE_CHOICE ---

  @ApiPropertyOptional({
    description:
      'Options for SINGLE_CHOICE / MULTIPLE_CHOICE. Required for those types and ' +
      'forbidden for TRUE_FALSE / FILL_IN_BLANK.',
    type: [QuizOptionInputDto],
  })
  @ValidateIf(
    (o: QuizQuestionInputDto) =>
      o.type === QuestionType.SINGLE_CHOICE || o.type === QuestionType.MULTIPLE_CHOICE,
  )
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => QuizOptionInputDto)
  options?: QuizOptionInputDto[];

  // --- TRUE_FALSE ---

  @ApiPropertyOptional({
    description: 'Correct boolean answer. Required for TRUE_FALSE, forbidden otherwise.',
    example: true,
  })
  @ValidateIf((o: QuizQuestionInputDto) => o.type === QuestionType.TRUE_FALSE)
  @IsBoolean()
  correctBoolean?: boolean;

  // --- FILL_IN_BLANK ---

  @ApiPropertyOptional({
    description:
      'Accepted answers for FILL_IN_BLANK (matched case-insensitively after trimming). ' +
      'Required for FILL_IN_BLANK, forbidden otherwise.',
    type: [String],
    example: ['Paris', 'paris'],
  })
  @ValidateIf((o: QuizQuestionInputDto) => o.type === QuestionType.FILL_IN_BLANK)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  acceptedAnswers?: string[];
}
