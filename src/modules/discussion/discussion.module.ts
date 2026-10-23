import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { PagesModule } from '../pages/pages.module.js';
import { DiscussionController } from './discussion.controller.js';
import { DiscussionService } from './discussion.service.js';

@Module({
  imports: [PrismaModule, PagesModule],
  controllers: [DiscussionController],
  providers: [DiscussionService],
})
export class DiscussionModule {}
