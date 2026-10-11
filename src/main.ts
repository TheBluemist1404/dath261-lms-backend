import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.enableShutdownHooks();

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

  const corsOrigin = configService.get<string>('CORS_ORIGIN') ?? 'http://localhost:3000';

  app.enableCors({
    origin: corsOrigin === '*' ? '*' : corsOrigin.split(',').map((origin) => origin.trim()),
    credentials: true,
  });

  if (configService.get<boolean>('SWAGGER_ENABLED') ?? false) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('DATN 261 Learner-Oriented LMS API')
      .setDescription('REST API for the DATN 261 Learner-Oriented Learning Management System.')
      .setVersion('1.0')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  const port = configService.get<number>('PORT') ?? 3001;
  await app.listen(port);
}

void bootstrap();
