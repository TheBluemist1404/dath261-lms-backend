import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { EnrollmentModule } from '../enrollments/enrollment.module.js';
import { ProgressController } from './progress.controller.js';
import { ProgressService } from './progress.service.js';

@Module({
  imports: [DatabaseModule, AuthorizationModule, EnrollmentModule],
  controllers: [ProgressController],
  providers: [ProgressService],
  exports: [ProgressService],
})
export class ProgressModule {}
