import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { config } from './config';

/** Configuration commune à l'application et aux tests. */
export function setup(app: NestExpressApplication) {
  if (config.TRUST_PROXY) app.set('trust proxy', config.TRUST_PROXY);
  app.use(helmet());
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  return app;
}

export async function bootstrap() {
  const app = setup(await NestFactory.create<NestExpressApplication>(AppModule));
  // L'API sert aussi l'interface (image Docker unique) ; toute route non /api renvoie la SPA.
  if (existsSync(config.WEB_DIST)) {
    app.useStaticAssets(config.WEB_DIST, { index: false });
    app.use((req: Request, res: Response, next: NextFunction) =>
      req.method === 'GET' && !req.path.startsWith('/api') ? res.sendFile(join(config.WEB_DIST, 'index.html')) : next(),
    );
  }
  await app.listen(config.PORT);
}

if (require.main === module) void bootstrap();
