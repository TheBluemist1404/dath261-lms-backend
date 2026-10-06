import { Injectable } from '@nestjs/common';
import type { AccountStatus, Prisma, User } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import type { CreateUserData } from './types/create-user.data.js';

const excludeUserFields = {
  passwordHash: true,
} satisfies Prisma.UserOmit;
@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateUserData) {
    return this.prisma.user.create({
      data: {
        email: data.email,
        passwordHash: data.passwordHash,
        role: data.role,
        firstName: data.firstName,
        lastName: data.lastName,
      },
      omit: excludeUserFields,
    });
  }

  async findById(id: string): Promise<Omit<User, 'passwordHash'> | null> {
    return this.prisma.user.findUnique({
      where: { id },
      omit: excludeUserFields,
    });
  }

  async findByEmail(email: string): Promise<Omit<User, 'passwordHash'> | null> {
    return this.prisma.user.findUnique({
      where: { email },
      omit: excludeUserFields,
    });
  }

  async updateStatus(
    id: string,
    status: AccountStatus,
  ): Promise<Omit<User, 'passwordHash'> | null> {
    return this.prisma.user.update({
      where: { id },
      data: { status },
      omit: excludeUserFields,
    });
  }
}
