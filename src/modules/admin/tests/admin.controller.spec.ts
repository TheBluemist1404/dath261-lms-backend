import { Test, type TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AccountStatus,
  CourseStatus,
  ReportStatus,
  UserRole,
} from '../../../generated/prisma/enums.js';
import { AdminController } from '../admin.controller.js';
import { AdminService } from '../admin.service.js';
import type { ListAdminReportsQueryDto } from '../dto/list-admin-reports-query.dto.js';
import type { UpdateReportStatusDto } from '../dto/update-report-status.dto.js';

describe('AdminController', () => {
  let controller: AdminController;

  const mockAdminService = {
    listUsers: vi.fn(),
    updateUserStatus: vi.fn(),
    listCourses: vi.fn(),
    updateCourseSuspension: vi.fn(),
    listReports: vi.fn(),
    getReport: vi.fn(),
    reviewReport: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        {
          provide: AdminService,
          useValue: mockAdminService,
        },
      ],
    }).compile();

    controller = moduleRef.get(AdminController);
  });

  const request = {
    user: {
      userId: 'admin-1',
      role: UserRole.ADMIN,
    },
  };

  it('should delegate user listing', async () => {
    const query = { page: 1, pageSize: 20 };
    mockAdminService.listUsers.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });

    await expect(controller.listUsers(query)).resolves.toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });

    expect(mockAdminService.listUsers).toHaveBeenCalledWith(query);
  });

  it('should pass current admin id when updating user status', async () => {
    const dto = { status: AccountStatus.SUSPENDED };
    mockAdminService.updateUserStatus.mockResolvedValue({ id: 'user-1' });

    await controller.updateUserStatus('user-1', dto, request as any);

    expect(mockAdminService.updateUserStatus).toHaveBeenCalledWith('user-1', 'admin-1', dto);
  });

  it('should delegate course listing', async () => {
    const query = { status: CourseStatus.DRAFT };
    mockAdminService.listCourses.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });

    await controller.listCourses(query);

    expect(mockAdminService.listCourses).toHaveBeenCalledWith(query);
  });

  it('should pass current admin id when updating course suspension', async () => {
    const dto = { suspended: true };
    mockAdminService.updateCourseSuspension.mockResolvedValue({
      id: 'course-1',
    });

    await controller.updateCourseSuspension('course-1', dto, request as any);

    expect(mockAdminService.updateCourseSuspension).toHaveBeenCalledWith(
      'course-1',
      'admin-1',
      dto,
    );
  });

  it('should delegate GET reports to AdminService', async () => {
    const query = {
      status: ReportStatus.PENDING,
      page: 1,
      pageSize: 20,
    } as ListAdminReportsQueryDto;

    const expected = {
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    };

    mockAdminService.listReports.mockResolvedValue(expected);

    await expect(controller.listReports(query)).resolves.toEqual(expected);

    expect(mockAdminService.listReports).toHaveBeenCalledWith(query);
  });

  it('should delegate GET report detail to AdminService', async () => {
    const expected = {
      id: 'report-1',
      history: [],
    };

    mockAdminService.getReport.mockResolvedValue(expected);

    await expect(controller.getReport('report-1')).resolves.toEqual(expected);

    expect(mockAdminService.getReport).toHaveBeenCalledWith('report-1');
  });

  it('should delegate PATCH report status with the authenticated admin ID', async () => {
    const dto = {
      status: ReportStatus.ACTION_TAKEN,
      reason: 'Policy violation confirmed',
    } as UpdateReportStatusDto;

    const expected = {
      id: 'report-1',
      status: ReportStatus.ACTION_TAKEN,
    };

    mockAdminService.reviewReport.mockResolvedValue(expected);

    await expect(controller.reviewReport('report-1', dto, request as any)).resolves.toEqual(
      expected,
    );

    expect(mockAdminService.reviewReport).toHaveBeenCalledWith('report-1', 'admin-1', dto);
  });
});
