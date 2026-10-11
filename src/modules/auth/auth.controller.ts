import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { AuthService } from './auth.service.js';
import { Public } from './decorators/public.decorator.js';
import type { loginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import { AuthTokenResponseDto } from './dto/responses/auth-token-response.dto.js';
import { RegisterResponseDto } from './dto/responses/register-response.dto.js';
import type { IssuedAuthTokens } from './types/issued-auth-tokens.type.js';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a new account',
    description:
      'Creates a Student or Lecturer account. Public registration cannot create an Admin account.',
  })
  @ApiCreatedResponse({
    description: 'Account successfully created.',
    type: RegisterResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid request body.',
  })
  @ApiConflictResponse({
    description: 'An account with this email already exists.',
  })
  async register(@Body() dto: RegisterDto): Promise<RegisterResponseDto> {
    const { user } = await this.authService.register(dto);
    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        firstName: user.firstName,
        lastName: user.lastName,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log in',
    description:
      'Authenticates a user, returns an access token and sets a refresh token in an HttpOnly cookie.',
  })
  @ApiOkResponse({
    description:
      'Login successful. The refresh token is sent through Set-Cookie, not in the response body.',
    type: AuthTokenResponseDto,
    headers: {
      'Set-Cookie': {
        description: 'Sets the refresh_token cookie.',
        schema: { type: 'string' },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid request body.',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid email or password.',
  })
  @ApiForbiddenResponse({
    description: 'The account is suspended.',
  })
  async login(
    @Body() dto: loginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokenResponseDto> {
    const data: IssuedAuthTokens = await this.authService.login(dto);
    this.setRefreshCookie(res, data.refreshToken, data.refreshTokenExpiresAt);
    return { accessToken: data.accessToken };
  }

  private getRefreshCookieOptions() {
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';

    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict' as const,
      path: '/api/auth',
    };
  }

  private setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
    res.cookie('refresh_token', token, {
      ...this.getRefreshCookieOptions(),
      expires: expiresAt,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie('refresh_token', this.getRefreshCookieOptions());
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('refreshToken')
  @ApiOperation({
    summary: 'Refresh access token',
    description: 'Validates and rotates the refresh token stored in the refresh_token cookie.',
  })
  @ApiOkResponse({
    description: 'Refresh successful. Returns a new access token and replaces the refresh cookie.',
    type: AuthTokenResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Refresh token is missing, invalid, revoked, or expired.',
  })
  @ApiForbiddenResponse({
    description: 'The account is suspended.',
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokenResponseDto> {
    const refreshToken = req.cookies?.refresh_token;

    if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const result = await this.authService.refreshToken(refreshToken);

    this.setRefreshCookie(res, result.refreshToken, result.refreshTokenExpiresAt);

    return {
      accessToken: result.accessToken,
    };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth('refreshToken')
  @ApiOperation({
    summary: 'Log out',
    description:
      'Revokes the session associated with the refresh cookie, if present, and clears the cookie.',
  })
  @ApiNoContentResponse({
    description:
      'Logout completed. The refresh cookie is cleared and the associated session is revoked if present.',
    headers: {
      'Set-Cookie': {
        description: 'Clears the refresh_token cookie.',
        schema: { type: 'string' },
      },
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'The server could not complete the logout operation.',
  })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const refreshToken: unknown = req.cookies?.refresh_token;

    this.clearRefreshCookie(res);

    if (typeof refreshToken === 'string' && refreshToken.length > 0) {
      await this.authService.logout(refreshToken);
    }
  }
}
