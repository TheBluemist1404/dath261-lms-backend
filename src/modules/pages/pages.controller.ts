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
import { CreatePageDto } from './dto/create-page.dto.js';
import { ListPagesQueryDto } from './dto/list-pages-query.dto.js';
import { PageResponseDto, PageSummaryResponseDto } from './dto/responses/page-response.dto.js';
import { UpdatePageDto } from './dto/update-page.dto.js';
import { PagesService } from './pages.service.js';

@ApiTags('Pages')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Administrators have no workspaces.' })
@ApiNotFoundResponse({ description: 'Missing, or the caller is not a member of the workspace.' })
@UseGuards(RolesGuard)
@Roles(UserRole.STUDENT, UserRole.LECTURER)
@Controller()
export class PagesController {
  constructor(private readonly pages: PagesService) {}

  @Get('workspaces/:workspaceId/pages')
  @ApiOperation({
    summary: 'List the pages of a workspace',
    description:
      'A flat list without content; the client builds the tree from parentPageId. Active pages by default, archived ones with archived=true.',
  })
  @ApiOkResponse({ type: [PageSummaryResponseDto] })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
    @Query() query: ListPagesQueryDto,
  ) {
    return this.pages.list(user.userId, workspaceId, query.archived ?? false);
  }

  @Post('workspaces/:workspaceId/pages')
  @ApiOperation({ summary: 'Create a page, optionally under a parent page' })
  @ApiCreatedResponse({ type: PageResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid title, or the parent is not in this workspace.' })
  @ApiConflictResponse({ description: 'The workspace is archived.' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CreatePageDto,
  ) {
    return this.pages.create(user.userId, workspaceId, dto);
  }

  @Get('pages/:pageId')
  @ApiOperation({ summary: 'Get a page with its content' })
  @ApiOkResponse({ type: PageResponseDto })
  get(@CurrentUser() user: AuthenticatedUser, @Param('pageId') pageId: string) {
    return this.pages.get(user.userId, pageId);
  }

  @Patch('pages/:pageId')
  @ApiOperation({ summary: 'Rename, move or save the content of a page' })
  @ApiOkResponse({ type: PageResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid title, or a move under itself, a descendant or an archived page.',
  })
  @ApiConflictResponse({ description: 'The page or its workspace is archived.' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('pageId') pageId: string,
    @Body() dto: UpdatePageDto,
  ) {
    return this.pages.update(user.userId, pageId, dto);
  }

  @Post('pages/:pageId/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Archive a page and its subpages',
    description:
      'Archived pages leave the page tree, search and recent pages, and become read-only. Content, references and messages are kept.',
  })
  @ApiOkResponse({ type: PageResponseDto })
  @ApiConflictResponse({ description: 'Already archived, or the workspace is archived.' })
  archive(@CurrentUser() user: AuthenticatedUser, @Param('pageId') pageId: string) {
    return this.pages.archive(user.userId, pageId);
  }

  @Post('pages/:pageId/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Restore an archived page',
    description:
      'Restores the page with the subpages archived together with it. It returns under its parent while that parent is active, otherwise to the workspace root.',
  })
  @ApiOkResponse({ type: PageResponseDto })
  @ApiConflictResponse({ description: 'Not archived, or the workspace is archived.' })
  restore(@CurrentUser() user: AuthenticatedUser, @Param('pageId') pageId: string) {
    return this.pages.restore(user.userId, pageId);
  }

  @Delete('pages/:pageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a page and its subpages' })
  @ApiNoContentResponse({ description: 'Deleted.' })
  @ApiConflictResponse({ description: 'The workspace is archived.' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('pageId') pageId: string) {
    return this.pages.remove(user.userId, pageId);
  }
}
