import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateCourseDto {
  @ApiProperty({
    description: 'The title of the course.',
    example: 'Introduction to NestJS',
  })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({
    description: 'A short description of the course.',
    example: 'Learn how to build scalable backend applications with NestJS.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Prerequisites required before taking this course.',
    example: 'Basic knowledge of TypeScript and Node.js.',
  })
  @IsOptional()
  @IsString()
  prerequisites?: string;

  @ApiPropertyOptional({
    description: 'The start date and time of the enrollment window.',
    example: '2026-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  enrollmentStartAt?: string | null;

  @ApiPropertyOptional({
    description: 'The end date and time of the enrollment window.',
    example: '2026-02-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  enrollmentEndAt?: string | null;
}
