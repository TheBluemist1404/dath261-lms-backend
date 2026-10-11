import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class loginDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;
}
