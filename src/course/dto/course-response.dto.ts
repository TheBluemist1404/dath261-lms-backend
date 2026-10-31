import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CourseStatus } from '../../generated/prisma/enums.js';

//use for swagger UI
export class CourseResponseDto {
  @ApiProperty({ description: 'The unique identifier of the course.', example: 'clx123abc' })
  id: string;

  @ApiProperty({ description: 'The title of the course.', example: 'Introduction to NestJS' })
  title: string;

  @ApiPropertyOptional({
    description: 'A short description of the course.',
    example: 'Learn how to build scalable backend applications with NestJS.',
    nullable: true,
  })
  description: string | null;

  @ApiPropertyOptional({
    description: 'Prerequisites required before taking this course.',
    example: 'Basic knowledge of TypeScript and Node.js.',
    nullable: true,
  })
  prerequisites: string | null;

  @ApiProperty({
    description: 'The publication status of the course.',
    enum: CourseStatus,
    example: CourseStatus.DRAFT,
  })
  status: CourseStatus;

  @ApiProperty({
    description: 'Whether the course is currently suspended for new learners.',
    example: false,
  })
  isSuspended: boolean;

  @ApiProperty({
    description: 'The ID of the lecturer who owns the course.',
    example: 'clx789ghi',
  })
  lecturerId: string;

  @ApiPropertyOptional({
    description: 'The start date and time of the enrollment window.',
    example: '2026-01-01T00:00:00.000Z',
    nullable: true,
  })
  enrollmentStartAt: Date | null;

  @ApiPropertyOptional({
    description: 'The end date and time of the enrollment window.',
    example: '2026-02-01T00:00:00.000Z',
    nullable: true,
  })
  enrollmentEndAt: Date | null;

  @ApiProperty({
    description: 'The date and time the course was created.',
    example: '2026-01-01T00:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'The date and time the course was last updated.',
    example: '2026-01-02T00:00:00.000Z',
  })
  updatedAt: Date;
}
