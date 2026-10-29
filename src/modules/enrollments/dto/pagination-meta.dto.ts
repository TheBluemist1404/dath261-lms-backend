import { ApiProperty } from '@nestjs/swagger';

export class PaginationMetaDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 10 })
  limit!: number;

  @ApiProperty({
    description: 'Total number of matching enrollments',
    example: 42,
  })
  total!: number;

  @ApiProperty({
    description: 'Total number of pages; zero when there are no records',
    example: 5,
  })
  totalPages!: number;

  @ApiProperty({ example: true })
  hasNextPage!: boolean;

  @ApiProperty({ example: false })
  hasPreviousPage!: boolean;
}
