import { Module } from '@nestjs/common';
import { PrismaModule } from '../infrastructure/database/prisma/prisma.module.js';
import { CourseBlockController } from './courseblock.controller.js';
import { CourseBlockService } from './courseblock.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [CourseBlockController],
  providers: [CourseBlockService],
  exports: [CourseBlockService],
})
export class CourseBlockModule {}
