import { ApiProperty } from '@nestjs/swagger';

export class UserStatsDto {
  @ApiProperty({ example: 120, description: 'Total number of users.' })
  total!: number;

  @ApiProperty({ example: 100 })
  students!: number;

  @ApiProperty({ example: 15 })
  lecturers!: number;

  @ApiProperty({ example: 5 })
  admins!: number;

  @ApiProperty({
    example: 3,
    description: 'Total suspended users across all roles.',
  })
  suspended!: number;
}

export class CourseStatsDto {
  @ApiProperty({ example: 50 })
  total!: number;

  @ApiProperty({ example: 35 })
  published!: number;

  @ApiProperty({ example: 15 })
  draft!: number;

  @ApiProperty({
    example: 2,
    description: 'Suspended courses, including either course status.',
  })
  suspended!: number;
}

export class EnrollmentStatsDto {
  @ApiProperty({ example: 300 })
  total!: number;

  @ApiProperty({ example: 120 })
  active!: number;

  @ApiProperty({ example: 150 })
  completed!: number;

  @ApiProperty({ example: 30 })
  left!: number;
}

export class PlatformStatsDto {
  @ApiProperty({ type: UserStatsDto })
  users!: UserStatsDto;

  @ApiProperty({ type: CourseStatsDto })
  courses!: CourseStatsDto;

  @ApiProperty({ type: EnrollmentStatsDto })
  enrollments!: EnrollmentStatsDto;

  @ApiProperty({
    example: 0.75,
    minimum: 0,
    maximum: 1,
    description: 'Completed enrollments divided by active plus completed enrollments.',
  })
  completionRate!: number;

  @ApiProperty({
    example: 0.82,
    nullable: true,
    description:
      'Mean graded quiz score divided by the total question points for each quiz block. Null when no valid scored attempts exist.',
  })
  averageQuizScore!: number | null;

  @ApiProperty({
    example: '2026-11-16T00:00:00.000Z',
    format: 'date-time',
  })
  generatedAt!: string;
}
