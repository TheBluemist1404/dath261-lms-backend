import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { type Page, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import {
  type WorkspaceAccess,
  WorkspaceAccessService,
} from '../workspaces/workspace-access.service.js';
import type { CreatePageDto } from './dto/create-page.dto.js';
import type { PageResponseDto, PageSummaryResponseDto } from './dto/responses/page-response.dto.js';
import type { UpdatePageDto } from './dto/update-page.dto.js';

export interface PageAccess extends WorkspaceAccess {
  page: Page;
}

const summaryFields = {
  id: true,
  workspaceId: true,
  title: true,
  parentPageId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PageSelect;

@Injectable()
export class PagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
  ) {}

  /** Resolves a page for a member of its workspace; anyone else gets 404. */
  async resolve(userId: string, pageId: string): Promise<PageAccess> {
    const page = await this.prisma.page.findUnique({ where: { id: pageId } });

    if (!page) {
      throw new NotFoundException('Page not found');
    }

    try {
      return { ...(await this.access.resolve(userId, page.workspaceId)), page };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new NotFoundException('Page not found');
      }
      throw error;
    }
  }

  async list(userId: string, workspaceId: string): Promise<PageSummaryResponseDto[]> {
    await this.access.resolve(userId, workspaceId);

    return this.prisma.page.findMany({
      where: { workspaceId },
      select: summaryFields,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async create(userId: string, workspaceId: string, dto: CreatePageDto): Promise<PageResponseDto> {
    const { workspace } = await this.access.resolve(userId, workspaceId);
    this.access.assertWritable(workspace);

    const parentPageId = dto.parentPageId ?? null;
    if (parentPageId) {
      const parent = await this.prisma.page.findUnique({ where: { id: parentPageId } });
      if (parent?.workspaceId !== workspaceId) {
        throw new BadRequestException('parentPageId must be a page in this workspace');
      }
    }

    return toResponse(
      await this.prisma.page.create({ data: { workspaceId, title: dto.title, parentPageId } }),
    );
  }

  async get(userId: string, pageId: string): Promise<PageResponseDto> {
    return toResponse((await this.resolve(userId, pageId)).page);
  }

  async update(userId: string, pageId: string, dto: UpdatePageDto): Promise<PageResponseDto> {
    const { page, workspace } = await this.resolve(userId, pageId);
    this.access.assertWritable(workspace);

    if (dto.parentPageId) {
      await this.assertValidParent(page, dto.parentPageId);
    }

    const updated = await this.prisma.page.update({
      where: { id: pageId },
      data: {
        title: dto.title,
        parentPageId: dto.parentPageId,
        content: dto.content === null ? Prisma.DbNull : (dto.content as Prisma.InputJsonObject),
        updatedAt: new Date(),
      },
    });
    return toResponse(updated);
  }

  /** Deletes the page; its subpages, references and messages cascade with it. */
  async remove(userId: string, pageId: string): Promise<void> {
    const { workspace } = await this.resolve(userId, pageId);
    this.access.assertWritable(workspace);

    await this.prisma.page.delete({ where: { id: pageId } });
  }

  private async assertValidParent(page: Page, parentPageId: string): Promise<void> {
    const pages = await this.prisma.page.findMany({
      where: { workspaceId: page.workspaceId },
      select: { id: true, parentPageId: true },
    });
    const parentOf = new Map(pages.map((entry) => [entry.id, entry.parentPageId]));

    let ancestor: string | null | undefined = parentPageId;
    const invalid = () =>
      new BadRequestException('parentPageId must be another page outside this subtree');

    if (!parentOf.has(parentPageId)) {
      throw invalid();
    }
    while (ancestor) {
      if (ancestor === page.id) {
        throw invalid();
      }
      ancestor = parentOf.get(ancestor);
    }
  }
}

function toResponse(page: Page): PageResponseDto {
  return {
    id: page.id,
    workspaceId: page.workspaceId,
    title: page.title,
    parentPageId: page.parentPageId,
    content: page.content,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  };
}
