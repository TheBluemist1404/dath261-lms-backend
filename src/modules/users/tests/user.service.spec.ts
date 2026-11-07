import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AccountStatus,
  AuditAction,
  AuditEntityType,
  UserRole,
} from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { AuditService } from '../../audit/audit.service.js';
import { UserService } from '../user.service.js';

describe('UserService', () => {
  let service: UserService;

  const mockAuditService = {
    record: vi.fn(),
  };

  const mockPrisma = {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: AuditService,
          useValue: mockAuditService,
        },
      ],
    }).compile();

    service = moduleRef.get(UserService);

    vi.clearAllMocks();

    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mockPrisma) => Promise<unknown>) => callback(mockPrisma),
    );
  });

  const mockData = {
    email: 'service-test@example.com',
    passwordHash: 'hashed-password',
    role: UserRole.STUDENT,
    firstName: 'Van A',
    lastName: 'Nguyen',
  };

  const mockUser = {
    id: 'test-id',
    email: mockData.email,
    role: UserRole.STUDENT,
    firstName: 'Van A',
    lastName: 'Nguyen',
    status: AccountStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  describe('createUser', () => {
    it('should create a user when email is unique', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue(mockUser);

      const result = await service.createUser(mockData);

      expect(result).toEqual(mockUser);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: {
          email: mockData.email,
        },
        omit: {
          passwordHash: true,
        },
      });

      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: {
          email: mockData.email,
          passwordHash: mockData.passwordHash,
          role: mockData.role,
          firstName: mockData.firstName,
          lastName: mockData.lastName,
        },
        omit: {
          passwordHash: true,
        },
      });
    });

    it('should throw ConflictException if email already exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(service.createUser(mockData)).rejects.toThrow(ConflictException);

      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('getUserById', () => {
    const id = 'user-123';

    it('should return the user when found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getUserById(id);

      expect(result).toEqual(mockUser);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id },
        omit: {
          passwordHash: true,
        },
      });
    });

    it('should throw NotFoundException when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getUserById(id)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getUserByEmail', () => {
    const email = 'service-test@example.com';

    it('should return the user when found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getUserByEmail(email);

      expect(result).toEqual(mockUser);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email },
        omit: {
          passwordHash: true,
        },
      });
    });

    it('should throw NotFoundException when email does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getUserByEmail(email)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateStatus', () => {
    const id = 'user-123';

    it('should update status when user exists', async () => {
      const updatedUser = {
        ...mockUser,
        status: AccountStatus.SUSPENDED,
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.user.update.mockResolvedValue(updatedUser);

      const result = await service.updateStatus(id, AccountStatus.SUSPENDED, 'admin-1');

      expect(result).toEqual(updatedUser);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id },
        omit: {
          passwordHash: true,
        },
      });

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id },
        data: {
          status: AccountStatus.SUSPENDED,
        },
        omit: {
          passwordHash: true,
        },
      });

      expect(mockAuditService.record).toHaveBeenCalledWith(
        {
          actorId: 'admin-1',
          action: AuditAction.ACCOUNT_STATUS_CHANGED,
          entityType: AuditEntityType.USER,
          entityId: id,
          metadata: {
            from: AccountStatus.ACTIVE,
            to: AccountStatus.SUSPENDED,
          },
        },
        mockPrisma,
      );
    });

    it('should throw NotFoundException when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.updateStatus(id, AccountStatus.SUSPENDED, 'admin-1')).rejects.toThrow(
        NotFoundException,
      );

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });
});
