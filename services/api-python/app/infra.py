from contextlib import contextmanager
from typing import Iterator

import pika
import redis
from minio import Minio
from psycopg import Connection
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import settings


def configure_topology(channel: pika.adapters.blocking_connection.BlockingChannel, implementation: str) -> None:
    channel.exchange_declare(exchange="dachang.events", exchange_type="topic", durable=True)
    channel.exchange_declare(exchange="dachang.events.dlx", exchange_type="topic", durable=True)
    queue = f"dachang.publication.{implementation}"
    retry_queue = f"{queue}.retry"
    dead_queue = f"{queue}.dead"
    channel.queue_declare(
        queue=queue,
        durable=True,
        arguments={"x-dead-letter-exchange": "dachang.events.dlx"},
    )
    channel.queue_declare(
        queue=retry_queue,
        durable=True,
        arguments={"x-message-ttl": 1000, "x-dead-letter-exchange": "dachang.events"},
    )
    channel.queue_declare(queue=dead_queue, durable=True)
    channel.queue_bind(queue=queue, exchange="dachang.events", routing_key=f"{implementation}.#")
    channel.queue_bind(
        queue=retry_queue, exchange="dachang.events.dlx", routing_key=f"{implementation}.retry"
    )
    channel.queue_bind(
        queue=dead_queue, exchange="dachang.events.dlx", routing_key=f"{implementation}.dead"
    )


class Infrastructure:
    def __init__(self) -> None:
        self.pool = ConnectionPool(
            conninfo=settings.database_url,
            min_size=1,
            max_size=20,
            kwargs={"row_factory": dict_row},
            open=False,
        )
        self.redis = redis.Redis.from_url(settings.redis_url, decode_responses=True)
        self.s3 = Minio(
            f"{settings.s3_endpoint}:{settings.s3_port}",
            access_key=settings.s3_access_key,
            secret_key=settings.s3_secret_key,
            secure=settings.s3_secure,
        )

    def open(self) -> None:
        self.pool.open(wait=True)
        self.redis.ping()
        if not self.s3.bucket_exists(settings.s3_bucket):
            self.s3.make_bucket(settings.s3_bucket)
        connection = pika.BlockingConnection(pika.URLParameters(settings.rabbitmq_url))
        try:
            configure_topology(connection.channel(), settings.implementation)
        finally:
            connection.close()

    def close(self) -> None:
        self.pool.close()
        self.redis.close()

    @contextmanager
    def connection(self) -> Iterator[Connection]:
        with self.pool.connection() as connection:
            yield connection

    def health(self) -> dict[str, str]:
        checks: dict[str, str] = {}
        try:
            with self.connection() as connection:
                connection.execute("select 1")
            checks["postgres"] = "up"
        except Exception:
            checks["postgres"] = "down"
        try:
            self.redis.ping()
            checks["redis"] = "up"
        except Exception:
            checks["redis"] = "down"
        try:
            connection = pika.BlockingConnection(pika.URLParameters(settings.rabbitmq_url))
            connection.close()
            checks["rabbitmq"] = "up"
        except Exception:
            checks["rabbitmq"] = "down"
        try:
            checks["objectStorage"] = (
                "up" if self.s3.bucket_exists(settings.s3_bucket) else "down"
            )
        except Exception:
            checks["objectStorage"] = "down"
        return checks


infra = Infrastructure()
