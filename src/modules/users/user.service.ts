import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AccountStatus, Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import type { CreateUserData } from './types/create-user.type.js';

const excludeUserFields = {
  passwordHash: true,
} satisfies Prisma.UserOmit;
@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async createUser(data: CreateUserData) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: data.email },
      omit: { passwordHash: true },
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
      omit: excludeUserFields,
    });
  }

  async getUserById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      omit: excludeUserFields,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async getUserByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      omit: excludeUserFields,
    });
  }

  async updateStatus(id: string, status: AccountStatus) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      omit: excludeUserFields,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.prisma.user.update({
      where: { id },
      data: { status },
      omit: excludeUserFields,
    });
  }
}
