import path from 'node:path';

function integer(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
}

export const config = {
  implementation: 'ts' as const,
  port: integer('TS_API_PORT', 3100),
  publicBaseUrl: process.env.TS_PUBLIC_BASE_URL ?? 'http://127.0.0.1:3100',
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://dachang:dachang@127.0.0.1:5432/dachang',
  redisUrl: process.env.REDIS_URL ?? 'redis://:dachang@127.0.0.1:6379/0',
  rabbitmqUrl: process.env.RABBITMQ_URL ?? 'amqp://dachang:dachang@127.0.0.1:5672',
  s3: {
    endPoint: process.env.S3_ENDPOINT ?? '127.0.0.1',
    port: integer('S3_PORT', 9000),
    useSSL: (process.env.S3_USE_SSL ?? 'false') === 'true',
    accessKey: process.env.S3_ACCESS_KEY ?? 'dachang',
    secretKey: process.env.S3_SECRET_KEY ?? 'dachang-local-secret',
    bucket: process.env.S3_BUCKET ?? 'media',
  },
  authToken: process.env.DEMO_AUTH_TOKEN ?? 'demo-user',
  demoUserId: '11111111-1111-4111-8111-111111111111',
  model: {
    provider: process.env.MODEL_PROVIDER ?? 'local-deterministic',
    baseUrl: process.env.MODEL_BASE_URL ?? '',
    apiKey: process.env.MODEL_API_KEY ?? '',
    name: process.env.MODEL_NAME ?? 'dachang-local-v1',
  },
  demoAssetsDir:
    process.env.DEMO_ASSETS_DIR ??
    path.resolve(process.cwd(), '../../activity-social-app-product/prototype/assets'),
};
