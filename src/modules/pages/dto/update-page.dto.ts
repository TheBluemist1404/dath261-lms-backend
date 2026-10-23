import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { trim } from '../../workspaces/dto/trim.js';

export class UpdatePageDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 200 })
  @ValidateIf((dto: UpdatePageDto) => dto.title !== undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Move under another page of the same workspace, or null for the top level.',
  })
  @IsOptional()
  @IsString()
  parentPageId?: string | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'The editor document as JSON.',
  })
  @IsOptional()
  @IsObject()
  content?: Record<string, unknown> | null;
}
