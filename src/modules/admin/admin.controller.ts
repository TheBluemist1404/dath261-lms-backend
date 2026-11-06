import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UserRole } from '../../generated/prisma/enums.js';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type.js';
import { Roles } from '../authorization/roles.decorator.js';
import { RolesGuard } from '../authorization/roles.guard.js';
import { AdminService } from './admin.service.js';
import { AdminCourseItemDto } from './dto/admin-course-item.dto.js';
import { AdminUserItemDto } from './dto/admin-user-item.dto.js';
import { ListAdminCoursesQueryDto } from './dto/list-admin-courses-query.dto.js';
import { ListAdminUsersQueryDto } from './dto/list-admin-users-query.dto.js';
import { PaginatedAdminCoursesResponseDto } from './dto/paginated-admin-courses-response.dto.js';
import { PaginatedAdminUsersResponseDto } from './dto/paginated-admin-users-response.dto.js';
import { UpdateCourseSuspensionDto } from './dto/update-course-suspension.dto.js';
import { UpdateUserStatusDto } from './dto/update-user-status.dto.js';

type AuthenticatedRequest = {
  user: AuthenticatedUser;
};

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@Controller('admin')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  @ApiOperation({ summary: 'List and filter users' })
  @ApiOkResponse({
    description: 'Paginated users retrieved successfully.',
    type: PaginatedAdminUsersResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid query parameters.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  @ApiForbiddenResponse({ description: 'Admin role required.' })
  listUsers(@Query() query: ListAdminUsersQueryDto) {
    return this.adminService.listUsers(query);
  }

  @Patch('users/:userId/status')
  @ApiOperation({ summary: 'Suspend or reactivate a user account' })
  @ApiParam({ name: 'userId', example: 'cm123user' })
  @ApiOkResponse({
    description: 'User status updated successfully.',
    type: AdminUserItemDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid status or the administrator attempts to suspend their own account.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  @ApiForbiddenResponse({ description: 'Admin role required.' })
  @ApiNotFoundResponse({ description: 'User not found.' })
  updateUserStatus(
    @Param('userId') userId: string,
    @Body() dto: UpdateUserStatusDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.adminService.updateUserStatus(userId, req.user.userId, dto);
  }

  @Get('courses')
  @ApiOperation({ summary: 'List and filter all courses' })
  @ApiOkResponse({
    description: 'Paginated courses retrieved successfully.',
    type: PaginatedAdminCoursesResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid query parameters.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  @ApiForbiddenResponse({ description: 'Admin role required.' })
  listCourses(@Query() query: ListAdminCoursesQueryDto) {
    return this.adminService.listCourses(query);
  }

  @Patch('courses/:courseId/suspension')
  @ApiOperation({ summary: 'Suspend or unsuspend a course' })
  @ApiParam({ name: 'courseId', example: 'cm123course' })
  @ApiOkResponse({
    description: 'Course suspension state updated successfully.',
    type: AdminCourseItemDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid request body.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  @ApiForbiddenResponse({ description: 'Admin role required.' })
  @ApiNotFoundResponse({ description: 'Course not found.' })
  updateCourseSuspension(
    @Param('courseId') courseId: string,
    @Body() dto: UpdateCourseSuspensionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.adminService.updateCourseSuspension(courseId, req.user.userId, dto);
  }
}
