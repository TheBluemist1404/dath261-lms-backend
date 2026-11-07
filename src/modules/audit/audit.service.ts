import { Injectable } from '@nestjs/common';
import type { AuditEntry, Prisma } from '../../generated/prisma/client.js';
import { AuditAction, AuditEntityType } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';

export interface RecordAuditDto {
  actorId: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(data: RecordAuditDto, tx?: Prisma.TransactionClient): Promise<AuditEntry> {
    const createData = {
      actorId: data.actorId,
      action: data.action,
      entityType: data.entityType,
      entityId: data.entityId,
      ...(data.metadata !== undefined && {
        metadata: data.metadata,
      }),
    };

    if (tx) {
      return tx.auditEntry.create({
        data: createData,
      });
    }

    return this.prisma.auditEntry.create({
      data: createData,
    });
  }
}
