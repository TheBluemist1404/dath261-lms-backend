import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateCourseSuspensionDto {
  @ApiProperty({
    example: true,
    description: 'Whether the course should be suspended.',
  })
  @IsBoolean()
  suspended!: boolean;
}
