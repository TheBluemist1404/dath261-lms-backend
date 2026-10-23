import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
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
import { DiscussionService } from './discussion.service.js';
import { CreateMessageDto } from './dto/create-message.dto.js';
import { CreateReportDto } from './dto/create-report.dto.js';
import {
  PageMessageResponseDto,
  ReportResponseDto,
} from './dto/responses/discussion-response.dto.js';

@ApiTags('Page discussion')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Administrators have no workspaces.' })
@UseGuards(RolesGuard)
@Roles(UserRole.STUDENT, UserRole.LECTURER)
@Controller()
export class DiscussionController {
  constructor(private readonly discussion: DiscussionService) {}

  @Get('pages/:pageId/messages')
  @ApiOperation({
    summary: 'List a shared page’s discussion, oldest first',
    description:
      'New messages are also pushed live to clients subscribed to the page discussion over /api/collab.',
  })
  @ApiOkResponse({ type: [PageMessageResponseDto] })
  @ApiNotFoundResponse({ description: 'Missing page, or the caller is not a member.' })
  @ApiConflictResponse({ description: 'Pages in the personal workspace have no discussion.' })
  list(@CurrentUser() user: AuthenticatedUser, @Param('pageId') pageId: string) {
    return this.discussion.list(user.userId, pageId);
  }

  @Post('pages/:pageId/messages')
  @ApiOperation({ summary: 'Post a message to a shared page’s discussion' })
  @ApiCreatedResponse({ type: PageMessageResponseDto })
  @ApiBadRequestResponse({ description: 'Content is empty or longer than 2000 characters.' })
  @ApiNotFoundResponse({ description: 'Missing page, or the caller is not a member.' })
  @ApiConflictResponse({ description: 'Personal workspace, or the workspace is archived.' })
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('pageId') pageId: string,
    @Body() dto: CreateMessageDto,
  ) {
    return this.discussion.send(user.userId, pageId, dto);
  }

  @Post('reports')
  @ApiOperation({ summary: 'Report a discussion message for moderation' })
  @ApiCreatedResponse({ type: ReportResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid body, or reporting your own message.' })
  @ApiNotFoundResponse({ description: 'The message is missing or not visible to the caller.' })
  report(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReportDto) {
    return this.discussion.report(user.userId, dto);
  }
}
