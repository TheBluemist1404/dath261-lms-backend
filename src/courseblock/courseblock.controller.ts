// courseblock.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../modules/auth/types/authenticated-user.type.js';
import { CourseBlockService } from './courseblock.service.js';
import { CourseBlockResponseDto } from './dto/course-block-response.dto.js';
import { CreateCourseBlockDto } from './dto/create-course-block.dto.js';
import { ReorderCourseBlocksDto } from './dto/reorder-course-block.dto.js';
import { UpdateCourseBlockDto } from './dto/update-course-block.dto.js';

@ApiTags('Course Block')
@ApiBearerAuth('access-token') // Display token
@Controller('courseblock')
export class CourseBlockController {
  constructor(private courseBlockSerivice: CourseBlockService) {}

  @Get('/get-all/:courseId')
  @ApiOperation({ summary: 'Get all course blocks for a specific course' })
  @ApiParam({ name: 'courseId', description: 'The ID of the course', example: 'clx456def' })
  @ApiOkResponse({
    description: 'List of course blocks retrieved successfully.',
    type: [CourseBlockResponseDto],
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  @ApiForbiddenResponse({ description: 'You do not own this course.' })
  @ApiNotFoundResponse({ description: 'Course not found.' })
  findAll(@Param('courseId') courseId: string, @Req() req: { user: AuthenticatedUser }) {
    return this.courseBlockSerivice.findAll(courseId, req.user.userId);
  }

  @Post('/create/:courseId')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new course block for a specific course',
    description:
      'Creates a new block inside a course. If `parentModuleId` is provided, it must reference a MODULE block belonging to the same course.',
  })
  @ApiParam({ name: 'courseId', description: 'The ID of the course', example: 'clx456def' })
  @ApiCreatedResponse({
    description: 'Course block created successfully.',
    type: CourseBlockResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid input (parent module not in same course, parent block is not a MODULE).',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  @ApiForbiddenResponse({ description: 'You do not own this course.' })
  @ApiNotFoundResponse({ description: 'Course not found.' })
  create(
    @Param('courseId') courseId: string,
    @Req() req: { user: AuthenticatedUser },
    @Body() dto: CreateCourseBlockDto,
  ) {
    return this.courseBlockSerivice.create(courseId, req.user.userId, dto);
  }

  @ApiOperation({ summary: 'Update a specific course block in a course' })
  @ApiParam({ name: 'courseId', description: 'The ID of the course', example: 'clx456def' })
  @ApiParam({ name: 'blockId', description: 'The ID of the course block', example: 'clx456def' })
  @ApiOkResponse({
    description: 'Course block updated successfully.',
    type: CourseBlockResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid input (trying to change a MODULE with children to another type).',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  @ApiForbiddenResponse({ description: 'You do not own this course.' })
  @ApiNotFoundResponse({ description: 'Course or course block not found.' })
  @Patch('/update/:courseId/:blockId')
  update(
    @Param('courseId') courseId: string,
    @Param('blockId') blockId: string,
    @Req() req: { user: AuthenticatedUser },
    @Body() dto: UpdateCourseBlockDto,
  ) {
    return this.courseBlockSerivice.update(courseId, blockId, req.user.userId, dto);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a specific course block from a course',
    description:
      'Deletes a block. Make sure the block belongs to the course and that you own the course.',
  })
  @ApiParam({ name: 'courseId', description: 'The ID of the course', example: 'clx456def' })
  @ApiParam({ name: 'blockId', description: 'The ID of the course block', example: 'clx789ghi' })
  @ApiNoContentResponse({ description: 'Course block deleted successfully.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  @ApiForbiddenResponse({ description: 'You do not own this course.' })
  @ApiNotFoundResponse({ description: 'Course or course block not found.' })
  @Delete('delete/:courseId/:blockId')
  remove(
    @Param('courseId') courseId: string,
    @Param('blockId') blockId: string,
    @Req() req: { user: AuthenticatedUser },
  ) {
    return this.courseBlockSerivice.remove(courseId, blockId, req.user.userId);
  }

  @ApiOperation({ summary: 'Reorder course blocks within a specific course' })
  @ApiParam({ name: 'courseId', description: 'The ID of the course', example: 'clx456def' })
  @ApiOkResponse({
    description: 'Blocks reordered successfully. Returns the reordered list.',
    type: [CourseBlockResponseDto],
  })
  @ApiBadRequestResponse({
    description:
      'Invalid input (duplicate IDs, blocks not in the same course, mixed parents, missing siblings).',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  @ApiForbiddenResponse({ description: 'You do not own this course.' })
  @ApiNotFoundResponse({ description: 'Course not found.' })
  @ApiInternalServerErrorResponse({ description: 'Transaction failed while reordering.' })
  @Patch('reorder/:courseId')
  reorder(
    @Param('courseId') courseId: string,
    @Body() dto: ReorderCourseBlocksDto,
    @Req() req: { user: AuthenticatedUser },
  ) {
    return this.courseBlockSerivice.reorder(courseId, dto.blockIds, req.user.userId);
  }
}
