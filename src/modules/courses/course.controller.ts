// course.controller.ts
import {
  Body,
  Controller,
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
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UserRole } from '../../generated/prisma/enums.js';
import { OptionalAuth } from '../auth/decorators/optional-auth.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type.js';
import { Roles } from '../authorization/roles.decorator.js';
import { RolesGuard } from '../authorization/roles.guard.js';
import { CourseService } from './course.service.js';
import { CourseOutlineItemDto } from './dto/course-outline.dto.js';
import { CourseQueryDto } from './dto/course-query.dto.js';
import { CourseResponseDto } from './dto/course-response.dto.js';
import { CreateCourseDto } from './dto/create-course.dto.js';
import { PaginatedCourseResponseDto } from './dto/paginated-course-response.dto.js';
import { UpdateCourseDto } from './dto/update-course.dto.js';
import { UpdateCourseStatusDto } from './dto/update-course-status.dto.js';

@ApiTags('Courses')
@ApiBearerAuth('access-token')
@Controller('courses')
export class CourseController {
  constructor(private courseService: CourseService) {}

  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.LECTURER)
  @ApiOperation({ summary: 'Get all courses owned by the current lecturer' })
  @ApiOkResponse({
    description: 'List of courses retrieved successfully.',
    type: [CourseResponseDto],
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions.' })
  findAll(@Req() req: { user: AuthenticatedUser }) {
    return this.courseService.findAllByLecturer(req.user.userId);
  }

  @Get('catalog')
  @Public()
  @ApiOperation({
    summary: 'Get all published and non-suspended courses (public, no sign-in needed)',
    description:
      'Supports search (title/description/prerequisites), filtering (lecturerId, enrollmentOpen), sorting, and pagination.',
  })
  @ApiOkResponse({
    description: 'Paginated list of published courses retrieved successfully.',
    type: PaginatedCourseResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid query parameters (e.g. unknown sortBy value).',
  })
  findAllPublished(@Query() query: CourseQueryDto) {
    return this.courseService.findAllPublished(query);
  }

  @Get(':courseId')
  @OptionalAuth()
  @ApiOperation({
    summary: 'Get a specific course by ID',
    description:
      'Guests can read PUBLISHED, non-suspended courses (404 otherwise). Signed-in callers keep existing behaviour (owner sees drafts).',
  })
  @ApiOkResponse({
    description: 'Course retrieved successfully.',
    type: CourseResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  @ApiNotFoundResponse({
    description: 'Course not found, or draft/suspended course for non-owner/guest.',
  })
  findOne(@Param('courseId') courseId: string, @Req() req: { user?: AuthenticatedUser }) {
    return this.courseService.findOne(courseId, req.user?.userId);
  }

  @Get(':courseId/outline')
  @Public()
  @ApiOperation({
    summary: 'Get the ordered syllabus (metadata only) of a published course',
    description:
      'Returns the ordered block tree (id, type, title, position, children) for a PUBLISHED, non-suspended course. No content or quiz data. 404 otherwise.',
  })
  @ApiOkResponse({ type: [CourseOutlineItemDto] })
  @ApiNotFoundResponse({ description: 'Course not found, or draft/suspended course.' })
  findOutline(@Param('courseId') courseId: string) {
    return this.courseService.findOutline(courseId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RolesGuard)
  @Roles(UserRole.LECTURER)
  @ApiOperation({
    summary: 'Create a new course',
    description: 'Creates a new course in DRAFT status owned by the current lecturer.',
  })
  @ApiCreatedResponse({
    description: 'Course created successfully.',
    type: CourseResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid input (e.g. enrollmentStartAt is after enrollmentEndAt).',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions.' })
  create(@Req() req: { user: AuthenticatedUser }, @Body() dto: CreateCourseDto) {
    return this.courseService.create(req.user.userId, dto);
  }

  @Patch(':courseId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.LECTURER)
  @ApiOperation({ summary: 'Update a specific course' })
  @ApiParam({ name: 'courseId', description: 'The ID of the course', example: 'clx123abc' })
  @ApiOkResponse({
    description: 'Course updated successfully.',
    type: CourseResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid input (e.g. enrollmentStartAt is after enrollmentEndAt).',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  @ApiForbiddenResponse({ description: 'You do not own this course.' })
  @ApiNotFoundResponse({ description: 'Course not found.' })
  update(
    @Param('courseId') courseId: string,
    @Req() req: { user: AuthenticatedUser },
    @Body() dto: UpdateCourseDto,
  ) {
    return this.courseService.update(courseId, req.user.userId, dto);
  }

  @Patch(':courseId/status')
  @UseGuards(RolesGuard)
  @Roles(UserRole.LECTURER)
  @ApiOperation({
    summary: 'Update the publication status of a specific course',
    description:
      'Changes the course status between DRAFT and PUBLISHED. A course cannot be published if it has no blocks.',
  })
  @ApiParam({ name: 'courseId', description: 'The ID of the course', example: 'clx123abc' })
  @ApiOkResponse({
    description: 'Course status updated successfully.',
    type: CourseResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid transition (e.g. publishing an empty course).',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  @ApiForbiddenResponse({ description: 'You do not own this course.' })
  @ApiNotFoundResponse({ description: 'Course not found.' })
  updateStatus(
    @Param('courseId') courseId: string,
    @Req() req: { user: AuthenticatedUser },
    @Body() dto: UpdateCourseStatusDto,
  ) {
    return this.courseService.updateStatus(courseId, req.user.userId, dto);
  }
}
