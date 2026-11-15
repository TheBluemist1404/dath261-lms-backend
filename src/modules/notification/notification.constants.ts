/**
 * String values stored in `Notification.targetType`.
 *
 * The Prisma schema declares `targetType` as `String?` (not an enum), so we
 * centralise the allowed values here instead of scattering literals around.
 */
export const NOTIFICATION_TARGET_TYPE = {
  COURSE: 'COURSE',
  COURSE_BLOCK: 'COURSE_BLOCK',
} as const;

export type NotificationTargetType =
  (typeof NOTIFICATION_TARGET_TYPE)[keyof typeof NOTIFICATION_TARGET_TYPE];
