import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global validation — whitelist strips unknown fields (mass assignment protection)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,           // strip fields not in DTO
      forbidNonWhitelisted: true, // throw if unknown fields sent
      transform: true,           // auto-cast types (string→number for query params)
    }),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`meCash API running on http://localhost:${port}`);
}

bootstrap();
