import { Module } from '@nestjs/common';

import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { UserService } from './user.service.js';

@Module({
  imports: [PrismaModule],
  providers: [UserService],
  exports: [UserService],
})
export class UsersModule {}
