import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type Page, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { CollaborationService } from '../collaboration/collaboration.service.js';
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
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PageSelect;

@Injectable()
export class PagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly collaboration: CollaborationService,
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

  /**
   * Archived pages are read-only, like pages of an archived workspace. Use for
   * every change to a page or what hangs off it (references, messages).
   */
  assertEditable({ workspace, page }: PageAccess): void {
    this.access.assertWritable(workspace);
    if (page.archivedAt) {
      throw new ConflictException('Restore the page before editing it');
    }
  }

  async list(
    userId: string,
    workspaceId: string,
    archived = false,
  ): Promise<PageSummaryResponseDto[]> {
    await this.access.resolve(userId, workspaceId);

    return this.prisma.page.findMany({
      where: { workspaceId, archivedAt: archived ? { not: null } : null },
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
      if (parent?.workspaceId !== workspaceId || parent.archivedAt) {
        throw new BadRequestException('parentPageId must be an active page in this workspace');
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
    const access = await this.resolve(userId, pageId);
    this.assertEditable(access);
    const { page } = access;

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
    await this.collaboration.pagesDeleted(workspace.id);
  }

  /**
   * Archives the page and its active subpages (FR soft-deletion baseline). They
   * leave the page tree, search and live editing, and keep their content.
   */
  async archive(userId: string, pageId: string): Promise<PageResponseDto> {
    const { page, workspace } = await this.resolve(userId, pageId);
    this.access.assertWritable(workspace);
    if (page.archivedAt) {
      throw new ConflictException('The page is already archived');
    }

    const tree = await this.workspaceTree(workspace.id);
    // Subpages archived earlier keep their own date, so they stay archived
    // when this page is restored.
    const ids = subtree(tree, page.id, (node) => node.archivedAt === null);
    const archivedAt = new Date();
    await this.prisma.page.updateMany({ where: { id: { in: ids } }, data: { archivedAt } });
    this.collaboration.pagesChanged(ids);
    return toResponse({ ...page, archivedAt });
  }

  /**
   * Restores the page with the subpages archived together with it. It returns
   * under its parent while that parent is active, otherwise to the root.
   */
  async restore(userId: string, pageId: string): Promise<PageResponseDto> {
    const { page, workspace } = await this.resolve(userId, pageId);
    this.access.assertWritable(workspace);
    const archivedAt = page.archivedAt;
    if (!archivedAt) {
      throw new ConflictException('The page is not archived');
    }

    const tree = await this.workspaceTree(workspace.id);
    const ids = subtree(
      tree,
      page.id,
      (node) => node.archivedAt?.getTime() === archivedAt.getTime(),
    );
    const parent = page.parentPageId ? tree.get(page.parentPageId) : undefined;
    const parentPageId = parent && parent.archivedAt === null ? parent.id : null;

    const [restored] = await this.prisma.$transaction([
      this.prisma.page.update({ where: { id: page.id }, data: { archivedAt: null, parentPageId } }),
      this.prisma.page.updateMany({ where: { id: { in: ids } }, data: { archivedAt: null } }),
    ]);
    this.collaboration.pagesChanged(ids);
    return toResponse(restored);
  }

  private async workspaceTree(workspaceId: string): Promise<Map<string, TreeNode>> {
    const pages = await this.prisma.page.findMany({
      where: { workspaceId },
      select: { id: true, parentPageId: true, archivedAt: true },
    });
    return new Map(pages.map((node) => [node.id, node]));
  }

  private async assertValidParent(page: Page, parentPageId: string): Promise<void> {
    const pages = await this.prisma.page.findMany({
      where: { workspaceId: page.workspaceId },
      select: { id: true, parentPageId: true, archivedAt: true },
    });
    const parentOf = new Map(pages.map((entry) => [entry.id, entry.parentPageId]));

    let ancestor: string | null | undefined = parentPageId;
    const invalid = () =>
      new BadRequestException('parentPageId must be another page outside this subtree');

    if (!parentOf.has(parentPageId) || pages.some((p) => p.id === parentPageId && p.archivedAt)) {
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

interface TreeNode {
  id: string;
  parentPageId: string | null;
  archivedAt: Date | null;
}

/** The page and its descendants that match, stopping at subpages that do not. */
function subtree(
  tree: Map<string, TreeNode>,
  rootId: string,
  include: (node: TreeNode) => boolean,
): string[] {
  const children = new Map<string, string[]>();
  for (const node of tree.values()) {
    if (node.parentPageId) {
      children.set(node.parentPageId, [...(children.get(node.parentPageId) ?? []), node.id]);
    }
  }
  const ids = [rootId];
  for (let index = 0; index < ids.length; index += 1) {
    for (const childId of children.get(ids[index]) ?? []) {
      const child = tree.get(childId);
      if (child && include(child) && !ids.includes(childId)) {
        ids.push(childId);
      }
    }
  }
  return ids;
}

function toResponse(page: Page): PageResponseDto {
  return {
    id: page.id,
    workspaceId: page.workspaceId,
    title: page.title,
    parentPageId: page.parentPageId,
    archivedAt: page.archivedAt,
    content: page.content,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  };
}
