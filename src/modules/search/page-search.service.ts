import { Injectable } from '@nestjs/common';
import type { Page, Workspace } from '../../generated/prisma/client.js';
import { escapeLike } from '../../infrastructure/database/prisma/like-pattern.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import type { PageHitResponseDto } from './dto/responses/page-hit-response.dto.js';
import { pageText, snippetAround } from './page-text.js';

export const SEARCH_RESULT_LIMIT = 50;

type PageWithWorkspace = Page & { workspace: Workspace };

/**
 * Page search and recent pages across the caller's active workspaces
 * (FR-PW-06). Archived pages and workspaces, and workspaces the caller left,
 * are excluded.
 */
@Injectable()
export class PageSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(userId: string, query: string): Promise<PageHitResponseDto[]> {
    const pattern = `%${escapeLike(query)}%`;

    // Content matches look only at string `text` fields of the editor JSON, so
    // node types and other keys ("paragraph", "root") never match.
    const matches = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT p.id
      FROM pages p
      JOIN workspaces w ON w.id = p.workspace_id AND w.archived_at IS NULL
      JOIN workspace_memberships m ON m.workspace_id = w.id AND m.user_id = ${userId}
      WHERE p.archived_at IS NULL
        AND (p.title ILIKE ${pattern}
         OR EXISTS (
           SELECT 1 FROM jsonb_path_query(p.content, 'lax $.**.text') AS t(value)
           WHERE jsonb_typeof(t.value) = 'string' AND t.value #>> '{}' ILIKE ${pattern}
         ))
      ORDER BY (p.title ILIKE ${pattern}) DESC, p.updated_at DESC, p.id
      LIMIT ${SEARCH_RESULT_LIMIT}
    `;

    const pages = await this.prisma.page.findMany({
      where: { id: { in: matches.map((match) => match.id) } },
      include: { workspace: true },
    });
    const byId = new Map(pages.map((page) => [page.id, page]));
    const paths = await this.ancestorPaths(pages);
    const needle = query.toLowerCase();

    return matches.flatMap(({ id }) => {
      const page = byId.get(id);
      if (!page) {
        return [];
      }
      const text = pageText(page.content);
      const index = text.toLowerCase().indexOf(needle);
      const snippet = index >= 0 ? snippetAround(text, index, needle.length) : null;
      return [toHit(page, paths.get(page.id) ?? [], snippet)];
    });
  }

  /** "Recent" means recently edited: there is no visit history yet. */
  async recent(userId: string, limit: number): Promise<PageHitResponseDto[]> {
    const pages = await this.prisma.page.findMany({
      where: {
        archivedAt: null,
        workspace: { archivedAt: null, memberships: { some: { userId } } },
      },
      include: { workspace: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: limit,
    });
    const paths = await this.ancestorPaths(pages);

    return pages.map((page) => toHit(page, paths.get(page.id) ?? [], null));
  }

  /** Ancestor titles, root first, for each page. */
  private async ancestorPaths(pages: Page[]): Promise<Map<string, string[]>> {
    const workspaceIds = [...new Set(pages.map((page) => page.workspaceId))];
    const tree = await this.prisma.page.findMany({
      where: { workspaceId: { in: workspaceIds } },
      select: { id: true, title: true, parentPageId: true },
    });
    const byId = new Map(tree.map((node) => [node.id, node]));

    return new Map(
      pages.map((page) => {
        const path: string[] = [];
        const seen = new Set([page.id]);
        let parentId = page.parentPageId;
        while (parentId && !seen.has(parentId)) {
          const parent = byId.get(parentId);
          if (!parent) {
            break;
          }
          seen.add(parentId);
          path.unshift(parent.title);
          parentId = parent.parentPageId;
        }
        return [page.id, path];
      }),
    );
  }
}

function toHit(
  page: PageWithWorkspace,
  path: string[],
  snippet: string | null,
): PageHitResponseDto {
  return {
    page: {
      id: page.id,
      workspaceId: page.workspaceId,
      title: page.title,
      parentPageId: page.parentPageId,
      archivedAt: page.archivedAt,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
    },
    workspace: { id: page.workspace.id, name: page.workspace.name, type: page.workspace.type },
    path,
    snippet,
  };
}
