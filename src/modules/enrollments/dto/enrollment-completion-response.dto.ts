import { ApiProperty } from '@nestjs/swagger';
import { EnrollmentStatus } from '../../../generated/prisma/enums.js';

export class EnrollmentCompletionResponseDto {
  @ApiProperty()
  enrollmentId!: string;

  @ApiProperty({ enum: EnrollmentStatus })
  status!: EnrollmentStatus;

  @ApiProperty()
  completedAt!: Date;
}
