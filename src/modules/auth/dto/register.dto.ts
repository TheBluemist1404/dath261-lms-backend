import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export enum RegisterRole {
  STUDENT = 'STUDENT',
  LECTURER = 'LECTURER',
}

export class RegisterDto {
  @ApiProperty({
    example: 'student@example.com',
    maxLength: 254,
    description: 'User email address',
  })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    example: 'your-password',
    minLength: 8,
    maxLength: 72,
    description: 'Account password',
    writeOnly: true,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @ApiProperty({
    enum: RegisterRole,
    example: RegisterRole.STUDENT,
    description: 'Role assigned during public registration',
  })
  @IsEnum(RegisterRole)
  role!: RegisterRole;

  @ApiProperty({
    example: 'Nguyen',
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({
    example: 'An',
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;
}
