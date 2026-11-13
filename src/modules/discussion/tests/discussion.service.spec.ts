import { BadRequestException, NotFoundException } from '@nestjs/common';
import { vi } from 'vitest';
import { CourseStatus, ReportTargetType } from '../../../generated/prisma/enums.js';
import { DiscussionService } from '../discussion.service.js';
import type { CreateReportDto } from '../dto/create-report.dto.js';

describe('DiscussionService - additional report targets', () => {
  const prisma = {
    message: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    course: {
      findUnique: vi.fn(),
    },
    report: {
      create: vi.fn(),
    },
  };

  const pages = {
    resolve: vi.fn(),
  };

  const collaboration = {
    broadcastMessage: vi.fn(),
  };

  let service: DiscussionService;

  const reporterId = 'reporter-1';

  const buildDto = (targetType: ReportTargetType, targetId: string): CreateReportDto =>
    ({
      targetType,
      targetId,
      reason: 'Harassment',
      description: 'Additional details',
    }) as CreateReportDto;

  beforeEach(() => {
    vi.resetAllMocks();

    service = new DiscussionService(prisma as never, pages as never, collaboration as never);

    prisma.report.create.mockResolvedValue({
      id: 'report-1',
      status: 'PENDING',
    });
  });

  it('should still require workspace membership when reporting a MESSAGE', async () => {
    prisma.message.findUnique.mockResolvedValue({
      id: 'message-1',
      senderId: 'another-user',
      page: {
        workspace: {
          memberships: [{ id: 'membership-1' }],
        },
      },
    });

    const result = await service.report(
      reporterId,
      buildDto(ReportTargetType.MESSAGE, 'message-1'),
    );

    expect(prisma.report.create).toHaveBeenCalledWith({
      data: {
        reporterId,
        targetType: ReportTargetType.MESSAGE,
        targetId: 'message-1',
        reason: 'Harassment',
        description: 'Additional details',
      },
      select: {
        id: true,
        status: true,
      },
    });

    expect(result).toEqual({
      id: 'report-1',
      status: 'PENDING',
    });
  });

  it('should allow reporting an existing USER', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'target-user',
    });

    const result = await service.report(reporterId, buildDto(ReportTargetType.USER, 'target-user'));

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'target-user' },
      select: { id: true },
    });

    expect(prisma.report.create).toHaveBeenCalledWith({
      data: {
        reporterId,
        targetType: ReportTargetType.USER,
        targetId: 'target-user',
        reason: 'Harassment',
        description: 'Additional details',
      },
      select: {
        id: true,
        status: true,
      },
    });

    expect(result.id).toBe('report-1');
  });

  it.each([
    {
      scenario: 'a missing user',
      targetId: 'missing-user',
      target: null,
      expectedError: NotFoundException,
    },
    {
      scenario: 'the reporter themselves',
      targetId: reporterId,
      target: { id: reporterId },
      expectedError: BadRequestException,
    },
  ])('should reject reporting $scenario', async ({ targetId, target, expectedError }) => {
    prisma.user.findUnique.mockResolvedValue(target);

    await expect(
      service.report(reporterId, buildDto(ReportTargetType.USER, targetId)),
    ).rejects.toThrow(expectedError);

    expect(prisma.report.create).not.toHaveBeenCalled();
  });

  it('should allow reporting an existing COURSE owned by another lecturer', async () => {
    prisma.course.findUnique.mockResolvedValue({
      id: 'course-1',
      lecturerId: 'another-lecturer',
      status: CourseStatus.PUBLISHED,
      isSuspended: false,
    });

    const result = await service.report(reporterId, buildDto(ReportTargetType.COURSE, 'course-1'));

    expect(prisma.course.findUnique).toHaveBeenCalledWith({
      where: { id: 'course-1' },
      select: {
        id: true,
        lecturerId: true,
        status: true,
        isSuspended: true,
      },
    });

    expect(prisma.report.create).toHaveBeenCalledWith({
      data: {
        reporterId,
        targetType: ReportTargetType.COURSE,
        targetId: 'course-1',
        reason: 'Harassment',
        description: 'Additional details',
      },
      select: {
        id: true,
        status: true,
      },
    });

    expect(result.id).toBe('report-1');
  });

  it.each([
    {
      scenario: 'a missing course',
      targetId: 'missing-course',
      target: null,
      expectedError: NotFoundException,
    },
    {
      scenario: 'a course owned by the reporter',
      targetId: 'owned-course',
      target: {
        id: 'owned-course',
        lecturerId: reporterId,
        status: CourseStatus.PUBLISHED,
        isSuspended: false,
      },
      expectedError: BadRequestException,
    },
  ])('should reject reporting $scenario', async ({ targetId, target, expectedError }) => {
    prisma.course.findUnique.mockResolvedValue(target);

    await expect(
      service.report(reporterId, buildDto(ReportTargetType.COURSE, targetId)),
    ).rejects.toThrow(expectedError);

    expect(prisma.report.create).not.toHaveBeenCalled();
  });

  describe('COURSE report visibility', () => {
    const buildCourse = (status: CourseStatus, isSuspended: boolean) => ({
      id: 'course-1',
      lecturerId: 'another-lecturer',
      status,
      isSuspended,
    });

    it('should reject reporting a DRAFT course with 404', async () => {
      prisma.course.findUnique.mockResolvedValue(buildCourse(CourseStatus.DRAFT, false));

      await expect(
        service.report(reporterId, buildDto(ReportTargetType.COURSE, 'course-1')),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.report.create).not.toHaveBeenCalled();
    });

    it('should reject reporting a suspended PUBLISHED course with 404', async () => {
      prisma.course.findUnique.mockResolvedValue(buildCourse(CourseStatus.PUBLISHED, true));

      await expect(
        service.report(reporterId, buildDto(ReportTargetType.COURSE, 'course-1')),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.report.create).not.toHaveBeenCalled();
    });

    it('should reject reporting a suspended DRAFT course with 404', async () => {
      prisma.course.findUnique.mockResolvedValue(buildCourse(CourseStatus.DRAFT, true));

      await expect(
        service.report(reporterId, buildDto(ReportTargetType.COURSE, 'course-1')),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.report.create).not.toHaveBeenCalled();
    });

    it('should include visibility fields in the course lookup', async () => {
      prisma.course.findUnique.mockResolvedValue(buildCourse(CourseStatus.PUBLISHED, false));

      await service.report(reporterId, buildDto(ReportTargetType.COURSE, 'course-1'));

      expect(prisma.course.findUnique).toHaveBeenCalledWith({
        where: { id: 'course-1' },
        select: {
          id: true,
          lecturerId: true,
          status: true,
          isSuspended: true,
        },
      });
    });
  });
});
