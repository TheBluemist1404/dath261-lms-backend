import { Test, type TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountStatus, CourseStatus, UserRole } from '../../../generated/prisma/enums.js';
import { AdminController } from '../admin.controller.js';
import { AdminService } from '../admin.service.js';

describe('AdminController', () => {
  let controller: AdminController;

  const mockAdminService = {
    listUsers: vi.fn(),
    updateUserStatus: vi.fn(),
    listCourses: vi.fn(),
    updateCourseSuspension: vi.fn(),
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

    await controller.updateUserStatus('user-1', dto, request);

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

    await controller.updateCourseSuspension('course-1', dto, request);

    expect(mockAdminService.updateCourseSuspension).toHaveBeenCalledWith(
      'course-1',
      'admin-1',
      dto,
    );
  });
});
