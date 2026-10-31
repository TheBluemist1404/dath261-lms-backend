import { ArrayMinSize, ArrayUnique, IsArray, IsString } from 'class-validator';

export class ReorderCourseBlocksDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMinSize(1)
  @IsString({ each: true })
  blockIds: string[];
}
