import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';

import { EnrollmentController } from './enrollment.controller.js';
import { EnrollmentService } from './enrollment.service.js';

@Module({
  imports: [DatabaseModule, AuthorizationModule],
  controllers: [EnrollmentController],
  providers: [EnrollmentService],
  exports: [EnrollmentService],
})
export class EnrollmentModule {}
