import { type INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';

// HTTP pipeline shared by the server and the E2E tests, so tests hit the same
// routes and validation rules as production.
export function configureApp(app: INestApplication): void {
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
