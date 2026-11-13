//enrollment.controller.ts
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import type { Request } from 'express';

import { UserRole } from '../../generated/prisma/client.js';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type.js';
import { Roles } from '../authorization/roles.decorator.js';
import { RolesGuard } from '../authorization/roles.guard.js';
import { CourseEnrollmentParamsDto, CourseIdParamDto } from './dto/course-id-param.dto.js';
import { EnrollmentActionResponseDto } from './dto/enrollment-action-response.dto.js';
import { EnrollmentCompletionResponseDto } from './dto/enrollment-completion-response.dto.js';
import { EnrollmentRosterQueryDto } from './dto/enrollment-roster-query.dto.js';
import { EnrollmentStateResponseDto } from './dto/enrollment-state-response.dto.js';
import { MyEnrollmentsQueryDto } from './dto/my-enrollments-query.dto.js';
import { PaginatedEnrollmentRosterResponseDto } from './dto/paginated-enrollment-roster-response.dto.js';
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

  @Get('courses/:courseId/enrollments')
  @Roles(UserRole.LECTURER)
  @ApiOperation({
    summary: 'Get the enrolled-student roster for a course',
    description:
      'Owning Lecturer only. Returns each enrollment with the student, progress (same counting as the student progress endpoint), and the mean quiz final score. ' +
      'LEFT enrollments are excluded by default. Works for DRAFT/suspended courses (FR-EN-07).',
  })
  @ApiParam({ name: 'courseId', description: 'The ID of the course', example: 'clx123abc' })
  @ApiOkResponse({
    description: 'Paginated roster of enrollments for the owning Lecturer.',
    type: PaginatedEnrollmentRosterResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid query parameters (e.g. unknown status, limit > 100, page < 1).',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  @ApiForbiddenResponse({ description: 'You do not own this course.' })
  @ApiNotFoundResponse({ description: 'Course not found.' })
  async getCourseRoster(
    @Param() params: CourseIdParamDto,
    @Query() query: EnrollmentRosterQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<PaginatedEnrollmentRosterResponseDto> {
    return this.enrollmentService.listCourseRoster(req.user.userId, params.courseId, query);
  }

  @Patch('courses/:courseId/enrollments/:enrollmentId/complete')
  @Roles(UserRole.LECTURER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Manually complete a student enrollment',
    description:
      'Allows the Lecturer who owns the course to manually complete an ACTIVE enrollment.',
  })
  @ApiOkResponse({
    description: 'Enrollment successfully completed.',
    type: EnrollmentCompletionResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'The Lecturer does not own this course.',
  })
  @ApiNotFoundResponse({
    description: 'Enrollment not found in this course.',
  })
  @ApiConflictResponse({
    description: 'Only ACTIVE enrollments can be completed.',
  })
  async completeEnrollment(
    @Param() param: CourseEnrollmentParamsDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<EnrollmentCompletionResponseDto> {
    return this.enrollmentService.completeEnrollment(
      req.user.userId,
      param.courseId,
      param.enrollmentId,
    );
  }
}
