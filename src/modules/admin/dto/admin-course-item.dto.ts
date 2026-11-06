import { ApiProperty } from '@nestjs/swagger';
import { CourseStatus } from '../../../generated/prisma/enums.js';

export class AdminCourseLecturerDto {
  @ApiProperty({ example: 'cm123lecturer' })
  id!: string;

  @ApiProperty({ example: 'Nguyen Van A' })
  name!: string;
}

export class AdminCourseItemDto {
  @ApiProperty({ example: 'cm123course' })
  id!: string;

  @ApiProperty({ example: 'Introduction to NestJS' })
  title!: string;

  @ApiProperty({ enum: CourseStatus, example: CourseStatus.PUBLISHED })
  status!: CourseStatus;

  @ApiProperty({ example: false })
  isSuspended!: boolean;

  @ApiProperty({ type: AdminCourseLecturerDto })
  lecturer!: AdminCourseLecturerDto;

  @ApiProperty({ example: 15 })
  enrollmentCount!: number;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  createdAt!: Date;
}
