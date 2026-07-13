import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import amqp, { ChannelModel, ConfirmChannel } from 'amqplib';
import Redis from 'ioredis';
import { Client as MinioClient } from 'minio';
import { Pool } from 'pg';
import { config } from './config';

@Injectable()
export class InfraService implements OnModuleInit, OnModuleDestroy {
  readonly pool = new Pool({ connectionString: config.databaseUrl, max: 20 });
  readonly redis = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
  });
  readonly s3 = new MinioClient(config.s3);
  mqConnection!: ChannelModel;
  mqChannel!: ConfirmChannel;

  async onModuleInit(): Promise<void> {
    await this.pool.query('select 1');
    await this.redis.ping();
    this.mqConnection = await amqp.connect(config.rabbitmqUrl);
    this.mqChannel = await this.mqConnection.createConfirmChannel();
    await this.ensureMessagingTopology(config.implementation);
    const exists = await this.s3.bucketExists(config.s3.bucket);
    if (!exists) await this.s3.makeBucket(config.s3.bucket);
  }

  async ensureMessagingTopology(implementation: string): Promise<void> {
    const channel = this.mqChannel;
    await channel.assertExchange('dachang.events', 'topic', { durable: true });
    await channel.assertExchange('dachang.events.dlx', 'topic', { durable: true });
    const queue = `dachang.publication.${implementation}`;
    const retryQueue = `${queue}.retry`;
    const deadQueue = `${queue}.dead`;
    await channel.assertQueue(queue, {
      durable: true,
      arguments: { 'x-dead-letter-exchange': 'dachang.events.dlx' },
    });
    await channel.assertQueue(retryQueue, {
      durable: true,
      arguments: {
        'x-message-ttl': 1000,
        'x-dead-letter-exchange': 'dachang.events',
      },
    });
    await channel.assertQueue(deadQueue, { durable: true });
    await channel.bindQueue(queue, 'dachang.events', `${implementation}.#`);
    await channel.bindQueue(retryQueue, 'dachang.events.dlx', `${implementation}.retry`);
    await channel.bindQueue(deadQueue, 'dachang.events.dlx', `${implementation}.dead`);
  }

  async health(): Promise<Record<string, string>> {
    const checks: Record<string, string> = {};
    const check = async (name: string, action: () => Promise<unknown>) => {
      try {
        await action();
        checks[name] = 'up';
      } catch {
        checks[name] = 'down';
      }
    };
    await Promise.all([
      check('postgres', () => this.pool.query('select 1')),
      check('redis', () => this.redis.ping()),
      check('rabbitmq', () => this.mqChannel.checkExchange('dachang.events')),
      check('objectStorage', () => this.s3.bucketExists(config.s3.bucket)),
    ]);
    return checks;
  }

  async close(): Promise<void> {
    await Promise.allSettled([
      this.pool.end(),
      this.redis.quit(),
      this.mqChannel?.close(),
      this.mqConnection?.close(),
    ]);
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }
}
