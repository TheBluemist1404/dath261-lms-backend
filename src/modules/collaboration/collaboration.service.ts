import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { Database } from '@hocuspocus/extension-database';
import { type Connection, Hocuspocus, type onAuthenticatePayload } from '@hocuspocus/server';
import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import { AccountStatus, WorkspaceType } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import type { AccessTokenPayload } from '../auth/types/access-token-payload.type.js';
import { documentText, seedDocumentState } from './page-document.js';

/** WebSocket path of the shared-document server; the document name is the page id. */
export const COLLABORATION_PATH = '/api/collab';

/**
 * Reasons sent to the client when a document is refused or closed. The frontend
 * maps `token-invalid` to a token refresh and the others to "access ended".
 */
export const CloseReason = {
  tokenInvalid: 'token-invalid',
  notFound: 'not-found',
  notCollaborative: 'not-collaborative',
  accessRevoked: 'access-revoked',
  workspaceChanged: 'workspace-changed',
  pageDeleted: 'page-deleted',
} as const;

export interface CollaborationContext {
  userId: string;
  workspaceId: string;
}

class RefusedError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/**
 * Yjs sync server for pages in collaborative workspaces (Hocuspocus over `ws`),
 * attached to the API's own HTTP server. Clients authenticate with the same
 * access token as the REST API; workspace membership is checked per page, and
 * archived workspaces are served read-only.
 */
@Injectable()
export class CollaborationService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(CollaborationService.name);
  private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
  private httpServer?: Server;
  readonly hocuspocus: Hocuspocus<CollaborationContext>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly adapterHost: HttpAdapterHost,
  ) {
    this.hocuspocus = new Hocuspocus<CollaborationContext>({
      quiet: true,
      debounce: 2000,
      maxDebounce: 10_000,
      onAuthenticate: (data) => this.authenticate(data),
      extensions: [
        new Database({
          fetch: ({ documentName }) => this.fetchState(documentName),
          store: ({ documentName, state, document }) =>
            this.storeState(documentName, state, document),
        }),
      ],
    });
  }

  onApplicationBootstrap(): void {
    this.httpServer = this.adapterHost.httpAdapter.getHttpServer() as Server;
    this.httpServer.on('upgrade', this.handleUpgrade);
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.httpServer?.off('upgrade', this.handleUpgrade);
    this.hocuspocus.flushPendingStores();
    this.hocuspocus.closeConnections();
    for (const socket of this.sockets.clients) socket.terminate();
    await new Promise<void>((resolve) => this.sockets.close(() => resolve()));
  }

  /** Ends a removed member's open sessions on every page of the workspace. */
  revokeMember(workspaceId: string, userId: string): void {
    this.closeWhere(
      (context) => context.workspaceId === workspaceId && context.userId === userId,
      CloseReason.accessRevoked,
    );
  }

  /** Reconnects everyone so archived workspaces are served read-only (or writable again). */
  workspaceStateChanged(workspaceId: string): void {
    this.closeWhere((context) => context.workspaceId === workspaceId, CloseReason.workspaceChanged);
  }

  /** Closes sessions on pages that no longer exist after a (subtree) delete. */
  async pagesDeleted(workspaceId: string): Promise<void> {
    const open = [...this.hocuspocus.documents.keys()];
    if (open.length === 0) return;
    const remaining = new Set(
      (
        await this.prisma.page.findMany({
          where: { id: { in: open }, workspaceId },
          select: { id: true },
        })
      ).map((page) => page.id),
    );
    for (const name of open) {
      if (remaining.has(name)) continue;
      const document = this.hocuspocus.documents.get(name);
      for (const connection of connectionsOf(document)) {
        if (connection.context.workspaceId === workspaceId) {
          connection.close({ code: 4404, reason: CloseReason.pageDeleted });
        }
      }
    }
  }

  private readonly handleUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== COLLABORATION_PATH) return;

    this.sockets.handleUpgrade(request, socket, head, (websocket) => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (typeof value === 'string') headers.set(key, value);
      }
      const client = this.hocuspocus.handleConnection(websocket, new Request(url, { headers }));
      websocket.on('message', (data: Buffer) => client.handleMessage(new Uint8Array(data)));
      websocket.on('pong', () => client.touch());
      websocket.on('close', (code, reason) =>
        client.handleClose({ code, reason: reason.toString() }),
      );
      websocket.on('error', (error) => this.logger.warn(`Collaboration socket error: ${error}`));
    });
  };

  private async authenticate({
    token,
    documentName,
    connectionConfig,
  }: onAuthenticatePayload<CollaborationContext>): Promise<CollaborationContext> {
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, { algorithms: ['HS256'] });
    } catch {
      throw new RefusedError(CloseReason.tokenInvalid);
    }
    if (typeof payload?.sub !== 'string') {
      throw new RefusedError(CloseReason.tokenInvalid);
    }

    const [user, page] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: payload.sub }, select: { status: true } }),
      this.prisma.page.findUnique({
        where: { id: documentName },
        select: {
          workspaceId: true,
          workspace: {
            select: {
              type: true,
              archivedAt: true,
              memberships: { where: { userId: payload.sub }, select: { id: true } },
            },
          },
        },
      }),
    ]);
    if (!user || user.status === AccountStatus.SUSPENDED) {
      throw new RefusedError(CloseReason.tokenInvalid);
    }
    // Non-members learn nothing about the page, as with the REST routes.
    if (!page || page.workspace.memberships.length === 0) {
      throw new RefusedError(CloseReason.notFound);
    }
    if (page.workspace.type !== WorkspaceType.COLLABORATIVE) {
      throw new RefusedError(CloseReason.notCollaborative);
    }

    connectionConfig.readOnly = page.workspace.archivedAt !== null;
    return { userId: payload.sub, workspaceId: page.workspaceId };
  }

  private async fetchState(pageId: string): Promise<Uint8Array | null> {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { content: true, yjsState: true },
    });
    if (!page) return null;
    if (page.yjsState) return new Uint8Array(page.yjsState);

    // First open: build the shared state from the stored content and keep it,
    // so every client starts from the same history instead of seeding its own.
    const state = seedDocumentState(page.content);
    await this.prisma.page.updateMany({
      where: { id: pageId, yjsState: null },
      data: { yjsState: new Uint8Array(state) },
    });
    return state;
  }

  private async storeState(pageId: string, state: Buffer, document: Y.Doc): Promise<void> {
    // updateMany: the page may have been deleted while the store was debounced.
    await this.prisma.page.updateMany({
      where: { id: pageId },
      data: {
        yjsState: new Uint8Array(state),
        content: { type: 'plain-text', text: documentText(document) },
        updatedAt: new Date(),
      },
    });
  }

  private closeWhere(match: (context: CollaborationContext) => boolean, reason: string): void {
    for (const document of this.hocuspocus.documents.values()) {
      for (const connection of connectionsOf(document)) {
        if (match(connection.context)) {
          connection.close({ code: 4403, reason });
        }
      }
    }
  }
}

function connectionsOf(
  document: { getConnections(): Connection<CollaborationContext>[] } | undefined,
): Connection<CollaborationContext>[] {
  return document?.getConnections() ?? [];
}
