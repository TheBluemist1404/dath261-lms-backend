import { ApiProperty } from '@nestjs/swagger';
import { EnrollmentStatus } from '../../../generated/prisma/client.js';

export class EnrollmentStateResponseDto {
  @ApiProperty()
  courseId!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null when the student has never enrolled.',
  })
  enrollmentId!: string | null;

  @ApiProperty({
    enum: EnrollmentStatus,
    nullable: true,
  })
  enrollmentStatus!: EnrollmentStatus | null;

  @ApiProperty()
  courseAvailable!: boolean;

  @ApiProperty()
  canAccessCourse!: boolean;
}
