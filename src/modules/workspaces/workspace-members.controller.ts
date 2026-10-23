import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
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
import { AddMemberDto } from './dto/add-member.dto.js';
import { WorkspaceMemberResponseDto } from './dto/responses/workspace-member-response.dto.js';
import { WorkspaceMembersService } from './workspace-members.service.js';

@ApiTags('Workspace members')
@ApiBearerAuth()
@ApiNotFoundResponse({ description: 'Missing, or the caller is not a member.' })
@UseGuards(RolesGuard)
@Roles(UserRole.STUDENT, UserRole.LECTURER)
@Controller('workspaces/:workspaceId/members')
export class WorkspaceMembersController {
  constructor(private readonly members: WorkspaceMembersService) {}

  @Get()
  @ApiOperation({ summary: 'List the members of a workspace' })
  @ApiOkResponse({ type: [WorkspaceMemberResponseDto] })
  @ApiForbiddenResponse({ description: 'Administrators have no workspaces.' })
  list(@CurrentUser() user: AuthenticatedUser, @Param('workspaceId') workspaceId: string) {
    return this.members.list(user.userId, workspaceId);
  }

  @Post()
  @ApiOperation({
    summary: 'Add a member by email',
    description: 'Owners add Members or Co-owners; Co-owners add Members only.',
  })
  @ApiCreatedResponse({ type: WorkspaceMemberResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid body, or the user is an administrator.' })
  @ApiForbiddenResponse({ description: 'The caller cannot add this role.' })
  @ApiConflictResponse({ description: 'Personal or archived workspace, or already a member.' })
  add(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.members.add(user.userId, workspaceId, dto);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a member',
    description: 'Owners remove Co-owners and Members; Co-owners remove Members; Owners stay.',
  })
  @ApiNoContentResponse({ description: 'Removed.' })
  @ApiForbiddenResponse({ description: 'The caller cannot remove this member.' })
  @ApiConflictResponse({ description: 'The workspace is archived.' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
    @Param('userId') targetUserId: string,
  ) {
    return this.members.remove(user.userId, workspaceId, targetUserId);
  }
}
