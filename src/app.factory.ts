import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn', 'log'] });
  // Photos compressées côté téléphone (≤ 300 Ko chacune) envoyées en base64 : jusqu'à 3 par
  // demande de télé-expertise, soit ~1,3 Mo de JSON.
  app.useBodyParser('json', { limit: '1500kb' });
  const http = app.getHttpAdapter().getInstance();
  http.set('trust proxy', 1);
  http.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Swagger UI a besoin de styles et scripts en ligne sur /docs uniquement.
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          frameAncestors: ["'none'"],
        },
      },
      hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }),
  );
  // Pas de CORS : le frontend appelle l'API via un rewrite même origine (/api/*).

  const config = new DocumentBuilder()
    .setTitle('API Ganji')
    .setDescription(
      "La santé de chaque Béninois, à chaque moment de la vie. API unique pour le web, les SMS, l'USSD et la voix. " +
        'Authentification par cookie de session HttpOnly. Données personnelles fictives (démonstration).',
    )
    .setVersion('0.1.0')
    .addCookieAuth('ganji_session')
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, config), {
    customSiteTitle: 'API Ganji',
    jsonDocumentUrl: 'docs/openapi.json',
  });
  return app;
}
