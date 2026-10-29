import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { CourseStatus } from '../../generated/prisma/enums.js';

export class UpdateCourseStatusDto {
  @ApiProperty({
    description: 'The new status of the course.',
    enum: CourseStatus,
    example: CourseStatus.PUBLISHED,
  })
  @IsEnum(CourseStatus)
  status: CourseStatus;
}
