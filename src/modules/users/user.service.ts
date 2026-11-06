import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AccountStatus, Prisma } from '../../generated/prisma/client.js';
import { AuditAction, AuditEntityType } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { CreateUserData } from './types/create-user.type.js';

const excludePublicUserFields = {
  passwordHash: true,
} satisfies Prisma.UserOmit;

export type AuthUser = Prisma.UserGetPayload<{
  select: {
    id: true;
    email: true;
    passwordHash: true;
    role: true;
    status: true;
    firstName: true;
    lastName: true;
  };
}>;

export type PublicUser = Prisma.UserGetPayload<{
  omit: typeof excludePublicUserFields;
}>;
@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

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

  async updateStatus(
    id: string,
    status: AccountStatus,
    actorId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<PublicUser> {
    if (tx) {
      return this.updateStatusInTransaction(tx, id, status, actorId);
    }

    return this.prisma.$transaction((transaction) =>
      this.updateStatusInTransaction(transaction, id, status, actorId),
    );
  }

  private async updateStatusInTransaction(
    tx: Prisma.TransactionClient,
    id: string,
    status: AccountStatus,
    actorId: string,
  ): Promise<PublicUser> {
    const user = await tx.user.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updated = await tx.user.update({
      where: { id },
      data: { status },
      omit: excludePublicUserFields,
    });

    await this.auditService.record(
      {
        actorId,
        action: AuditAction.ACCOUNT_STATUS_CHANGED,
        entityType: AuditEntityType.USER,
        entityId: id,
        metadata: {
          from: user.status,
          to: status,
        },
      },
      tx,
    );

    return updated;
  }

  async getUserByEmailForAuth(email: string): Promise<AuthUser | null> {
    return this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        role: true,
        status: true,
        firstName: true,
        lastName: true,
      },
    });
  }

  async getAuthContextById(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        status: true,
      },
    });
  }
}
