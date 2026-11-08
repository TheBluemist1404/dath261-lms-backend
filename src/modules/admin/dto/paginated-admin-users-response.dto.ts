import { ApiProperty } from '@nestjs/swagger';
import { AdminUserItemDto } from './admin-user-item.dto.js';

export class PaginatedAdminUsersResponseDto {
  @ApiProperty({ type: [AdminUserItemDto] })
  items!: AdminUserItemDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  pageSize!: number;

  @ApiProperty({ example: 125 })
  total!: number;
}
