import { ArrayUnique, IsArray, IsString } from 'class-validator';

export class ReorderCourseBlocksDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  blockIds: string[];
}
