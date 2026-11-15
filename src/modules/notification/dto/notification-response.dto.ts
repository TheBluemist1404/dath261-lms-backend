import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationType } from '../../../generated/prisma/enums.js';

export class NotificationResponseDto {
  @ApiProperty({
    description: 'Unique identifier of the notification.',
    example: 'clx123abc',
  })
  id: string;

  @ApiProperty({
    description: 'Notification type.',
    enum: NotificationType,
    example: NotificationType.NEW_CONTENT,
  })
  type: NotificationType;

  @ApiProperty({
    description: 'Short title of the notification.',
    example: 'New content in Introduction to NestJS',
  })
  title: string;

  @ApiProperty({
    description: 'Human-readable message body.',
    example: 'Week 2 was added.',
  })
  message: string;

  @ApiPropertyOptional({
    description:
      'Target resource type. "COURSE" means targetId is a course ID; ' +
      '"COURSE_BLOCK" means targetId is a course-block ID.',
    example: 'COURSE_BLOCK',
    nullable: true,
  })
  targetType: string | null;

  @ApiPropertyOptional({
    description: 'Target resource ID (matches targetType).',
    example: 'clx456def',
    nullable: true,
  })
  targetId: string | null;

  @ApiPropertyOptional({
    description:
      'Owning course ID, derived from targetType/targetId. ' +
      'Null when the target cannot be resolved (e.g. deleted resource).',
    example: 'clx789ghi',
    nullable: true,
  })
  courseId: string | null;

  @ApiPropertyOptional({
    description: 'When the notification was marked as read, or null if unread.',
    example: '2026-03-01T10:00:00.000Z',
    nullable: true,
  })
  readAt: Date | null;

  @ApiProperty({
    description: 'When the notification was created.',
    example: '2026-02-28T09:00:00.000Z',
  })
  createdAt: Date;
}
