import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { DeadlineController } from './deadline.controller.js';
import { DeadlineService } from './deadline.service.js';
import { NotificationController } from './notification.controller.js';
import { NotificationService } from './notification.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [NotificationController, DeadlineController],
  providers: [NotificationService, DeadlineService],
  exports: [NotificationService, DeadlineService],
})
export class NotificationModule {}
