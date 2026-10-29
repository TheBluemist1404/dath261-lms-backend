import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import type { Request } from 'express';

import { UserRole } from '../../generated/prisma/client.js';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type.js';
import { Roles } from '../authorization/roles.decorator.js';
import { RolesGuard } from '../authorization/roles.guard.js';
import { CourseIdParamDto } from './dto/course-id-param.dto.js';
import { EnrollmentActionResponseDto } from './dto/enrollment-action-response.dto.js';
import { EnrollmentStateResponseDto } from './dto/enrollment-state-response.dto.js';
import { MyEnrollmentsQueryDto } from './dto/my-enrollments-query.dto.js';
import { PaginatedMyCoursesResponseDto } from './dto/paginated-my-courses-response.dto.js';
import { EnrollmentService } from './enrollment.service.js';

type AuthenticatedRequest = Request & {
  user: AuthenticatedUser;
};

@ApiTags('Enrollments')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller()
export class EnrollmentController {
  constructor(private readonly enrollmentService: EnrollmentService) {}

  @Post('courses/:courseId/enrollments/me')
  @Roles(UserRole.STUDENT)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Enroll in a course' })
  @ApiParam({ name: 'courseId', type: String })
  @ApiCreatedResponse({
    description: 'Enroll successful',
    type: EnrollmentActionResponseDto,
  })
  @ApiConflictResponse({
    description:
      'Course unavailable, enrollment window closed, duplicate active enrollment, or completed enrollment.',
  })
  @ApiForbiddenResponse({
    description: 'Only Students can enroll.',
  })
  @ApiNotFoundResponse({ description: 'Course not found.' })
  async enroll(
    @Param() params: CourseIdParamDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<EnrollmentActionResponseDto> {
    const enrollment = await this.enrollmentService.enroll(req.user.userId, params.courseId);

    return {
      enrollmentId: enrollment.id,
      courseId: enrollment.courseId,
      status: enrollment.status,
      canAccessCourse: true,
    };
  }

  @Delete('courses/:courseId/enrollments/me')
  @Roles(UserRole.STUDENT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Leave a course' })
  @ApiParam({ name: 'courseId', type: String })
  @ApiOkResponse({ type: EnrollmentActionResponseDto })
  @ApiForbiddenResponse({
    description: 'Only Students can leave a course.',
  })
  @ApiNotFoundResponse({
    description: 'Enrollment not found.',
  })
  @ApiConflictResponse({
    description: 'Enrollment is already LEFT or COMPLETED.',
  })
  async leave(
    @Param() params: CourseIdParamDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<EnrollmentActionResponseDto> {
    const enrollment = await this.enrollmentService.leave(req.user.userId, params.courseId);

    return {
      enrollmentId: enrollment.id,
      courseId: enrollment.courseId,
      status: enrollment.status,
      canAccessCourse: false,
    };
  }

  @Get('users/me/enrollments')
  @Roles(UserRole.STUDENT)
  @ApiOperation({
    summary: 'Get my courses and enrollment history',
  })
  @ApiOkResponse({
    description: 'Paginated list of the current student enrollments.',
    type: PaginatedMyCoursesResponseDto,
  })
  async getMyEnrollments(
    @Req() req: AuthenticatedRequest,
    @Query() query: MyEnrollmentsQueryDto,
  ): Promise<PaginatedMyCoursesResponseDto> {
    return this.enrollmentService.getMyEnrollments(req.user.userId, query);
  }
  @Get('courses/:courseId/enrollments/me')
  @Roles(UserRole.STUDENT)
  @ApiOperation({
    summary: 'Get my enrollment and course access state',
  })
  @ApiParam({ name: 'courseId', type: String })
  @ApiOkResponse({ type: EnrollmentStateResponseDto })
  @ApiNotFoundResponse({ description: 'Course not found.' })
  async getCourseEnrollmentState(
    @Param() params: CourseIdParamDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<EnrollmentStateResponseDto> {
    return this.enrollmentService.getCourseEnrollmentState(req.user.userId, params.courseId);
  }
}
