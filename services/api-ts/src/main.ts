import 'reflect-metadata';
import fastifyStatic from '@fastify/static';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { config } from './config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true }),
    { bufferLogs: false },
  );
  app.enableCors({ origin: true, credentials: false });
  app.setGlobalPrefix('v1');
  await app.register(fastifyStatic, {
    root: config.demoAssetsDir,
    prefix: '/demo-assets/',
    decorateReply: false,
  });
  const swaggerConfig = new DocumentBuilder()
    .setTitle('DAZZZZZZZZZ Runtime API — TypeScript')
    .setDescription('Runnable five-tab activity-social vertical slice')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('v1/docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
  process.stdout.write(
    `${JSON.stringify({ level: 'info', service: 'api-ts', event: 'started', port: config.port })}\n`,
  );
}

bootstrap().catch((error) => {
  process.stderr.write(`${JSON.stringify({ level: 'error', service: 'api-ts', error: error.message })}\n`);
  process.exit(1);
});
