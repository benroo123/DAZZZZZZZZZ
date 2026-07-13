import hashlib
import io
import json
import signal
import time
from html import escape
from typing import Any
from uuid import uuid4

import pika
from psycopg.types.json import Jsonb

from .config import settings
from .infra import configure_topology, infra

running = True


def generated_cover(prompt: str) -> bytes:
    title = escape(" ".join(prompt.split())[:28])
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#0A84FF"/><stop offset="0.52" stop-color="#713CFF"/><stop offset="1" stop-color="#FF694A"/>
  </linearGradient></defs>
  <rect width="1200" height="900" fill="url(#g)"/>
  <circle cx="1010" cy="170" r="210" fill="#C7FF22" opacity=".82"/>
  <circle cx="170" cy="760" r="260" fill="#8EE8FF" opacity=".32"/>
  <text x="80" y="92" fill="#fff" font-family="system-ui,sans-serif" font-size="30" font-weight="700">DAZZZZZZZZZ · AI 活动封面</text>
  <text x="80" y="470" fill="#fff" font-family="system-ui,sans-serif" font-size="62" font-weight="800">{title}</text>
  <text x="80" y="535" fill="#fff" opacity=".82" font-family="system-ui,sans-serif" font-size="28">让想法成为一次真实见面</text>
  <rect x="80" y="720" rx="24" width="205" height="58" fill="#000" opacity=".45"/>
  <text x="112" y="758" fill="#fff" font-family="system-ui,sans-serif" font-size="23">AI 生成内容</text>
