import { createHash } from 'node:crypto';
import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
// biome-ignore lint/style/useImportType: NestJS DI requires value import
import { Test, TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

vi.mock('bcrypt', () => ({
  hash: vi.fn(),
  compare: vi.fn(),
}));

import * as bcrypt from 'bcrypt';

import { AccountStatus, UserRole } from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { UserService } from '../../users/user.service.js';
import { AuthService } from '../auth.service.js';
import { RegisterRole } from '../dto/register.dto.js';

describe('AuthService', () => {
  let service: AuthService;
  let moduleRef: TestingModule;

  const mockUserService = {
    getUserByEmailForAuth: vi.fn(),
    createUser: vi.fn(),
  };

  const mockJwtService = {
    signAsync: vi.fn(),
  };

  const mockConfigService = {
    get: vi.fn(),
    getOrThrow: vi.fn(),
  };

  const mockPrisma = {
    authSession: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  };

  const activeUser = {
    id: 'user-1',
    email: 'student@example.com',
    passwordHash: 'existing-password-hash',
    role: UserRole.STUDENT,
    status: AccountStatus.ACTIVE,
    firstName: 'An',
    lastName: 'Nguyen',
  };

  const publicUser = {
    id: activeUser.id,
    email: activeUser.email,
    role: activeUser.role,
    status: activeUser.status,
    firstName: activeUser.firstName,
    lastName: activeUser.lastName,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

  beforeEach(async () => {
    vi.resetAllMocks();

    mockConfigService.get.mockReturnValue('test-access-secret');
    mockConfigService.getOrThrow.mockReturnValue('test-access-secret');

    mockJwtService.signAsync.mockResolvedValue('signed-access-token');

    vi.mocked(bcrypt.hash as Mock).mockResolvedValue('new-password-hash');
    vi.mocked(bcrypt.compare as Mock).mockResolvedValue(true);

    moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserService, useValue: mockUserService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  describe('register', () => {
    it('hashes the password and creates a normalized user', async () => {
      mockUserService.createUser.mockResolvedValue(publicUser);

      const result = await service.register({
        email: '  STUDENT@Example.com ',
        password: 'StrongPassword123!',
        role: RegisterRole.STUDENT,
        firstName: ' An ',
        lastName: ' Nguyen ',
      });

      expect(bcrypt.hash).toHaveBeenCalledWith('StrongPassword123!', 10);

      expect(mockUserService.createUser).toHaveBeenCalledWith({
        email: 'student@example.com',
        passwordHash: 'new-password-hash',
        role: UserRole.STUDENT,
        firstName: 'An',
        lastName: 'Nguyen',
      });

      expect(result).toEqual({ user: publicUser });
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('propagates a duplicate-email error from UserService', async () => {
      mockUserService.createUser.mockRejectedValue(new ConflictException('Email already exists'));

      await expect(
        service.register({
          email: 'student@example.com',
          password: 'StrongPassword123!',
          role: RegisterRole.STUDENT,
          firstName: 'An',
          lastName: 'Nguyen',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('issues tokens for valid credentials and creates a session', async () => {
      mockUserService.getUserByEmailForAuth.mockResolvedValue(activeUser);
      mockPrisma.authSession.create.mockResolvedValue({});

      const startedAt = Date.now();

      const result = await service.login({
        email: activeUser.email,
        password: 'correct-password',
      });

      expect(bcrypt.compare).toHaveBeenCalledWith('correct-password', activeUser.passwordHash);

      expect(mockJwtService.signAsync).toHaveBeenCalledWith(
        {
          sub: activeUser.id,
          role: activeUser.role,
        },
        expect.objectContaining({
          secret: 'test-access-secret',
          expiresIn: '15m',
        }),
      );

      expect(result.accessToken).toBe('signed-access-token');
      expect(result.refreshToken).toBeTruthy();

      expect(result.refreshTokenExpiresAt.getTime()).toBeGreaterThan(
        startedAt + 6 * 24 * 60 * 60 * 1000,
      );

      expect(mockPrisma.authSession.create).toHaveBeenCalledWith({
        data: {
          userId: activeUser.id,
          refreshTokenHash: hashToken(result.refreshToken),
          expiresAt: result.refreshTokenExpiresAt,
        },
      });
    });

    it('rejects credentials when the user does not exist', async () => {
      mockUserService.getUserByEmailForAuth.mockResolvedValue(null);

      await expect(
        service.login({
          email: 'missing@example.com',
          password: 'password',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(bcrypt.compare).not.toHaveBeenCalled();
      expect(mockPrisma.authSession.create).not.toHaveBeenCalled();
    });

    it('rejects an incorrect password', async () => {
      mockUserService.getUserByEmailForAuth.mockResolvedValue(activeUser);
      vi.mocked(bcrypt.compare as Mock).mockResolvedValue(false);

      await expect(
        service.login({
          email: activeUser.email,
          password: 'wrong-password',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockPrisma.authSession.create).not.toHaveBeenCalled();
    });

    it('rejects suspended accounts', async () => {
      mockUserService.getUserByEmailForAuth.mockResolvedValue({
        ...activeUser,
        status: AccountStatus.SUSPENDED,
      });

      await expect(
        service.login({
          email: activeUser.email,
          password: 'correct-password',
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(mockPrisma.authSession.create).not.toHaveBeenCalled();
    });
  });

  describe('refreshToken', () => {
    const rawToken = 'existing-refresh-token';

    const makeSession = (overrides = {}) => ({
      id: 'session-1',
      userId: activeUser.id,
      refreshTokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      createdAt: new Date(),
      user: {
        id: activeUser.id,
        role: activeUser.role,
        status: AccountStatus.ACTIVE,
      },
      ...overrides,
    });

    it('rotates a valid token', async () => {
      const session = makeSession();

      mockPrisma.authSession.findUnique.mockResolvedValue(session);
      mockPrisma.authSession.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.refreshToken(rawToken);

      expect(mockPrisma.authSession.findUnique).toHaveBeenCalledWith({
        where: {
          refreshTokenHash: hashToken(rawToken),
        },
        include: {
          user: {
            select: {
              id: true,
              role: true,
              status: true,
            },
          },
        },
      });

      expect(result.accessToken).toBe('signed-access-token');
      expect(result.refreshToken).not.toBe(rawToken);
      expect(result.refreshTokenExpiresAt).toEqual(session.expiresAt);

      expect(mockPrisma.authSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: session.id,
            refreshTokenHash: hashToken(rawToken),
            revokedAt: null,
          }),
          data: {
            refreshTokenHash: hashToken(result.refreshToken),
          },
        }),
      );
    });

    it('rejects an empty token', async () => {
      await expect(service.refreshToken('')).rejects.toThrow(UnauthorizedException);

      expect(mockPrisma.authSession.findUnique).not.toHaveBeenCalled();
    });

    it('rejects a token with no matching session', async () => {
      mockPrisma.authSession.findUnique.mockResolvedValue(null);

      await expect(service.refreshToken(rawToken)).rejects.toThrow(UnauthorizedException);

      expect(mockPrisma.authSession.updateMany).not.toHaveBeenCalled();
    });

    it.each(['revoked', 'expired'] as const)('rejects a %s session', async (state) => {
      const session =
        state === 'revoked'
          ? makeSession({ revokedAt: new Date() })
          : makeSession({ expiresAt: new Date(Date.now() - 1000) });

      mockPrisma.authSession.findUnique.mockResolvedValue(session);

      await expect(service.refreshToken(rawToken)).rejects.toThrow(UnauthorizedException);

      expect(mockPrisma.authSession.updateMany).not.toHaveBeenCalled();
    });

    it("revokes a suspended user's session", async () => {
      mockPrisma.authSession.findUnique.mockResolvedValue(
        makeSession({
          user: {
            id: activeUser.id,
            role: activeUser.role,
            status: AccountStatus.SUSPENDED,
          },
        }),
      );

      mockPrisma.authSession.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.refreshToken(rawToken)).rejects.toThrow(ForbiddenException);

      expect(mockPrisma.authSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'session-1',
            revokedAt: null,
          },
          data: {
            revokedAt: expect.any(Date),
          },
        }),
      );
    });

    it('rejects if another request has already rotated the token', async () => {
      mockPrisma.authSession.findUnique.mockResolvedValue(makeSession());
      mockPrisma.authSession.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.refreshToken(rawToken)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('does nothing when no token is supplied', async () => {
      await service.logout();

      expect(mockPrisma.authSession.updateMany).not.toHaveBeenCalled();
    });

    it('revokes the matching session', async () => {
      mockPrisma.authSession.updateMany.mockResolvedValue({ count: 1 });

      await service.logout('existing-refresh-token');

      expect(mockPrisma.authSession.updateMany).toHaveBeenCalledWith({
        where: {
          refreshTokenHash: hashToken('existing-refresh-token'),
          revokedAt: null,
        },
        data: {
          revokedAt: expect.any(Date),
        },
      });
    });
  });
});
