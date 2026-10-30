import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional } from 'class-validator';

import type { ResumeData } from '../types/resume-data.type.js';

export class UpdateLearningPositionDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Versioned resume data. Null clears the saved resume data.',
    example: {
      version: 1,
      type: 'VIDEO',
      data: {
        positionSeconds: 125,
      },
    },
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  resumeData?: ResumeData | null;
}
