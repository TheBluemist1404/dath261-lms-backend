import { ConflictException, Injectable } from '@nestjs/common';
import type { Workspace, WorkspaceMembership } from '../../generated/prisma/client.js';
import { WorkspaceMemberRole, WorkspaceType } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { CollaborationService } from '../collaboration/collaboration.service.js';
import type { WorkspaceResponseDto } from './dto/responses/workspace-response.dto.js';
import { type WorkspaceAccess, WorkspaceAccessService } from './workspace-access.service.js';

export const PERSONAL_WORKSPACE_NAME = 'My personal workspace';

const withCounts = { _count: { select: { pages: true, memberships: true } } } as const;

type WorkspaceWithCounts = Workspace & { _count: { pages: number; memberships: number } };

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly collaboration: CollaborationService,
  ) {}

  async list(userId: string, archived: boolean): Promise<WorkspaceResponseDto[]> {
    await this.ensurePersonalWorkspace(userId);

    const memberships = await this.prisma.workspaceMembership.findMany({
      where: { userId, workspace: { archivedAt: archived ? { not: null } : null } },
      include: { workspace: { include: withCounts } },
      orderBy: [{ workspace: { type: 'asc' } }, { workspace: { createdAt: 'asc' } }],
    });

    return memberships.map(({ workspace, ...membership }) => toResponse(workspace, membership));
  }

  async create(userId: string, name: string): Promise<WorkspaceResponseDto> {
    const workspace = await this.prisma.workspace.create({
      data: {
        name,
        type: WorkspaceType.COLLABORATIVE,
        createdById: userId,
        memberships: { create: { userId, role: WorkspaceMemberRole.OWNER } },
      },
      include: { ...withCounts, memberships: true },
    });

    return toResponse(workspace, workspace.memberships[0]);
  }

  async get(userId: string, workspaceId: string): Promise<WorkspaceResponseDto> {
    return this.present(await this.access.resolve(userId, workspaceId));
  }

  async rename(userId: string, workspaceId: string, name: string): Promise<WorkspaceResponseDto> {
    const access = await this.access.resolve(userId, workspaceId);
    this.access.assertOwner(access, 'rename');
    this.access.assertWritable(access.workspace);

    await this.prisma.workspace.update({ where: { id: workspaceId }, data: { name } });
    return this.get(userId, workspaceId);
  }

  async archive(userId: string, workspaceId: string): Promise<WorkspaceResponseDto> {
    const access = await this.access.resolve(userId, workspaceId);

    if (access.workspace.type === WorkspaceType.PERSONAL) {
      throw new ConflictException('The personal workspace cannot be archived');
    }
    this.access.assertOwner(access, 'archive');
    if (access.workspace.archivedAt) {
      throw new ConflictException('Workspace is already archived');
    }

    await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { archivedAt: new Date() },
    });
    this.collaboration.workspaceStateChanged(workspaceId);
    return this.get(userId, workspaceId);
  }

  async restore(userId: string, workspaceId: string): Promise<WorkspaceResponseDto> {
    const access = await this.access.resolve(userId, workspaceId);
    this.access.assertOwner(access, 'restore');
    if (!access.workspace.archivedAt) {
      throw new ConflictException('Workspace is not archived');
    }

    await this.prisma.workspace.update({ where: { id: workspaceId }, data: { archivedAt: null } });
    this.collaboration.workspaceStateChanged(workspaceId);
    return this.get(userId, workspaceId);
  }

  /**
   * Creates the caller's personal workspace on first use and records it as
   * their default. The user row is locked so concurrent first requests cannot
   * create two.
   */
  async ensurePersonalWorkspace(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const [user] = await tx.$queryRaw<{ default_workspace_id: string | null }[]>`
        SELECT default_workspace_id FROM users WHERE id = ${userId} FOR UPDATE
      `;

      if (!user || user.default_workspace_id) {
        return;
      }

      const workspace = await tx.workspace.create({
        data: {
          name: PERSONAL_WORKSPACE_NAME,
          type: WorkspaceType.PERSONAL,
          createdById: userId,
          memberships: { create: { userId, role: WorkspaceMemberRole.OWNER } },
        },
      });

      await tx.user.update({ where: { id: userId }, data: { defaultWorkspaceId: workspace.id } });
    });
  }

  private async present({ workspace, membership }: WorkspaceAccess) {
    const counts = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspace.id },
      include: withCounts,
    });
    return toResponse(counts, membership);
  }
}

function toResponse(
  workspace: WorkspaceWithCounts,
  membership: WorkspaceMembership,
): WorkspaceResponseDto {
  return {
    id: workspace.id,
    name: workspace.name,
    type: workspace.type,
    currentUserRole: membership.role,
    pageCount: workspace._count.pages,
    memberCount: workspace._count.memberships,
    archivedAt: workspace.archivedAt,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}
