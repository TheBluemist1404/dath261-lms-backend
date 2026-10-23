import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { WorkspaceAccessService } from './workspace-access.service.js';
import { WorkspaceMembersController } from './workspace-members.controller.js';
import { WorkspaceMembersService } from './workspace-members.service.js';
import { WorkspacesController } from './workspaces.controller.js';
import { WorkspacesService } from './workspaces.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [WorkspacesController, WorkspaceMembersController],
  providers: [WorkspacesService, WorkspaceAccessService, WorkspaceMembersService],
  exports: [WorkspaceAccessService],
})
export class WorkspacesModule {}
