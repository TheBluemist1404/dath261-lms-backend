import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description: 'User account email',
    example: 'student@example.com',
  })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    description: 'Account password',
    example: 'your-password',
    writeOnly: true,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;
}
