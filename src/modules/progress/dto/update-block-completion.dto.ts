import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateBlockCompletionDto {
  @ApiProperty({
    example: true,
    description: 'Whether the learning block is completed.',
  })
  @IsBoolean()
  completed!: boolean;
}
