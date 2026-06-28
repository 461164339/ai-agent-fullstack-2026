import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import { json, urlencoded, type Request, type Response } from 'express';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { Env } from './config/env.validation';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
  });
  const configService = app.get<ConfigService<Env, true>>(ConfigService);
  const port = configService.getOrThrow<number>('PORT');

  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));
  app.use(helmet());
  app.use(
    compression({
      filter: (request: Request, response: Response) => {
        if (request.headers.accept?.includes('text/event-stream')) {
          return false;
        }

        return compression.filter(request, response);
      },
    }),
  );
  app.enableCors({
    origin: true,
    credentials: true,
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('AI Agent NestJS')
    .setDescription(
      'Local-first RAG, multimodal attachments, SSE streaming, and LangGraph agent API.',
    )
    .setVersion('0.1.0')
    .addServer('/api', 'API global prefix')
    .addTag('rag')
    .addTag('agents')
    .addTag('health')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'AI Agent API Docs',
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  await app.listen(port);
}
void bootstrap();
