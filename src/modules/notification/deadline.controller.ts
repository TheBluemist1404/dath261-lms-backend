import { Controller, Get, Query, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type.js';
import { DeadlineService } from './deadline.service.js';
import { DeadlineQueryDto } from './dto/deadline-query.dto.js';
import { DeadlineResponseDto } from './dto/deadline-response.dto.js';

@ApiTags('Deadlines')
@ApiBearerAuth('access-token')
@Controller('users/me/deadlines')
export class DeadlineController {
  constructor(private readonly deadlineService: DeadlineService) {}

  @Get()
  @ApiOperation({
    summary: 'List upcoming quiz deadlines in my active enrollments',
    description:
      'Returns quizzes in the current student\u2019s ACTIVE enrollments whose ' +
      'deadline falls within [now, now + days]. Draft and suspended courses are ' +
      'excluded. Sorted soonest first.',
  })
  @ApiOkResponse({
    description: 'Upcoming deadlines sorted by deadline ascending.',
    type: [DeadlineResponseDto],
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  list(@Req() req: { user: AuthenticatedUser }, @Query() query: DeadlineQueryDto) {
    return this.deadlineService.listMyDeadlines(req.user.userId, query);
  }
}
