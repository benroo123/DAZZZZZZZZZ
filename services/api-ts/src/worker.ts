import { createHash, randomUUID } from 'node:crypto';
import type { ConsumeMessage } from 'amqplib';
import { config } from './config';
import { InfraService } from './infra.service';

interface EventEnvelope {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  occurredAt: string;
  payload: Record<string, any>;
}

const infra = new InfraService();
let running = true;

function escapeXml(value: string): string {
  return value.replace(/[<>&'\"]/g, (char) => {
    const values: Record<string, string> = {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      "'": '&apos;',
      '"': '&quot;',
    };
    return values[char];
  });
}

function generatedCover(prompt: string): Buffer {
  const title = escapeXml(prompt.replace(/\s+/g, ' ').slice(0, 28));
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0A84FF"/><stop offset="0.52" stop-color="#713CFF"/><stop offset="1" stop-color="#FF694A"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="900" fill="url(#g)"/>
  <circle cx="1010" cy="170" r="210" fill="#C7FF22" opacity=".82"/>
  <circle cx="170" cy="760" r="260" fill="#8EE8FF" opacity=".32"/>
  <text x="80" y="92" fill="#fff" font-family="system-ui,sans-serif" font-size="30" font-weight="700">搭场 · AI 活动封面</text>
  <text x="80" y="470" fill="#fff" font-family="system-ui,sans-serif" font-size="62" font-weight="800">${title}</text>
  <text x="80" y="535" fill="#fff" opacity=".82" font-family="system-ui,sans-serif" font-size="28">让想法成为一次真实见面</text>
  <rect x="80" y="720" rx="24" width="205" height="58" fill="#000" opacity=".45"/>
  <text x="112" y="758" fill="#fff" font-family="system-ui,sans-serif" font-size="23">AI 生成内容</text>
</svg>`);
}

async function publishOutbox(): Promise<void> {
  const client = await infra.pool.connect();
  try {
    await client.query('begin');
    const result = await client.query(
      `select id, aggregate_type, aggregate_id, event_type, payload, occurred_at
       from app.outbox_events
       where published_at is null and payload->>'implementation' = $1
       order by occurred_at, id for update skip locked limit 20`,
      [config.implementation],
    );
    for (const row of result.rows) {
      const envelope: EventEnvelope = {
        id: row.id,
        eventType: row.event_type,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        occurredAt: row.occurred_at,
        payload: row.payload,
      };
      const routingKey = `${config.implementation}.${row.event_type}`;
      const accepted = infra.mqChannel.publish(
        'dachang.events',
        routingKey,
        Buffer.from(JSON.stringify(envelope)),
        { persistent: true, messageId: row.id, contentType: 'application/json' },
      );
      if (!accepted) await new Promise((resolve) => infra.mqChannel.once('drain', resolve));
      await infra.mqChannel.waitForConfirms();
      await client.query(
        `update app.outbox_events set published_at = now(), attempts = attempts + 1 where id = $1`,
        [row.id],
      );
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    process.stderr.write(
      `${JSON.stringify({ level: 'error', service: 'worker-ts', event: 'outbox_publish_failed', error: (error as Error).message })}\n`,
    );
  } finally {
    client.release();
  }
}

async function ensureGeneratedAsset(
  client: any,
  payload: Record<string, any>,
  ownerId: string,
): Promise<string> {
  if (!payload.needsAiCover && payload.purpose === undefined) return '';
  if (payload.aiJobId) {
    const existing = await client.query(
      `select output_media_id from app.ai_generation_jobs where id = $1 and output_media_id is not null`,
      [payload.aiJobId],
    );
    if (existing.rowCount) return existing.rows[0].output_media_id;
  }
  const mediaId = randomUUID();
  const bytes = generatedCover(payload.prompt || '一起活动');
  const objectKey = `generated/${ownerId}/${mediaId}.svg`;
  await infra.s3.putObject(config.s3.bucket, objectKey, bytes, bytes.length, {
    'Content-Type': 'image/svg+xml',
    'X-Amz-Meta-Ai-Generated': 'true',
  });
  const digest = createHash('sha256').update(bytes).digest('hex');
  await client.query(
    `insert into app.media_assets
     (id, owner_user_id, purpose, storage_key, mime_type, byte_size, width, height,
      sha256, moderation_status, ai_generated, ai_label_version, provenance, exif_removed)
     values ($1, $2, 'ai_cover', $3, 'image/svg+xml', $4, 1200, 900, $5, 'approved', true, 'v1', $6, true)`,
    [
      mediaId,
      ownerId,
      objectKey,
      bytes.length,
      digest,
      JSON.stringify({ provider: config.model.provider, model: config.model.name, localDeterministic: true }),
    ],
  );
  if (payload.aiJobId) {
    await client.query(
      `update app.ai_generation_jobs set status = 'succeeded', output_media_id = $2,
       started_at = coalesce(started_at, now()), completed_at = now() where id = $1`,
      [payload.aiJobId, mediaId],
    );
  }
  return mediaId;
}

async function processEvent(event: EventEnvelope): Promise<void> {
  if (event.eventType === 'media.upload.completed') {
    const stat = await infra.s3.statObject(config.s3.bucket, event.payload.objectKey);
    const client = await infra.pool.connect();
    try {
      await client.query('begin');
      const claim = await client.query(
        `insert into app.processed_events (consumer_name, event_id) values ('worker-ts', $1)
         on conflict do nothing returning event_id`,
        [event.id],
      );
      if (!claim.rowCount) {
        await client.query('commit');
        return;
      }
      await client.query(
        `update app.media_assets set byte_size = $2, moderation_status = 'approved', exif_removed = true
         where id = $1`,
        [event.payload.mediaId, stat.size],
      );
      await client.query(
        `update app.media_upload_sessions set status = 'completed', completed_at = now() where id = $1`,
        [event.payload.uploadId],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    return;
  }

  const client = await infra.pool.connect();
  try {
    await client.query('begin');
    const claim = await client.query(
      `insert into app.processed_events (consumer_name, event_id) values ('worker-ts', $1)
       on conflict do nothing returning event_id`,
      [event.id],
    );
    if (!claim.rowCount) {
      await client.query('commit');
      return;
    }
    if (event.eventType === 'post.submitted') {
      if (event.payload.needsAiCover) {
        const mediaId = await ensureGeneratedAsset(client, event.payload, event.payload.userId);
        await client.query(
          `insert into app.post_media (post_id, media_asset_id, position) values ($1, $2, 0)
           on conflict (post_id, position) do nothing`,
          [event.payload.postId, mediaId],
        );
      }
      await client.query(
        `update app.posts set status = 'published', moderation_status = 'approved',
         published_at = now(), updated_at = now() where id = $1`,
        [event.payload.postId],
      );
    } else if (event.eventType === 'activity.submitted') {
      if (event.payload.needsAiCover) {
        const mediaId = await ensureGeneratedAsset(client, event.payload, event.payload.userId);
        await client.query(
          `insert into app.activity_media (activity_id, media_asset_id, position) values ($1, $2, 0)
           on conflict (activity_id, position) do nothing`,
          [event.payload.activityId, mediaId],
        );
      }
      await client.query(
        `update app.activities set status = 'published', moderation_status = 'approved',
         published_at = now(), updated_at = now() where id = $1`,
        [event.payload.activityId],
      );
    } else if (event.eventType === 'ai.generation.requested') {
      const mediaId = await ensureGeneratedAsset(
        client,
        { ...event.payload, aiJobId: event.payload.jobId },
        event.payload.userId,
      );
      if (!mediaId) throw new Error('AI generation did not produce an asset');
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
  const keys = await infra.redis.keys(`feed:${config.implementation}:*`);
  if (keys.length) await infra.redis.del(...keys);
}

async function handleMessage(message: ConsumeMessage | null): Promise<void> {
  if (!message) return;
  let event: EventEnvelope;
  try {
    event = JSON.parse(message.content.toString('utf8'));
    await processEvent(event);
    infra.mqChannel.ack(message);
    process.stdout.write(
      `${JSON.stringify({ level: 'info', service: 'worker-ts', event: event.eventType, eventId: event.id, outcome: 'succeeded' })}\n`,
    );
  } catch (error) {
    const retries = Number(message.properties.headers?.['x-retry-count'] ?? 0);
    const routingKey = retries >= 3 ? `${config.implementation}.dead` : `${config.implementation}.retry`;
    infra.mqChannel.publish(
      'dachang.events.dlx',
      routingKey,
      message.content,
      {
        persistent: true,
        messageId: message.properties.messageId,
        headers: { 'x-retry-count': retries + 1 },
      },
    );
    infra.mqChannel.ack(message);
    process.stderr.write(
      `${JSON.stringify({ level: 'error', service: 'worker-ts', eventId: message.properties.messageId, retries, error: (error as Error).message })}\n`,
    );
  }
}

async function main(): Promise<void> {
  await infra.onModuleInit();
  await infra.mqChannel.prefetch(10);
  await infra.mqChannel.consume(`dachang.publication.${config.implementation}`, (message) => {
    void handleMessage(message);
  });
  process.stdout.write(`${JSON.stringify({ level: 'info', service: 'worker-ts', event: 'started' })}\n`);
  while (running) {
    await publishOutbox();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await infra.close();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    running = false;
  });
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ level: 'error', service: 'worker-ts', error: error.message })}\n`);
  process.exit(1);
});
