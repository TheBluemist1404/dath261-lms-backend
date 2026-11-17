import { Controller, Get, Param, Patch, Query, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type.js';
import { NotificationQueryDto } from './dto/notification-query.dto.js';
import { NotificationResponseDto } from './dto/notification-response.dto.js';
import { PaginatedNotificationResponseDto } from './dto/paginated-notification-response.dto.js';
import { ReadAllResponseDto } from './dto/read-all-response.dto.js';
import { NotificationService } from './notification.service.js';

@ApiTags('Notifications')
@ApiBearerAuth('access-token')
@Controller('users/me/notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @ApiOperation({
    summary: 'List my notifications',
    description:
      'Returns notifications belonging to the current user, newest first. ' +
      'Optionally filter to unread only. `meta.unreadCount` always reflects the ' +
      'total unread count for the user, independent of pagination and the filter.',
  })
  @ApiOkResponse({
    description: 'Paginated list of notifications.',
    type: PaginatedNotificationResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  list(@Req() req: { user: AuthenticatedUser }, @Query() query: NotificationQueryDto) {
    return this.notificationService.listMyNotifications(req.user.userId, query);
  }

  // IMPORTANT: must be declared before ':notificationId/read' so the literal
  // segment "read-all" is not captured as a notificationId.
  @Patch('read-all')
  @ApiOperation({
    summary: 'Mark all my notifications as read',
    description:
      'Sets readAt on every unread notification of the current user. ' +
      'Returns the number of rows updated (0 when nothing was unread).',
  })
  @ApiOkResponse({
    description: 'Number of notifications marked as read.',
    type: ReadAllResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  markAllRead(@Req() req: { user: AuthenticatedUser }) {
    return this.notificationService.markAllRead(req.user.userId);
  }

  @Patch(':notificationId/read')
  @ApiOperation({
    summary: 'Mark one of my notifications as read',
    description:
      'Sets readAt on the given notification. Returns 404 if the notification ' +
      'does not exist or belongs to another user.',
  })
  @ApiParam({
    name: 'notificationId',
    description: 'The ID of the notification',
    example: 'clx123abc',
  })
  @ApiOkResponse({
    description: 'The updated notification.',
    type: NotificationResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  @ApiNotFoundResponse({
    description: 'Notification not found, or it belongs to another user.',
  })
  markRead(
    @Req() req: { user: AuthenticatedUser },
    @Param('notificationId') notificationId: string,
  ) {
    return this.notificationService.markRead(req.user.userId, notificationId);
  }
}
