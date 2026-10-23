import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CourseBlockService } from './courseblock.service.js';
import { CreateCourseBlockDto } from './dto/create-course-block.dto.js';
import { UpdateCourseBlockDto } from './dto/update-course-block.dto.js';

@ApiTags('Course Block')
@Controller('courseblock')
export class CourseBlockController {
  constructor(private courseBlockSerivice: CourseBlockService) {}

  @Get('/get-all/:courseId')
  @ApiOperation({ summary: 'Get all course blocks for a specific course' })
  @ApiParam({ name: 'courseId', description: 'The ID of the course' })
  // comment below used to ignore "any" type linting error for the request object
  // biome-ignore lint/suspicious/noExplicitAny: NestJS request object, can't type it properly
  findAll(@Param('courseId') courseId: string, @Req() req: any) {
    return this.courseBlockSerivice.findAll(courseId, req.user.id);
  }

  @ApiOperation({ summary: 'Create a new course block for a specific course' })
  @ApiParam({ name: 'courseId', description: 'The ID of the course' })
  @Post('/create/:courseId')
  // biome-ignore lint/suspicious/noExplicitAny: NestJS request object, can't type it properly
  create(@Param('courseId') courseId: string, @Req() req: any, @Body() dto: CreateCourseBlockDto) {
    return this.courseBlockSerivice.create(courseId, req.user.id, dto);
  }

  @ApiOperation({ summary: 'Update a specific course block in a course' })
  @ApiParam({ name: 'courseId', description: 'The ID of the course' })
  @ApiParam({ name: 'blockId', description: 'The ID of the course block' })
  @Patch('/update/:courseId/:blockId')
  update(
    @Param('courseId') courseId: string,
    @Param('blockId') blockId: string,
    // biome-ignore lint/suspicious/noExplicitAny: NestJS request object, can't type it properly
    @Req() req: any,
    @Body() dto: UpdateCourseBlockDto,
  ) {
    return this.courseBlockSerivice.update(courseId, blockId, req.user.id, dto);
  }

  @ApiOperation({ summary: 'Delete a specific course block from a course' })
  @ApiParam({ name: 'courseId', description: 'The ID of the course' })
  @ApiParam({ name: 'blockId', description: 'The ID of the course block' })
  @Delete('delete/:courseId/:blockId')
  // biome-ignore lint/suspicious/noExplicitAny: NestJS request object, can't type it properly
  remove(@Param('courseId') courseId: string, @Param('blockId') blockId: string, @Req() req: any) {
    return this.courseBlockSerivice.remove(courseId, blockId, req.user.id);
  }

  @ApiOperation({ summary: 'Reorder course blocks within a specific course' })
  @ApiParam({ name: 'courseId', description: 'The ID of the course' })
  @ApiParam({ name: 'blockId', description: 'The ID of the course block' })
  @Patch('reorder/:courseId/:blockId')
  // biome-ignore lint/suspicious/noExplicitAny: NestJS request object, can't type it properly
  reorder(@Param('courseId') courseId: string, @Param('blockId') blockId: string, @Req() req: any) {
    return this.courseBlockSerivice.reorder(courseId, blockId, req.user.id);
  }
}
