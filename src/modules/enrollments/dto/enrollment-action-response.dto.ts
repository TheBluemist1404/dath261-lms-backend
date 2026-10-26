import { ApiProperty } from '@nestjs/swagger';
import { EnrollmentStatus } from '../../../generated/prisma/client.js';

export class EnrollmentActionResponseDto {
  @ApiProperty()
  enrollmentId!: string;

  @ApiProperty()
  courseId!: string;

  @ApiProperty({ enum: EnrollmentStatus })
  status!: EnrollmentStatus;

  @ApiProperty()
  canAccessCourse!: boolean;
}
