// paginated-quiz-attempt-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { QuizAttemptDetailResponseDto } from './quiz-attempt-detail-response.dto.js';

export class QuizAttemptPaginationMetaDto {
  @ApiProperty({ description: 'Total number of attempts matching the query.', example: 42 })
  total: number;

  @ApiProperty({ description: 'Current page (1-based).', example: 1 })
  page: number;

  @ApiProperty({ description: 'Page size.', example: 20 })
  limit: number;

  @ApiProperty({ description: 'Total number of pages.', example: 3 })
  totalPages: number;

  @ApiProperty({ description: 'Whether a next page exists.', example: true })
  hasNextPage: boolean;

  @ApiProperty({ description: 'Whether a previous page exists.', example: false })
  hasPrevPage: boolean;
}

export class PaginatedQuizAttemptResponseDto {
  @ApiProperty({
    description: 'Page of attempts.',
    type: [QuizAttemptDetailResponseDto],
  })
  data: QuizAttemptDetailResponseDto[];

  @ApiProperty({ description: 'Pagination metadata.', type: QuizAttemptPaginationMetaDto })
  meta: QuizAttemptPaginationMetaDto;
}
