import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ReportTargetType, WorkspaceType } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { CollaborationService } from '../collaboration/collaboration.service.js';
import { type PageAccess, PagesService } from '../pages/pages.service.js';
import type { CreateMessageDto } from './dto/create-message.dto.js';
import type { CreateReportDto } from './dto/create-report.dto.js';
import type {
  PageMessageResponseDto,
  ReportResponseDto,
} from './dto/responses/discussion-response.dto.js';

const messageInclude = {
  sender: { select: { id: true, firstName: true, lastName: true } },
} as const;

/**
 * Page-level discussion in collaborative workspaces (FR-CW-13) and reports on
 * its messages (FR-AD-02). Membership rules follow the page routes: non-members
 * get 404, archived workspaces are read-only.
 */
@Injectable()
export class DiscussionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pages: PagesService,
    private readonly collaboration: CollaborationService,
  ) {}

  async list(userId: string, pageId: string): Promise<PageMessageResponseDto[]> {
    const access = await this.resolveDiscussion(userId, pageId);

    const messages = await this.prisma.message.findMany({
      where: { pageId: access.page.id },
      include: messageInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return messages.map(toResponse);
  }

  async send(
    userId: string,
    pageId: string,
    dto: CreateMessageDto,
  ): Promise<PageMessageResponseDto> {
    const access = await this.resolveDiscussion(userId, pageId);
    if (access.workspace.archivedAt) {
      throw new ConflictException('Restore the workspace before posting');
    }

    const message = toResponse(
      await this.prisma.message.create({
        data: { pageId: access.page.id, senderId: userId, content: dto.content },
        include: messageInclude,
      }),
    );
    this.collaboration.broadcastMessage(access.page.id, message);
    return message;
  }

  async report(userId: string, dto: CreateReportDto): Promise<ReportResponseDto> {
    const message = await this.prisma.message.findUnique({
      where: { id: dto.targetId },
      select: {
        id: true,
        senderId: true,
        page: {
          select: {
            workspace: {
              select: { memberships: { where: { userId }, select: { id: true } } },
            },
          },
        },
      },
    });
    // Only members who can see the message may report it.
    if (!message || message.page.workspace.memberships.length === 0) {
      throw new NotFoundException('Message not found');
    }
    if (message.senderId === userId) {
      throw new BadRequestException('You cannot report your own message');
    }

    return this.prisma.report.create({
      data: {
        reporterId: userId,
        targetType: ReportTargetType.MESSAGE,
        targetId: message.id,
        reason: dto.reason,
        description: dto.description || null,
      },
      select: { id: true, status: true },
    });
  }

  private async resolveDiscussion(userId: string, pageId: string): Promise<PageAccess> {
    const access = await this.pages.resolve(userId, pageId);
    if (access.workspace.type === WorkspaceType.PERSONAL) {
      throw new ConflictException('The personal workspace has no discussion');
    }
    return access;
  }
}

function toResponse(message: {
  id: string;
  pageId: string;
  content: string;
  createdAt: Date;
  sender: { id: string; firstName: string | null; lastName: string | null };
}): PageMessageResponseDto {
  return {
    id: message.id,
    pageId: message.pageId,
    sender: message.sender,
    content: message.content,
    createdAt: message.createdAt,
  };
}
