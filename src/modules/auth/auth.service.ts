import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { AccountStatus, UserRole } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import type { UserService } from '../users/user.service.js';
import type { loginDto } from './dto/login.dto.js';
import { type RegisterDto, RegisterRole } from './dto/register.dto.js';
import type { AccessTokenPayload } from './types/access-token-payload.type.js';
import type { IssuedAuthTokens } from './types/issued-auth-tokens.type.js';

const registerRoleMap = {
  [RegisterRole.STUDENT]: UserRole.STUDENT,
  [RegisterRole.LECTURER]: UserRole.LECTURER,
} satisfies Record<RegisterRole, UserRole>;

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async login(dto: loginDto): Promise<IssuedAuthTokens> {
    const email = dto.email.trim().toLowerCase();
    const password = dto.password;

    const user = await this.userService.getUserByEmailForAuth(email);

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status === AccountStatus.SUSPENDED) {
      throw new ForbiddenException('This account has been suspended.');
    }

    const accessToken = await this.generateAccessToken(user.id, user.role);

    const refresh = this.createRefreshToken();

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.prisma.authSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: refresh.hash,
        expiresAt,
      },
    });
    return {
      accessToken,
      refreshToken: refresh.token,
      refreshTokenExpiresAt: expiresAt,
    };
  }

  async register(data: RegisterDto) {
    const passwordHash = await bcrypt.hash(data.password, 10);

    const user = await this.userService.createUser({
      email: data.email.trim().toLowerCase(),
      passwordHash,
      role: registerRoleMap[data.role],
      firstName: data.firstName.trim(),
      lastName: data.lastName.trim(),
    });

    return { user };
  }

  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private createRefreshToken() {
    const token = randomBytes(32).toString('base64url');
    return {
      token,
      hash: this.hashRefreshToken(token),
    };
  }

  async generateAccessToken(userId: string, role: UserRole): Promise<string> {
    const payload: AccessTokenPayload = { sub: userId, role };

    return await this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: '15m',
    });
  }

  async refreshToken(refreshToken: string): Promise<IssuedAuthTokens> {
    if (!refreshToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const hash = this.hashRefreshToken(refreshToken);
    const now = new Date();

    const session = await this.prisma.authSession.findUnique({
      where: {
        refreshTokenHash: hash,
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

    if (!session || session.revokedAt !== null || session.expiresAt <= now) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (session.user.status === AccountStatus.SUSPENDED) {
      await this.prisma.authSession.updateMany({
        where: {
          id: session.id,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });

      throw new ForbiddenException('This account has been suspended.');
    }

    const newToken = this.createRefreshToken();

    const accessToken = await this.generateAccessToken(session.user.id, session.user.role);

    const rotation = await this.prisma.authSession.updateMany({
      where: {
        id: session.id,
        refreshTokenHash: hash,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        refreshTokenHash: newToken.hash,
      },
    });

    if (rotation.count !== 1) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return {
      accessToken,
      refreshToken: newToken.token,
      refreshTokenExpiresAt: session.expiresAt,
    };
  }

  async logout(refreshToken?: string): Promise<void> {
    if (!refreshToken) {
      return;
    }

    const hash = this.hashRefreshToken(refreshToken);

    await this.prisma.authSession.updateMany({
      where: {
        refreshTokenHash: hash,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }
}
