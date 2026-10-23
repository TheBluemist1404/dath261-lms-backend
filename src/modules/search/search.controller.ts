import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '../../generated/prisma/enums.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type.js';
import { Roles } from '../authorization/roles.decorator.js';
import { RolesGuard } from '../authorization/roles.guard.js';
import { RecentPagesQueryDto } from './dto/recent-pages-query.dto.js';
import { PageHitResponseDto } from './dto/responses/page-hit-response.dto.js';
import { SearchPagesQueryDto } from './dto/search-pages-query.dto.js';
import { PageSearchService, SEARCH_RESULT_LIMIT } from './page-search.service.js';

@ApiTags('Page search')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Administrators have no workspaces.' })
@UseGuards(RolesGuard)
@Roles(UserRole.STUDENT, UserRole.LECTURER)
@Controller()
export class SearchController {
  constructor(private readonly search: PageSearchService) {}

  @Get('search/pages')
  @ApiOperation({
    summary: 'Search pages in my active workspaces',
    description: `Case-insensitive match on title or page text. Title matches first, then content matches, each newest first; at most ${SEARCH_RESULT_LIMIT} results.`,
  })
  @ApiOkResponse({ type: [PageHitResponseDto] })
  @ApiBadRequestResponse({ description: 'q shorter than 2 characters.' })
  searchPages(@CurrentUser() user: AuthenticatedUser, @Query() query: SearchPagesQueryDto) {
    return this.search.search(user.userId, query.q);
  }

  @Get('recent-pages')
  @ApiOperation({
    summary: 'Recently edited pages in my active workspaces',
    description: 'Newest updatedAt first. There is no visit history yet.',
  })
  @ApiOkResponse({ type: [PageHitResponseDto] })
  @ApiBadRequestResponse({ description: 'limit outside 1 to 20.' })
  recentPages(@CurrentUser() user: AuthenticatedUser, @Query() query: RecentPagesQueryDto) {
    return this.search.recent(user.userId, query.limit ?? 5);
  }
}
