import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { validateEnvironment } from './config/env.validation.js';
import { CourseBlockModule } from './courseblock/courseblock.module.js';
import { HealthModule } from './health/health.module.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { AccessTokenGuard } from './modules/auth/guards/access-token.guard.js';
import { CollaborationModule } from './modules/collaboration/collaboration.module.js';
import { DiscussionModule } from './modules/discussion/discussion.module.js';
import { PagesModule } from './modules/pages/pages.module.js';
import { ReferencesModule } from './modules/references/references.module.js';
import { SearchModule } from './modules/search/search.module.js';
import { WorkspacesModule } from './modules/workspaces/workspaces.module.js';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
      envFilePath: '.env',
    }),
    DatabaseModule,
    HealthModule,
    CourseBlockModule,
    //CourseModule,
    AuthModule,
    CollaborationModule,
    WorkspacesModule,
    PagesModule,
    DiscussionModule,
    ReferencesModule,
    SearchModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AccessTokenGuard,
    },
  ],
})
export class AppModule {}
