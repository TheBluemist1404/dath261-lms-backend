import { ApiProperty } from '@nestjs/swagger';

export class DeadlineResponseDto {
  @ApiProperty({
    description: 'ID of the course the quiz belongs to.',
    example: 'clx123abc',
  })
  courseId: string;

  @ApiProperty({
    description: 'Title of the course.',
    example: 'Introduction to NestJS',
  })
  courseTitle: string;

  @ApiProperty({
    description: 'ID of the quiz block.',
    example: 'clx456def',
  })
  blockId: string;

  @ApiProperty({
    description: 'Title of the quiz block.',
    example: 'Week 1 quiz',
  })
  title: string;

  @ApiProperty({
    description: 'Quiz deadline.',
    example: '2026-03-15T23:59:00.000Z',
  })
  deadline: Date;

  @ApiProperty({
    description: 'Whether late submissions are allowed after the deadline.',
    example: false,
  })
  allowLate: boolean;

  @ApiProperty({
    description: 'Number of attempts the current student has already used.',
    example: 1,
  })
  attemptsUsed: number;

  @ApiProperty({
    description: 'Maximum number of attempts allowed for this quiz.',
    example: 3,
  })
  maxAttempts: number;
}
