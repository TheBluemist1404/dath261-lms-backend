import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AccountStatus } from '../../../generated/prisma/enums.js';
import type { UserService } from '../../users/user.service.js';
import type { AccessTokenPayload } from '../types/access-token-payload.type.js';
import type { AuthenticatedUser } from '../types/authenticated-user.type.js';

@Injectable()
export class AccessTokenStrategy extends PassportStrategy(Strategy, 'access-token') {
  constructor(
    configService: ConfigService,
    private readonly userService: UserService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      algorithms: ['HS256'],
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    if (!payload || typeof payload.sub !== 'string') {
      throw new UnauthorizedException('Invalid access token');
    }

    const user = await this.userService.getAuthContextById(payload.sub);

    if (!user) {
      throw new UnauthorizedException('Invalid access token');
    }

    if (user.status === AccountStatus.SUSPENDED) {
      throw new ForbiddenException('This account has been suspended.');
    }

    return {
      userId: user.id,
      role: user.role,
    };
  }
}
