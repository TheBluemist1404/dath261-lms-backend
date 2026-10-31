import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CourseParamsDto {
  @ApiProperty({ example: 'course-123' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  courseId!: string;
}

export class CourseBlockParamsDto extends CourseParamsDto {
  @ApiProperty({ example: 'block-123' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  blockId!: string;
}

export class CourseEnrollmentParamsDto extends CourseParamsDto {
  @ApiProperty({ example: 'enrollment-123' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  enrollmentId!: string;
}
