import { Injectable } from '@nestjs/common';
import type { AccountStatus, User } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import type { CreateUserData } from './types/create-user.data.js';

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
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async updateStatus(id: string, status: AccountStatus): Promise<User | null> {
    return this.prisma.user.update({
      where: { id },
      data: { status },
    });
  }
}
