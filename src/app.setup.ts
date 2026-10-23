import { RequestMethod, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';

// HTTP pipeline shared by the server and the E2E tests, so tests hit the same
// routes and validation rules as production.
export function configureApp(app: NestExpressApplication): void {
  // Page content is a whole editor document, which outgrows the 100 kB default.
  app.useBodyParser('json', { limit: '2mb' });

  app.setGlobalPrefix('api', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.use(cookieParser());
}
