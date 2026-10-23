import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { PageSearchService } from './page-search.service.js';
import { SearchController } from './search.controller.js';

@Module({
  imports: [PrismaModule],
  controllers: [SearchController],
  providers: [PageSearchService],
})
export class SearchModule {}
