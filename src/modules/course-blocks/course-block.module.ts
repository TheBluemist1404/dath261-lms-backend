import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { EnrollmentModule } from '../enrollments/enrollment.module.js';
import { CourseBlockController } from './course-block.controller.js';
import { CourseBlockService } from './course-block.service.js';

@Module({
  imports: [PrismaModule, EnrollmentModule],
  controllers: [CourseBlockController],
  providers: [CourseBlockService],
  exports: [CourseBlockService],
})
export class CourseBlockModule {}
