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
import type { AuthenticatedUser } from '../modules/auth/types/authenticated-user.type.js';
import { Roles } from '../modules/authorization/roles.decorator.js';
import { RolesGuard } from '../modules/authorization/roles.guard.js';
import { CourseService } from './course.service.js';
import { CourseResponseDto } from './dto/course-response.dto.js';
import { CreateCourseDto } from './dto/create-course.dto.js';
import { UpdateCourseDto } from './dto/update-course.dto.js';
import { UpdateCourseStatusDto } from './dto/update-course-status.dto.js';

@ApiTags('Course')
@ApiBearerAuth('access-token')
@Controller('course')
export class CourseController {
  constructor(private courseService: CourseService) {}

  @Get('/get-all')
  @UseGuards(RolesGuard)
  @Roles('LECTURER')
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

  @Get('/get-all/published')
  @ApiOperation({ summary: 'Get all published and non-suspended courses' })
  @ApiOkResponse({
    description: 'List of published courses retrieved successfully.',
    type: [CourseResponseDto],
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  findAllPublished() {
    return this.courseService.findAllPublished();
  }

  @Get('/get/:courseId')
  @ApiOperation({
    summary: 'Get a specific course by ID',
    description:
      'The owner lecturer can always access the course. Other users can only access it if the course is PUBLISHED and not suspended.',
  })
  @ApiParam({ name: 'courseId', description: 'The ID of the course', example: 'clx123abc' })
  @ApiOkResponse({
    description: 'Course retrieved successfully.',
    type: CourseResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  @ApiForbiddenResponse({ description: 'You do not have access to this course.' })
  @ApiNotFoundResponse({ description: 'Course not found.' })
  findOne(@Param('courseId') courseId: string, @Req() req: { user: AuthenticatedUser }) {
    return this.courseService.findOne(courseId, req.user.userId);
  }

  @Post('/create')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RolesGuard)
  @Roles('LECTURER')
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

  @Patch('/update/:courseId')
  @UseGuards(RolesGuard)
  @Roles('LECTURER')
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

  @Patch('/update-status/:courseId')
  @UseGuards(RolesGuard)
  @Roles('LECTURER')
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
