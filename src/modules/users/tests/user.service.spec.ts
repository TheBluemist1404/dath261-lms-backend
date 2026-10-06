import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountStatus, UserRole } from '../../../generated/prisma/enums.js';
import { UserRepository } from '../user.repository.js';
import { UserService } from '../user.service.js';

describe('UserService', () => {
  let service: UserService;
  let repository: UserRepository;

  const mockUserRepository = {
    create: vi.fn(),
    findById: vi.fn(),
    findByEmail: vi.fn(),
    updateStatus: vi.fn(),
  };

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: UserRepository,
          useValue: mockUserRepository,
        },
      ],
    }).compile();

    service = moduleRef.get<UserService>(UserService);
    repository = moduleRef.get<UserRepository>(UserRepository);

    vi.clearAllMocks();
  });

  const mockData = {
    email: 'service-test-create@example.com',
    passwordHash: 'hashed-password',
    role: UserRole.STUDENT,
    firstName: 'Van A',
    lastName: 'Nguyen',
  };

  const mockUser = {
    id: 'test-id',
    ...mockData,
    status: AccountStatus.ACTIVE,
  };

  describe('createUser', () => {
    it('should create a user successfully when email is unique', async () => {
      mockUserRepository.findByEmail.mockResolvedValue(null);

      mockUserRepository.create.mockResolvedValue(mockUser);

      const result = await service.createUser(mockData);

      expect(result).toEqual(mockUser);
      expect(mockUserRepository.findByEmail).toHaveBeenCalledWith(mockData.email);
      expect(mockUserRepository.create).toHaveBeenCalledWith(mockData);
      expect(mockUserRepository.create).toHaveBeenCalledTimes(1);
    });

    it('should throw ConflictException if email already exists', async () => {
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);

      await expect(service.createUser(mockData)).rejects.toThrow(ConflictException);

      expect(mockUserRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('getUserById', () => {
    const testId = 'user-123';

    it('should return the user if found', async () => {
      mockUserRepository.findById.mockResolvedValue(mockUser);

      const result = await service.getUserById(testId);

      expect(result).toEqual(mockUser);
      expect(mockUserRepository.findById).toHaveBeenCalledWith(testId);
    });

    it('should throw NotFoundException if user is not found', async () => {
      mockUserRepository.findById.mockResolvedValue(null);

      await expect(service.getUserById(testId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getUserByEmail', () => {
    const testEmail = 'service-test-create@example.com';

    it('should return the user by email', async () => {
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);

      const result = await service.getUserByEmail(testEmail);

      expect(result).toEqual(mockUser);
      expect(mockUserRepository.findByEmail).toHaveBeenCalledWith(testEmail);
    });

    it('should return null if email is not found', async () => {
      mockUserRepository.findByEmail.mockResolvedValue(null);

      const result = await service.getUserByEmail('not-found@example.com');

      expect(result).toBeNull();
    });
  });

  describe('updateStatus', () => {
    const testId = 'user-123';
    const newStatus = AccountStatus.SUSPENDED;

    it('should update and return the user status if user exists', async () => {
      const updatedUser = { ...mockUser, status: newStatus };

      mockUserRepository.findById.mockResolvedValue(mockUser);

      mockUserRepository.updateStatus.mockResolvedValue(updatedUser);

      const result = await service.updateStatus(testId, newStatus);

      expect(result).toEqual(updatedUser);
      expect(mockUserRepository.findById).toHaveBeenCalledWith(testId);
      expect(mockUserRepository.updateStatus).toHaveBeenCalledWith(testId, newStatus);
    });

    it('should throw NotFoundException if user does not exist', async () => {
      mockUserRepository.findById.mockResolvedValue(null);

      await expect(service.updateStatus(testId, newStatus)).rejects.toThrow(NotFoundException);

      expect(mockUserRepository.updateStatus).not.toHaveBeenCalled();
    });
  });
});
