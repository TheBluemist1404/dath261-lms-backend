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
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '../../generated/prisma/enums.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type.js';
import { Roles } from '../authorization/roles.decorator.js';
import { RolesGuard } from '../authorization/roles.guard.js';
import { CreateWorkspaceDto } from './dto/create-workspace.dto.js';
import { ListWorkspacesQueryDto } from './dto/list-workspaces-query.dto.js';
import { WorkspaceResponseDto } from './dto/responses/workspace-response.dto.js';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto.js';
import { WorkspacesService } from './workspaces.service.js';

@ApiTags('Workspaces')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Administrators have no workspaces.' })
@UseGuards(RolesGuard)
@Roles(UserRole.STUDENT, UserRole.LECTURER)
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  @ApiOperation({
    summary: 'List my workspaces',
    description:
      'Active workspaces the caller belongs to, or archived ones with archived=true. The personal workspace is created on first use.',
  })
  @ApiOkResponse({ type: [WorkspaceResponseDto] })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListWorkspacesQueryDto) {
    return this.workspaces.list(user.userId, query.archived ?? false);
  }

  @Post()
  @ApiOperation({ summary: 'Create a collaborative workspace with the caller as Owner' })
  @ApiCreatedResponse({ type: WorkspaceResponseDto })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateWorkspaceDto) {
    return this.workspaces.create(user.userId, dto.name);
  }

  @Get(':workspaceId')
  @ApiOperation({ summary: 'Get a workspace' })
  @ApiOkResponse({ type: WorkspaceResponseDto })
  @ApiNotFoundResponse({ description: 'Missing, or the caller is not a member.' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('workspaceId') workspaceId: string) {
    return this.workspaces.get(user.userId, workspaceId);
  }

  @Patch(':workspaceId')
  @ApiOperation({ summary: 'Rename a workspace (Owner only)' })
  @ApiOkResponse({ type: WorkspaceResponseDto })
  @ApiNotFoundResponse({ description: 'Missing, or the caller is not a member.' })
  @ApiConflictResponse({ description: 'The workspace is archived.' })
  rename(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    return this.workspaces.rename(user.userId, workspaceId, dto.name);
  }

  @Post(':workspaceId/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive a collaborative workspace (Owner only)' })
  @ApiOkResponse({ type: WorkspaceResponseDto })
  @ApiNotFoundResponse({ description: 'Missing, or the caller is not a member.' })
  @ApiConflictResponse({ description: 'Personal or already archived.' })
  archive(@CurrentUser() user: AuthenticatedUser, @Param('workspaceId') workspaceId: string) {
    return this.workspaces.archive(user.userId, workspaceId);
  }

  @Post(':workspaceId/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore an archived workspace (Owner only)' })
  @ApiOkResponse({ type: WorkspaceResponseDto })
  @ApiNotFoundResponse({ description: 'Missing, or the caller is not a member.' })
  @ApiConflictResponse({ description: 'The workspace is not archived.' })
  restore(@CurrentUser() user: AuthenticatedUser, @Param('workspaceId') workspaceId: string) {
    return this.workspaces.restore(user.userId, workspaceId);
  }
}
