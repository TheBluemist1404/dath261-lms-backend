import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { trim } from '../../workspaces/dto/trim.js';

export class CreatePageDto {
  @ApiProperty({ example: 'Week 3 notes', minLength: 1, maxLength: 200 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ nullable: true, description: 'A page in the same workspace.' })
  @IsOptional()
  @IsString()
  parentPageId?: string | null;
}
