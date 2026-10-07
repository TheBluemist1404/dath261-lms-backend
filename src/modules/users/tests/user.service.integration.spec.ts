import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountStatus, UserRole } from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import type { CreateUserData } from '../types/create-user.type.js';
import { UserService } from '../user.service.js';

describe('UserService - integration', () => {
  let service: UserService;
  let prisma: PrismaService;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env.test',
        }),
      ],
      providers: [PrismaService, UserService],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(UserService);

    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.user.deleteMany({
      where: {
        email: {
          startsWith: 'service-integration-',
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  it('should create a user', async () => {
    const data: CreateUserData = {
      email: 'service-integration-create@example.com',
      passwordHash: 'hashed-password',
      role: UserRole.STUDENT,
      firstName: 'Van A',
      lastName: 'Nguyen',
    };

    const user = await service.createUser(data);

    expect(user.id).toBeDefined();
    expect(user.email).toBe(data.email);
    expect(user.role).toBe(UserRole.STUDENT);
    expect(user.status).toBe(AccountStatus.ACTIVE);
    expect(user.firstName).toBe('Van A');
    expect(user.lastName).toBe('Nguyen');

    expect(user).not.toHaveProperty('passwordHash');
  });

  it('should find a user by id', async () => {
    const created = await service.createUser({
      email: 'service-integration-find-id@example.com',
      passwordHash: 'hashed-password',
      role: UserRole.STUDENT,
    });

    const user = await service.getUserById(created.id);

    expect(user.id).toBe(created.id);
    expect(user.email).toBe(created.email);
    expect(user).not.toHaveProperty('passwordHash');
  });

  it('should throw when user id does not exist', async () => {
    await expect(service.getUserById('non-existent-user-id')).rejects.toThrow(NotFoundException);
  });

  it('should find a user by email', async () => {
    const email = 'service-integration-find-email@example.com';

    const created = await service.createUser({
      email,
      passwordHash: 'hashed-password',
      role: UserRole.LECTURER,
    });

    const user = await service.getUserByEmail(email);

    expect(user).not.toBeNull();
    expect(user?.id).toBe(created.id);
    expect(user?.email).toBe(email);
    expect(user?.role).toBe(UserRole.LECTURER);
    expect(user).not.toHaveProperty('passwordHash');
  });

  it('should throw NotFoundException when email does not exist', async () => {
    await expect(
      service.getUserByEmail('service-integration-not-found@example.com'),
    ).rejects.toThrow(NotFoundException);
  });

  it('should update user status to suspended', async () => {
    const created = await service.createUser({
      email: 'service-integration-suspend@example.com',
      passwordHash: 'hashed-password',
      role: UserRole.STUDENT,
    });

    const updated = await service.updateStatus(created.id, AccountStatus.SUSPENDED);

    expect(updated.status).toBe(AccountStatus.SUSPENDED);

    const persisted = await service.getUserById(created.id);

    expect(persisted.status).toBe(AccountStatus.SUSPENDED);
  });

  it('should reactivate a suspended user', async () => {
    const created = await service.createUser({
      email: 'service-integration-reactivate@example.com',
      passwordHash: 'hashed-password',
      role: UserRole.STUDENT,
    });

    await service.updateStatus(created.id, AccountStatus.SUSPENDED);

    const updated = await service.updateStatus(created.id, AccountStatus.ACTIVE);

    expect(updated.status).toBe(AccountStatus.ACTIVE);
  });

  it('should reject duplicate email', async () => {
    const email = 'service-integration-duplicate@example.com';

    await service.createUser({
      email,
      passwordHash: 'hash-1',
      role: UserRole.STUDENT,
    });

    await expect(
      service.createUser({
        email,
        passwordHash: 'hash-2',
        role: UserRole.LECTURER,
      }),
    ).rejects.toThrow(ConflictException);
  });
});
