import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { UserRole, WorkspaceMemberRole, WorkspaceType } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import type { AddMemberDto } from './dto/add-member.dto.js';
import type { WorkspaceMemberResponseDto } from './dto/responses/workspace-member-response.dto.js';
import { WorkspaceAccessService } from './workspace-access.service.js';

const memberInclude = {
  user: { select: { id: true, email: true, firstName: true, lastName: true } },
} as const;

/**
 * Members are added directly by email (UC-09); there are no invitations in the
 * data model. Owners manage Co-owners and Members, Co-owners manage Members,
 * and the Owner membership never changes here.
 */
@Injectable()
export class WorkspaceMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
  ) {}

  async list(userId: string, workspaceId: string): Promise<WorkspaceMemberResponseDto[]> {
    await this.access.resolve(userId, workspaceId);

    const memberships = await this.prisma.workspaceMembership.findMany({
      where: { workspaceId },
      include: memberInclude,
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    });
    return memberships.map(toResponse);
  }

  async add(
    userId: string,
    workspaceId: string,
    dto: AddMemberDto,
  ): Promise<WorkspaceMemberResponseDto> {
    const access = await this.access.resolve(userId, workspaceId);

    if (access.workspace.type === WorkspaceType.PERSONAL) {
      throw new ConflictException('The personal workspace has no collaborators');
    }
    this.access.assertWritable(access.workspace);

    const callerRole = access.membership.role;
    if (
      callerRole !== WorkspaceMemberRole.OWNER &&
      !(callerRole === WorkspaceMemberRole.CO_OWNER && dto.role === WorkspaceMemberRole.MEMBER)
    ) {
      throw new ForbiddenException('You cannot add members with this role');
    }

    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      throw new NotFoundException('No user with this email');
    }
    if (user.role === UserRole.ADMIN) {
      throw new BadRequestException('Administrators cannot be added to workspaces');
    }

    try {
      const membership = await this.prisma.workspaceMembership.create({
        data: { workspaceId, userId: user.id, role: dto.role },
        include: memberInclude,
      });
      return toResponse(membership);
    } catch (error) {
      // The (workspace, user) unique index also covers two concurrent adds.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This user is already a member');
      }
      throw error;
    }
  }

  async remove(userId: string, workspaceId: string, targetUserId: string): Promise<void> {
    const access = await this.access.resolve(userId, workspaceId);
    this.access.assertWritable(access.workspace);

    const target = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
    if (!target) {
      throw new NotFoundException('Member not found');
    }
    if (target.role === WorkspaceMemberRole.OWNER) {
      throw new ForbiddenException('Owner membership cannot be changed');
    }

    const callerRole = access.membership.role;
    if (
      callerRole !== WorkspaceMemberRole.OWNER &&
      !(callerRole === WorkspaceMemberRole.CO_OWNER && target.role === WorkspaceMemberRole.MEMBER)
    ) {
      throw new ForbiddenException('You cannot remove this member');
    }

    await this.prisma.workspaceMembership.delete({ where: { id: target.id } });
  }
}

function toResponse(membership: {
  userId: string;
  role: WorkspaceMemberRole;
  joinedAt: Date;
  user: WorkspaceMemberResponseDto['user'];
}): WorkspaceMemberResponseDto {
  return {
    userId: membership.userId,
    role: membership.role,
    joinedAt: membership.joinedAt,
    user: membership.user,
  };
}
