import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_DEADLINE_DAYS = 14;
export const MIN_DEADLINE_DAYS = 1;
export const MAX_DEADLINE_DAYS = 90;

export class DeadlineQueryDto {
  @ApiPropertyOptional({
    description:
      'Look-ahead window in days. Only quizzes whose deadline falls within ' +
      '[now, now + days] are returned.',
    default: DEFAULT_DEADLINE_DAYS,
    minimum: MIN_DEADLINE_DAYS,
    maximum: MAX_DEADLINE_DAYS,
    example: 14,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_DEADLINE_DAYS)
  @Max(MAX_DEADLINE_DAYS)
  days?: number;
}