</svg>""".encode()


def publish_outbox(channel: pika.adapters.blocking_connection.BlockingChannel) -> None:
    with infra.connection() as connection, connection.transaction():
        rows = connection.execute(
            """
            select id, aggregate_type, aggregate_id, event_type, payload, occurred_at
            from app.outbox_events
            where published_at is null and payload->>'implementation' = %s
            order by occurred_at, id for update skip locked limit 20
            """,
            (settings.implementation,),
        ).fetchall()
        for row in rows:
            envelope = {
                "id": row["id"],
                "eventType": row["event_type"],
                "aggregateType": row["aggregate_type"],
                "aggregateId": row["aggregate_id"],
                "occurredAt": row["occurred_at"],
                "payload": row["payload"],
            }
            channel.basic_publish(
                exchange="dachang.events",
                routing_key=f'{settings.implementation}.{row["event_type"]}',
                body=json.dumps(envelope, default=str, ensure_ascii=False).encode(),
                properties=pika.BasicProperties(
                    delivery_mode=pika.DeliveryMode.Persistent,
                    message_id=str(row["id"]),
                    content_type="application/json",
                ),
                mandatory=True,
            )
            connection.execute(
                "update app.outbox_events set published_at = now(), attempts = attempts + 1 where id = %s",
                (row["id"],),
            )


def ensure_asset(connection: Any, payload: dict[str, Any], owner_id: str) -> str:
    if not payload.get("needsAiCover") and "purpose" not in payload:
        return ""
    if payload.get("aiJobId"):
        existing = connection.execute(
            "select output_media_id from app.ai_generation_jobs where id = %s and output_media_id is not null",
            (payload["aiJobId"],),
        ).fetchone()
        if existing:
            return str(existing["output_media_id"])
    media_id = str(uuid4())
    body = generated_cover(payload.get("prompt", "一起活动"))
    object_key = f"generated/{owner_id}/{media_id}.svg"
    infra.s3.put_object(
        settings.s3_bucket,
        object_key,
        io.BytesIO(body),
        len(body),
        content_type="image/svg+xml",
        metadata={"ai-generated": "true"},
    )
    connection.execute(
        """
        insert into app.media_assets
          (id, owner_user_id, purpose, storage_key, mime_type, byte_size, width, height,
           sha256, moderation_status, ai_generated, ai_label_version, provenance, exif_removed)
        values (%s, %s, 'ai_cover', %s, 'image/svg+xml', %s, 1200, 900, %s,
                'approved', true, 'v1', %s, true)
        """,
        (
            media_id,
            owner_id,
            object_key,
            len(body),
            hashlib.sha256(body).hexdigest(),
            Jsonb(
                {
                    "provider": settings.model_provider,
                    "model": settings.model_name,
                    "localDeterministic": True,
                }
            ),
        ),
    )
    if payload.get("aiJobId"):
        connection.execute(
            """
            update app.ai_generation_jobs set status = 'succeeded', output_media_id = %s,
              started_at = coalesce(started_at, now()), completed_at = now() where id = %s
            """,
            (media_id, payload["aiJobId"]),
        )
    return media_id


def process_event(event: dict[str, Any]) -> None:
    payload = event["payload"]
    if event["eventType"] == "media.upload.completed":
        stat = infra.s3.stat_object(settings.s3_bucket, payload["objectKey"])
        with infra.connection() as connection, connection.transaction():
            claim = connection.execute(
                """
                insert into app.processed_events (consumer_name, event_id)
                values ('worker-python', %s) on conflict do nothing returning event_id
                """,
                (event["id"],),
            ).fetchone()
            if not claim:
                return
            connection.execute(
                """
                update app.media_assets set byte_size = %s, moderation_status = 'approved', exif_removed = true
                where id = %s
                """,
                (stat.size, payload["mediaId"]),
            )
            connection.execute(
                "update app.media_upload_sessions set status = 'completed', completed_at = now() where id = %s",
                (payload["uploadId"],),
            )
        return

    with infra.connection() as connection, connection.transaction():
        claim = connection.execute(
            """
            insert into app.processed_events (consumer_name, event_id)
            values ('worker-python', %s) on conflict do nothing returning event_id
            """,
            (event["id"],),
        ).fetchone()
        if not claim:
            return
        if event["eventType"] == "post.submitted":
            if payload.get("needsAiCover"):
                media_id = ensure_asset(connection, payload, payload["userId"])
                connection.execute(
                    """
                    insert into app.post_media (post_id, media_asset_id, position) values (%s, %s, 0)
                    on conflict (post_id, position) do nothing
                    """,
                    (payload["postId"], media_id),
                )
            connection.execute(
                """
                update app.posts set status = 'published', moderation_status = 'approved',
                  published_at = now(), updated_at = now() where id = %s
                """,
                (payload["postId"],),
            )
        elif event["eventType"] == "activity.submitted":
            if payload.get("needsAiCover"):
                media_id = ensure_asset(connection, payload, payload["userId"])
                connection.execute(
                    """
                    insert into app.activity_media (activity_id, media_asset_id, position) values (%s, %s, 0)
                    on conflict (activity_id, position) do nothing
                    """,
                    (payload["activityId"], media_id),
                )
            connection.execute(
                """
                update app.activities set status = 'published', moderation_status = 'approved',
                  published_at = now(), updated_at = now() where id = %s
                """,
                (payload["activityId"],),
            )
        elif event["eventType"] == "ai.generation.requested":
            media_id = ensure_asset(
                connection,
                {**payload, "aiJobId": payload["jobId"]},
                payload["userId"],
            )
            if not media_id:
                raise RuntimeError("AI generation did not produce an asset")
    keys = infra.redis.keys(f"feed:{settings.implementation}:*")
    if keys:
        infra.redis.delete(*keys)


def stop(*_: Any) -> None:
    global running
    running = False


def main() -> None:
    infra.open()
    rabbit = pika.BlockingConnection(pika.URLParameters(settings.rabbitmq_url))
    channel = rabbit.channel()
    configure_topology(channel, settings.implementation)
    channel.confirm_delivery()
    queue = f"dachang.publication.{settings.implementation}"
    print(json.dumps({"level": "info", "service": "worker-python", "event": "started"}), flush=True)
    try:
        while running:
            publish_outbox(channel)
            for _ in range(10):
                method, properties, body = channel.basic_get(queue=queue, auto_ack=False)
                if method is None:
                    break
                try:
                    event = json.loads(body)
                    process_event(event)
                    channel.basic_ack(method.delivery_tag)
                    print(
                        json.dumps(
                            {
                                "level": "info",
                                "service": "worker-python",
                                "event": event["eventType"],
                                "eventId": event["id"],
                                "outcome": "succeeded",
                            }
                        ),
                        flush=True,
                    )
                except Exception as error:
                    headers = properties.headers or {}
                    retries = int(headers.get("x-retry-count", 0))
                    routing = f"{settings.implementation}.dead" if retries >= 3 else f"{settings.implementation}.retry"
                    channel.basic_publish(
                        exchange="dachang.events.dlx",
                        routing_key=routing,
                        body=body,
                        properties=pika.BasicProperties(
                            delivery_mode=pika.DeliveryMode.Persistent,
                            message_id=properties.message_id,
                            headers={"x-retry-count": retries + 1},
                        ),
                    )
                    channel.basic_ack(method.delivery_tag)
                    print(
                        json.dumps(
                            {
                                "level": "error",
                                "service": "worker-python",
                                "eventId": properties.message_id,
                                "retries": retries,
                                "error": str(error),
                            }
                        ),
                        flush=True,
                    )
            rabbit.process_data_events(time_limit=0)
            time.sleep(0.25)
    finally:
        rabbit.close()
        infra.close()


for registered_signal in (signal.SIGINT, signal.SIGTERM):
    signal.signal(registered_signal, stop)


if __name__ == "__main__":
    main()
