import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '../../generated/prisma/enums.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type.js';
import { Roles } from '../authorization/roles.decorator.js';
import { RolesGuard } from '../authorization/roles.guard.js';
import { CreateReferenceDto } from './dto/create-reference.dto.js';
import { ReferenceSourcesQueryDto } from './dto/reference-sources-query.dto.js';
import {
  CourseReferenceResponseDto,
  ReferencedBlockResponseDto,
} from './dto/responses/course-reference-response.dto.js';
import { ReferencesService } from './references.service.js';

@ApiTags('Course references')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Administrators have no workspaces.' })
@UseGuards(RolesGuard)
@Roles(UserRole.STUDENT, UserRole.LECTURER)
@Controller()
export class ReferencesController {
  constructor(private readonly references: ReferencesService) {}

  @Get('pages/:pageId/references')
  @ApiOperation({
    summary: 'List the course references on a page',
    description: 'Each reference is resolved against the caller’s own course access.',
  })
  @ApiOkResponse({ type: [CourseReferenceResponseDto] })
  @ApiNotFoundResponse({ description: 'Missing page, or the caller is not a member.' })
  list(@CurrentUser() user: AuthenticatedUser, @Param('pageId') pageId: string) {
    return this.references.list(user.userId, pageId);
  }

  @Post('pages/:pageId/references')
  @ApiOperation({ summary: 'Reference an accessible FILE or VIDEO course block from a page' })
  @ApiCreatedResponse({ type: CourseReferenceResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid body, or a timestamp outside the video.' })
  @ApiNotFoundResponse({ description: 'Page or course material not available to the caller.' })
  @ApiConflictResponse({ description: 'The workspace is archived.' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('pageId') pageId: string,
    @Body() dto: CreateReferenceDto,
  ) {
    return this.references.create(user.userId, pageId, dto);
  }

  @Delete('references/:referenceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a course reference' })
  @ApiNoContentResponse({ description: 'Removed.' })
  @ApiNotFoundResponse({ description: 'Missing, or the caller is not a member.' })
  @ApiConflictResponse({ description: 'The workspace is archived.' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('referenceId') referenceId: string) {
    return this.references.remove(user.userId, referenceId);
  }

  @Get('reference-sources')
  @ApiOperation({ summary: 'Course blocks of one type the caller can currently reference' })
  @ApiOkResponse({ type: [ReferencedBlockResponseDto] })
  sources(@CurrentUser() user: AuthenticatedUser, @Query() query: ReferenceSourcesQueryDto) {
    return this.references.sources(user.userId, query);
  }
}
