import { ApiProperty } from '@nestjs/swagger';
import { CourseStatus, EnrollmentStatus } from '../../../generated/prisma/client.js';

export class EnrollmentCourseSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ enum: CourseStatus })
  status!: CourseStatus;

  @ApiProperty()
  isSuspended!: boolean;
}

export class MyCourseEnrollmentResponseDto {
  @ApiProperty()
  enrollmentId!: string;

  @ApiProperty()
  courseId!: string;

  @ApiProperty({ enum: EnrollmentStatus })
  status!: EnrollmentStatus;

  @ApiProperty()
  courseAvailable!: boolean;

  @ApiProperty()
  canAccessCourse!: boolean;

  @ApiProperty({ type: EnrollmentCourseSummaryDto })
  course!: EnrollmentCourseSummaryDto;
}
