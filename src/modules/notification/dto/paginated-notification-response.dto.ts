import { ApiProperty } from '@nestjs/swagger';
import { NotificationResponseDto } from './notification-response.dto.js';

export class NotificationPaginationMetaDto {
  @ApiProperty({ description: 'Total number of matching notifications.', example: 42 })
  total: number;

  @ApiProperty({ description: 'Current page (1-based).', example: 1 })
  page: number;

  @ApiProperty({ description: 'Number of items per page.', example: 20 })
  limit: number;

  @ApiProperty({ description: 'Total number of pages.', example: 3 })
  totalPages: number;

  @ApiProperty({ description: 'Whether a next page exists.', example: true })
  hasNextPage: boolean;

  @ApiProperty({ description: 'Whether a previous page exists.', example: false })
  hasPrevPage: boolean;

  @ApiProperty({
    description:
      'Total unread notifications for the current user, independent of ' +
      'pagination and the `unread` filter.',
    example: 7,
  })
  unreadCount: number;
}

export class PaginatedNotificationResponseDto {
  @ApiProperty({ type: [NotificationResponseDto] })
  data: NotificationResponseDto[];

  @ApiProperty({ type: NotificationPaginationMetaDto })
  meta: NotificationPaginationMetaDto;
}
