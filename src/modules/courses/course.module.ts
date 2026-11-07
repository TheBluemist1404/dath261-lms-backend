import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { CourseController } from './course.controller.js';
import { CourseService } from './course.service.js';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [CourseController],
  providers: [CourseService],
  exports: [CourseService],
})
export class CourseModule {}
