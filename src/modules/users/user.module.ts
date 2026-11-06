import { Module } from '@nestjs/common';

import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { UserService } from './user.service.js';

@Module({
  imports: [PrismaModule, AuditModule],
  providers: [UserService],
  exports: [UserService],
})
export class UsersModule {}
