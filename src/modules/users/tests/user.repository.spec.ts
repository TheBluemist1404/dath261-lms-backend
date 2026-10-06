import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountStatus, UserRole } from '../../../generated/prisma/enums.js';

import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import type { CreateUserData } from '../types/create-user.data.js';
import { UserRepository } from '../user.repository.js';

describe('UserRepository', () => {
  let repository: UserRepository;
  let prisma: PrismaService;
  let moduleRef: TestingModule;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env.test',
        }),
      ],
      providers: [PrismaService, UserRepository],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    repository = moduleRef.get(UserRepository);
  });

  beforeEach(async () => {
    await prisma.user.deleteMany({
      where: {
        email: {
          startsWith: 'repo-test-',
        },
      },
    });
  });

  it('should create a user', async () => {
    const data: CreateUserData = {
      email: 'repo-test-create@example.com',
      passwordHash: 'hashed-password',
      role: UserRole.STUDENT,
      firstName: 'Van A',
      lastName: 'Nguyen',
    };

    const user = await repository.create(data);

    createdUserIds.push(user.id);

    expect(user.id).toBeDefined();
    expect(user.email).toBe(data.email);
    expect(user.role).toBe(UserRole.STUDENT);
    expect(user.status).toBe(AccountStatus.ACTIVE);
    expect(user.firstName).toBe('Van A');
    expect(user.lastName).toBe('Nguyen');
  });

  it('should find a user by id', async () => {
    const created = await repository.create({
      email: 'repo-test-find-id@example.com',
      passwordHash: 'hashed-password',
      role: UserRole.STUDENT,
    });

    createdUserIds.push(created.id);

    const user = await repository.findById(created.id);

    expect(user).not.toBeNull();
    expect(user?.id).toBe(created.id);
    expect(user?.email).toBe(created.email);
  });

  it('should return null when user id does not exist', async () => {
    const user = await repository.findById('non-existent-user-id');

    expect(user).toBeNull();
  });

  it('should find a user by email', async () => {
    const email = 'repo-test-find-email@example.com';

    const created = await repository.create({
      email,
      passwordHash: 'hashed-password',
      role: UserRole.LECTURER,
    });

    createdUserIds.push(created.id);

    const user = await repository.findByEmail(email);

    expect(user).not.toBeNull();
    expect(user?.id).toBe(created.id);
    expect(user?.email).toBe(email);
    expect(user?.role).toBe(UserRole.LECTURER);
  });

  it('should return null when email does not exist', async () => {
    const user = await repository.findByEmail('repo-test-not-found@example.com');

    expect(user).toBeNull();
  });

  it('should update user status to suspended', async () => {
    const created = await repository.create({
      email: 'repo-test-suspend@example.com',
      passwordHash: 'hashed-password',
      role: UserRole.STUDENT,
    });

    createdUserIds.push(created.id);

    const updated = await repository.updateStatus(created.id, AccountStatus.SUSPENDED);

    expect(updated?.status).toBe(AccountStatus.SUSPENDED);

    const persisted = await repository.findById(created.id);

    expect(persisted?.status).toBe(AccountStatus.SUSPENDED);
  });

  it('should reactivate a suspended user', async () => {
    const created = await repository.create({
      email: 'repo-test-reactivate@example.com',
      passwordHash: 'hashed-password',
      role: UserRole.STUDENT,
    });

    createdUserIds.push(created.id);

    await repository.updateStatus(created.id, AccountStatus.SUSPENDED);

    const updated = await repository.updateStatus(created.id, AccountStatus.ACTIVE);

    expect(updated?.status).toBe(AccountStatus.ACTIVE);
  });

  it('should enforce unique email', async () => {
    const email = 'repo-test-duplicate@example.com';

    const first = await repository.create({
      email,
      passwordHash: 'hash-1',
      role: UserRole.STUDENT,
    });

    createdUserIds.push(first.id);

    await expect(
      repository.create({
        email,
        passwordHash: 'hash-2',
        role: UserRole.LECTURER,
      }),
    ).rejects.toThrow();
  });
});
