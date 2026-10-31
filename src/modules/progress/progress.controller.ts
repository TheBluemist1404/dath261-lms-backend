import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { Request } from 'express';

import { UserRole } from '../../generated/prisma/client.js';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type.js';

import { Roles } from '../authorization/roles.decorator.js';
import { RolesGuard } from '../authorization/roles.guard.js';
import { LecturerStudentProgressResponseDto } from './dto/lecturer-progress-response.dto.js';
import {
  CourseBlockParamsDto,
  CourseEnrollmentParamsDto,
  CourseParamsDto,
} from './dto/progress-params.dto.js';
import {
  BlockProgressMutationResponseDto,
  ResumePositionResponseDto,
  StudentProgressResponseDto,
} from './dto/progress-response.dto.js';
import { UpdateBlockCompletionDto } from './dto/update-block-completion.dto.js';
import { UpdateLearningPositionDto } from './dto/update-learning-position.dto.js';
import { ProgressService } from './progress.service.js';

type AuthenticatedRequest = Request & {
  user: AuthenticatedUser;
};

@ApiTags('Learning Progress')
@ApiBearerAuth()
@Controller()
@UseGuards(RolesGuard)
export class ProgressController {
  constructor(private readonly progressService: ProgressService) {}

  @Patch('courses/:courseId/blocks/:blockId/progress')
  @Roles(UserRole.STUDENT)
  @ApiOperation({
    summary: 'Mark or unmark a learning block',
  })
  @ApiOkResponse({
    type: BlockProgressMutationResponseDto,
  })
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  async updateBlockCompletion(
    @Param() params: CourseBlockParamsDto,
    @Body() dto: UpdateBlockCompletionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.progressService.updateBlockCompletion(
      req.user.userId,
      params.courseId,
      params.blockId,
      dto,
    );
  }

  @Patch('courses/:courseId/blocks/:blockId/position')
  @Roles(UserRole.STUDENT)
  @ApiOperation({
    summary: 'Save last visited learning position',
  })
  @ApiOkResponse({
    type: BlockProgressMutationResponseDto,
  })
  async updateLearningPosition(
    @Param() params: CourseBlockParamsDto,
    @Body() dto: UpdateLearningPositionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.progressService.updateLearningPosition(
      req.user.userId,
      params.courseId,
      params.blockId,
      dto,
    );
  }

  @Get('courses/:courseId/progress')
  @Roles(UserRole.STUDENT)
  @ApiOperation({
    summary: 'Get student learning progress',
  })
  @ApiOkResponse({
    type: StudentProgressResponseDto,
  })
  async getStudentProgress(@Param() params: CourseParamsDto, @Req() req: AuthenticatedRequest) {
    return this.progressService.getStudentProgress(req.user.userId, params.courseId);
  }

  @Get('courses/:courseId/progress/resume')
  @Roles(UserRole.STUDENT)
  @ApiOperation({
    summary: 'Get last visited learning position',
  })
  @ApiOkResponse({
    type: ResumePositionResponseDto,
  })
  async getResumePosition(@Param() params: CourseParamsDto, @Req() req: AuthenticatedRequest) {
    return this.progressService.getResumePosition(req.user.userId, params.courseId);
  }

  @Get('courses/:courseId/enrollments/:enrollmentId/progress')
  @Roles(UserRole.LECTURER)
  @ApiOperation({
    summary: 'Get learner progress and assessment history',
  })
  @ApiOkResponse({
    description: 'Returns progress, quiz attempts, and assignment submissions for a learner.',
    type: LecturerStudentProgressResponseDto,
  })
  async getLecturerStudentProgress(
    @Param() params: CourseEnrollmentParamsDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<LecturerStudentProgressResponseDto> {
    return this.progressService.getLecturerStudentProgress(
      req.user.userId,
      params.courseId,
      params.enrollmentId,
    );
  }
}
