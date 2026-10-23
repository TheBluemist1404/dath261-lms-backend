import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

const booleans: Record<string, boolean> = { true: true, false: false };

export class ListWorkspacesQueryDto {
  @ApiPropertyOptional({ description: 'List archived workspaces instead of active ones.' })
  @IsOptional()
  @Transform(({ value }) => booleans[value as string] ?? value)
  @IsBoolean()
  archived?: boolean;
}
