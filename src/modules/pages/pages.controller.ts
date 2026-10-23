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
    description: 'A flat list without content; the client builds the tree from parentPageId.',
  })
  @ApiOkResponse({ type: [PageSummaryResponseDto] })
  list(@CurrentUser() user: AuthenticatedUser, @Param('workspaceId') workspaceId: string) {
    return this.pages.list(user.userId, workspaceId);
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
  @ApiBadRequestResponse({ description: 'Invalid title, or a move under itself or a descendant.' })
  @ApiConflictResponse({ description: 'The workspace is archived.' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('pageId') pageId: string,
    @Body() dto: UpdatePageDto,
  ) {
    return this.pages.update(user.userId, pageId, dto);
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
