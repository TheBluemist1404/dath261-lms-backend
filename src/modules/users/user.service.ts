import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import type { AccountStatus } from '../../generated/prisma/enums.js';
import type { CreateUserData } from './types/create-user.data.js';
// biome-ignore lint/style/useImportType: NestJS DI requires value import
import { UserRepository } from './user.repository.js';

@Injectable()
export class UserService {
  constructor(private readonly userRepository: UserRepository) {}

  async createUser(data: CreateUserData) {
    const existingUser = await this.userRepository.findByEmail(data.email);

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    return this.userRepository.create(data);
  }

  async getUserById(id: string) {
    const user = await this.userRepository.findById(id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async getUserByEmail(email: string) {
    return this.userRepository.findByEmail(email);
  }

  async updateStatus(id: string, status: AccountStatus) {
    const user = await this.userRepository.findById(id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.userRepository.updateStatus(id, status);
  }
}
