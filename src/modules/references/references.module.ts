import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { PagesModule } from '../pages/pages.module.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { CourseBlockAccessService } from './course-block-access.service.js';
import { ReferencesController } from './references.controller.js';
import { ReferencesService } from './references.service.js';

@Module({
  imports: [PrismaModule, WorkspacesModule, PagesModule],
  controllers: [ReferencesController],
  providers: [ReferencesService, CourseBlockAccessService],
})
export class ReferencesModule {}
