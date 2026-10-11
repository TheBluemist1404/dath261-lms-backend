import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// biome-ignore lint/style/useImportType: NestJS DI requires value import
import { Test, TestingModule } from '@nestjs/testing';
import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthController } from '../auth.controller.js';
import { AuthService } from '../auth.service.js';
import { type RegisterDto, RegisterRole } from '../dto/register.dto.js';

describe('AuthController', () => {
  let controller: AuthController;
  let moduleRef: TestingModule;

  const mockAuthService = {
    register: vi.fn(),
    login: vi.fn(),
    refreshToken: vi.fn(),
    logout: vi.fn(),
  };

  const mockConfigService = {
    get: vi.fn(),
  };

  const mockResponse = () => ({
    cookie: vi.fn(),
    clearCookie: vi.fn(),
  });

  beforeEach(async () => {
    vi.resetAllMocks();
    mockConfigService.get.mockReturnValue('test');

    moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    controller = moduleRef.get(AuthController);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('delegates register to AuthService', async () => {
    const dto: RegisterDto = {
      email: 'student@example.com',
      password: 'Password123!',
      role: RegisterRole.STUDENT,
      firstName: 'An',
      lastName: 'Nguyen',
    };

    mockAuthService.register.mockResolvedValue({
      user: { id: 'user-1', email: dto.email },
    });

    const result = await controller.register(dto);

    expect(mockAuthService.register).toHaveBeenCalledWith(dto);
    expect(result).toEqual({
      user: { id: 'user-1', email: dto.email },
    });
  });

  it('sets refresh cookie and only returns access token on login', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const response = mockResponse();

    mockAuthService.login.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      refreshTokenExpiresAt: expiresAt,
    });

    const result = await controller.login(
      {
        email: 'student@example.com',
        password: 'Password123!',
      },
      response as unknown as Response,
    );

    expect(mockAuthService.login).toHaveBeenCalledWith({
      email: 'student@example.com',
      password: 'Password123!',
    });

    expect(response.cookie).toHaveBeenCalledWith(
      'refresh_token',
      'refresh-token',
      expect.objectContaining({
        httpOnly: true,
        secure: false,
        sameSite: 'strict',
        path: '/api/auth',
        expires: expiresAt,
      }),
    );

    expect(result).toEqual({
      accessToken: 'access-token',
    });
    expect(result).not.toHaveProperty('refreshToken');
  });

  it('rejects refresh when cookie is missing', async () => {
    const response = mockResponse();

    await expect(
      controller.refresh({ cookies: {} } as unknown as Request, response as unknown as Response),
    ).rejects.toThrow(UnauthorizedException);

    expect(mockAuthService.refreshToken).not.toHaveBeenCalled();
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it('rotates the refresh cookie after successful refresh', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const response = mockResponse();

    mockAuthService.refreshToken.mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      refreshTokenExpiresAt: expiresAt,
    });

    const result = await controller.refresh(
      {
        cookies: { refresh_token: 'old-refresh-token' },
      } as unknown as Request,
      response as unknown as Response,
    );

    expect(mockAuthService.refreshToken).toHaveBeenCalledWith('old-refresh-token');

    expect(response.cookie).toHaveBeenCalledWith(
      'refresh_token',
      'new-refresh-token',
      expect.objectContaining({
        httpOnly: true,
        expires: expiresAt,
      }),
    );

    expect(result).toEqual({
      accessToken: 'new-access-token',
    });
    expect(result).not.toHaveProperty('refreshToken');
  });

  it('revokes the refresh token and clears the cookie on logout', async () => {
    const response = mockResponse();

    await controller.logout(
      {
        cookies: { refresh_token: 'refresh-token' },
      } as unknown as Request,
      response as unknown as Response,
    );

    expect(mockAuthService.logout).toHaveBeenCalledWith('refresh-token');

    expect(response.clearCookie).toHaveBeenCalledWith(
      'refresh_token',
      expect.objectContaining({
        httpOnly: true,
        path: '/api/auth',
      }),
    );
  });
});
