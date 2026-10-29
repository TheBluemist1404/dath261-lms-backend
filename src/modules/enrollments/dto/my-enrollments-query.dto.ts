import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

import { MyEnrollmentState } from '../enums/my-enrollment-state.enum.js';

export class MyEnrollmentsQueryDto {
  @ApiPropertyOptional({
    description: 'Page number, starting from 1',
    example: 1,
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({
    description: 'Number of enrollments per page',
    example: 10,
    default: 10,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 10;

  @ApiPropertyOptional({
    enum: MyEnrollmentState,
    description: 'Filter My Courses by the derived course state',
    example: MyEnrollmentState.IN_PROGRESS,
  })
  @IsOptional()
  @IsEnum(MyEnrollmentState)
  state?: MyEnrollmentState;
}
