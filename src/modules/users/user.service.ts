import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AccountStatus, Prisma } from '../../generated/prisma/client.js';
// biome-ignore lint/style/useImportType: NestJS DI requires value import
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import type { CreateUserData } from './types/create-user.type.js';

const excludePublicUserFields = {
  passwordHash: true,
} satisfies Prisma.UserOmit;

export type PublicUser = Prisma.UserGetPayload<{
  omit: typeof excludePublicUserFields;
}>;
@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async createUser(data: CreateUserData): Promise<PublicUser> {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: data.email },
      omit: excludePublicUserFields,
    });

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    return this.prisma.user.create({
      data: {
        email: data.email,
        passwordHash: data.passwordHash,
        role: data.role,
        firstName: data.firstName,
        lastName: data.lastName,
      },
      omit: excludePublicUserFields,
    });
  }

  async getUserById(id: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      omit: excludePublicUserFields,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async getUserByEmail(email: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      omit: excludePublicUserFields,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateStatus(id: string, status: AccountStatus): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      omit: excludePublicUserFields,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.prisma.user.update({
      where: { id },
      data: { status },
      omit: excludePublicUserFields,
    });
  }
}
