import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Workspace, WorkspaceMembership } from '../../generated/prisma/client.js';
import { WorkspaceMemberRole } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';

export interface WorkspaceAccess {
  workspace: Workspace;
  membership: WorkspaceMembership;
}

/**
 * Membership checks shared by every workspace route. Non-members get 404 rather
 * than 403 so a workspace's existence is not disclosed (Authorization Model).
 */
@Injectable()
export class WorkspaceAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(userId: string, workspaceId: string): Promise<WorkspaceAccess> {
    const membership = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      include: { workspace: true },
    });

    if (!membership) {
      throw new NotFoundException('Workspace not found');
    }

    const { workspace, ...rest } = membership;
    return { workspace, membership: rest };
  }

  /** Archived workspaces are read-only until an Owner restores them. */
  assertWritable(workspace: Workspace): void {
    if (workspace.archivedAt) {
      throw new ConflictException('Restore the workspace before editing it');
    }
  }

  assertOwner(access: WorkspaceAccess, action: string): void {
    if (access.membership.role !== WorkspaceMemberRole.OWNER) {
      throw new ForbiddenException(`Only an Owner can ${action} this workspace`);
    }
  }
}
