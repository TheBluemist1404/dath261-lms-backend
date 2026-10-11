import { Controller, Get } from '@nestjs/common';
import { Public } from '../modules/auth/decorators/public.decorator.js';

@Public()
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
