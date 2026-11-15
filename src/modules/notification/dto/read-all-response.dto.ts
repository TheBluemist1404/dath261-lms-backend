import { ApiProperty } from '@nestjs/swagger';

export class ReadAllResponseDto {
  @ApiProperty({
    description: 'Number of notifications that were marked as read by this call.',
    example: 7,
  })
  updated: number;
}
