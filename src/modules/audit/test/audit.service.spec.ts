import { Test, type TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditEntry, Prisma } from '../../../generated/prisma/client.js';
import { AuditAction, AuditEntityType } from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { AuditService } from '../audit.service.js';

describe('AuditService', () => {
  let service: AuditService;

  const mockPrisma = {
    auditEntry: {
      create: vi.fn(),
    },
  };

  const mockTx = {
    auditEntry: {
      create: vi.fn(),
    },
  };

  const actorId = 'actor-1';
  const entityId = 'course-1';

  const auditData = {
    actorId,
    action: AuditAction.COURSE_CREATED,
    entityType: AuditEntityType.COURSE,
    entityId,
    metadata: {
      source: 'course-service',
    },
  } satisfies {
    actorId: string;
    action: AuditAction;
    entityType: AuditEntityType;
    entityId: string;
    metadata: Prisma.InputJsonValue;
  };

  const auditEntry = {
    id: 'audit-1',
    ...auditData,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = moduleRef.get(AuditService);
  });

  it('records an audit entry using the supplied transaction client', async () => {
    mockTx.auditEntry.create.mockResolvedValue(auditEntry);

    const result = await service.record(auditData, mockTx as unknown as Prisma.TransactionClient);

    expect(result).toEqual(auditEntry);

    expect(mockTx.auditEntry.create).toHaveBeenCalledWith({
      data: auditData,
    });

    expect(mockPrisma.auditEntry.create).not.toHaveBeenCalled();
  });

  it('records an audit entry using PrismaService when no transaction is supplied', async () => {
    mockPrisma.auditEntry.create.mockResolvedValue(auditEntry);

    const result = await service.record(auditData);

    expect(result).toEqual(auditEntry);

    expect(mockPrisma.auditEntry.create).toHaveBeenCalledWith({
      data: auditData,
    });

    expect(mockTx.auditEntry.create).not.toHaveBeenCalled();
  });

  it('omits metadata when it is not provided', async () => {
    mockPrisma.auditEntry.create.mockResolvedValue({
      ...auditEntry,
      metadata: null,
    });

    const { metadata: _metadata, ...dataWithoutMetadata } = auditData;

    await service.record(dataWithoutMetadata);

    expect(mockPrisma.auditEntry.create).toHaveBeenCalledWith({
      data: {
        actorId,
        action: AuditAction.COURSE_CREATED,
        entityType: AuditEntityType.COURSE,
        entityId,
      },
    });
  });
});
