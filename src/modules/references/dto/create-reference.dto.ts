import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class CreateReferenceDto {
  @ApiProperty({ example: 'cm123block' })
  @IsString()
  @IsNotEmpty()
  courseBlockId!: string;

  @ApiPropertyOptional({
    nullable: true,
    minimum: 0,
    description: 'Videos only: whole seconds from the start, up to the video duration.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  timestampSeconds?: number | null;
}
