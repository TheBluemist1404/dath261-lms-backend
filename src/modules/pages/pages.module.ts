import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { PagesController } from './pages.controller.js';
import { PagesService } from './pages.service.js';

@Module({
  imports: [PrismaModule, WorkspacesModule],
  controllers: [PagesController],
  providers: [PagesService],
  exports: [PagesService],
})
export class PagesModule {}
