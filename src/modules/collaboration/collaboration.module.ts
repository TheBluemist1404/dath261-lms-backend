import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { CollaborationService } from './collaboration.service.js';

// Global so workspace and page services can end live sessions without a module cycle.
@Global()
@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      }),
    }),
  ],
  providers: [CollaborationService],
  exports: [CollaborationService],
})
export class CollaborationModule {}
