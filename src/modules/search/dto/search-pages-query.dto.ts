import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { trim } from '../../workspaces/dto/trim.js';

export class SearchPagesQueryDto {
  @ApiProperty({ minLength: 2, maxLength: 200, description: 'Matched in titles and page text.' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  q!: string;
}
