// quiz.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { EnrollmentModule } from '../enrollments/enrollment.module.js';
import { QuizController } from './quiz.controller.js';
import { QuizService } from './quiz.service.js';
import { QuizGradingService } from './quiz-grading.service.js';

@Module({
  imports: [PrismaModule, EnrollmentModule],
  controllers: [QuizController],
  providers: [QuizService, QuizGradingService],
  exports: [QuizService, QuizGradingService],
})
export class QuizModule {}
