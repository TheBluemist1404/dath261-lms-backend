import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CourseIdParamDto {
  @ApiProperty({
    description: 'ID of the course',
    example: 'cm123456789abcdefghijklmno',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  courseId!: string;
}

export class CourseEnrollmentParamsDto extends CourseIdParamDto {
  @ApiProperty({ example: 'enrollment-123' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  enrollmentId!: string;
}
