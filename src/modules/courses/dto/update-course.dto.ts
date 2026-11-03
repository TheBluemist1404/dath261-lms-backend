import { PartialType } from '@nestjs/swagger';
import { CreateCourseDto } from './create-course.dto.js';

// lecturer có thể update những thông tin course giống với khi create
export class UpdateCourseDto extends PartialType(CreateCourseDto) {}
