import { ApiProperty } from '@nestjs/swagger';
import { RegisteredUserResponseDto } from './registered-user-response.dto.js';

export class RegisterResponseDto {
  @ApiProperty({ type: RegisteredUserResponseDto })
  user!: RegisteredUserResponseDto;
}
