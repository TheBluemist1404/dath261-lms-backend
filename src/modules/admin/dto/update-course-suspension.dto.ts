import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCourseSuspensionDto {
  @ApiProperty({
    example: true,
    description: 'Whether the course should be suspended.',
  })
  @IsBoolean()
  suspended!: boolean;

  @ApiPropertyOptional({
    example: 'Course temporarily suspended pending content review.',
    description: 'Optional reason for changing the course suspension state.',
    maxLength: 500,
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value))
  @IsString()
  @MaxLength(500)
  reason?: string;
}
