import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { trim } from '../../workspaces/dto/trim.js';

export class CreateMessageDto {
  @ApiProperty({ example: 'Does round robin need a fixed quantum?', minLength: 1, maxLength: 2000 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content!: string;
}
