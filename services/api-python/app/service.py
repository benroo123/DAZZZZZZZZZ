import hashlib
import json
import re
import time
from datetime import timedelta
from typing import Any
from uuid import uuid4

import httpx
from fastapi import HTTPException
from psycopg.types.json import Jsonb

from .config import REPO_ROOT, settings
from .infra import infra
from .models import ActivityInput, PostInput


def media_url(media_id: str | None, storage_key: str | None) -> str | None:
    if not media_id or not storage_key:
        return None
    if storage_key.startswith("demo-assets/"):
        return f"{settings.public_base_url}/{storage_key}"
    return infra.s3.presigned_get_object(settings.s3_bucket, storage_key, expires=timedelta(minutes=15))


class Service:
    def config(self) -> dict[str, Any]:
        themes = json.loads((REPO_ROOT / "packages" / "contracts" / "themes.json").read_text())
        return {
            "implementation": settings.implementation,
            "version": "0.1.0",
            "themes": themes,
            "featureFlags": {
                "mixedFeed": True,
                "cityFeed": True,
                "aiCover": True,
                "aiActivityPlan": True,
                "realtimeMessages": True,
                "agentGateway": True,
            },
            "aiDisclosure": {
                "provider": settings.model_provider,
                "model": settings.model_name,
                "generatedMediaRequiresConfirmation": True,
            },
        }

    def health(self) -> dict[str, Any]:
        dependencies = infra.health()
        return {
            "status": "ready" if all(value == "up" for value in dependencies.values()) else "degraded",
            "implementation": settings.implementation,
            "dependencies": dependencies,
        }

    def metrics(self) -> str:
        with infra.connection() as connection:
            row = connection.execute(
                """
                select
                  (select count(*) from app.outbox_events where published_at is null) as outbox_pending,
                  (select count(*) from app.ai_generation_jobs where status in ('queued', 'running')) as ai_pending,
                  (select count(*) from app.posts where status = 'published') as posts_published,
                  (select count(*) from app.activities where status in ('published', 'full')) as activities_published
                """
            ).fetchone()
        return "\n".join(
            [
                "# HELP dachang_outbox_pending Pending transactional outbox events",
                "# TYPE dachang_outbox_pending gauge",
                f'dachang_outbox_pending{{implementation="python"}} {row["outbox_pending"]}',
                f'dachang_ai_pending{{implementation="python"}} {row["ai_pending"]}',
                f'dachang_posts_published {row["posts_published"]}',
                f'dachang_activities_published {row["activities_published"]}',
                "",
            ]
        )

    def feed(self, mode: str = "recommended", city_code: str = "310100") -> dict[str, Any]:
        cache_key = f"feed:{settings.implementation}:{mode}:{city_code}"
        if cached := infra.redis.get(cache_key):
            return json.loads(cached)
        with infra.connection() as connection:
            activities = connection.execute(
                """
                select a.id, a.title, a.description, a.category, a.starts_at as "startsAt",
                       a.published_at as "publishedAt", a.venue_name as "venueName",
                       a.approved_count as "approvedCount", a.max_participants as "maxParticipants",
                       p.display_name as "displayName", u.real_name_status as "realNameStatus",
                       image.id as "mediaId", image.storage_key as "storageKey"
                from app.activities a
                join app.profiles p on p.user_id = a.organizer_id
                join app.users u on u.id = a.organizer_id
                left join lateral (
                  select ma.id, ma.storage_key
                  from app.activity_media am join app.media_assets ma on ma.id = am.media_asset_id
                  where am.activity_id = a.id order by am.position limit 1
                ) image on true
                where a.status in ('published', 'full') and (%s <> 'city' or a.city_code = %s)
                order by a.published_at desc limit 30
                """,
                (mode, city_code),
            ).fetchall()
            posts = connection.execute(
                """
                select post.id, post.body, post.published_at as "publishedAt",
                       p.display_name as "displayName", u.real_name_status as "realNameStatus",
                       image.id as "mediaId", image.storage_key as "storageKey"
                from app.posts post
                join app.profiles p on p.user_id = post.author_id
                join app.users u on u.id = post.author_id
                left join lateral (
                  select ma.id, ma.storage_key
                  from app.post_media pm join app.media_assets ma on ma.id = pm.media_asset_id
                  where pm.post_id = post.id order by pm.position limit 1
                ) image on true
                where post.status = 'published' and post.visibility = 'public'
                  and (%s <> 'city' or post.city_code = %s)
                order by post.published_at desc limit 30
                """,
                (mode, city_code),
            ).fetchall()
        items: list[dict[str, Any]] = []
        for row in activities:
            items.append(
                {
                    "id": row["id"],
                    "entityType": "activity",
                    "title": row["title"],
                    "body": row["description"],
                    "category": row["category"],
                    "startsAt": row["startsAt"],
                    "publishedAt": row["publishedAt"],
                    "venueName": row["venueName"],
                    "participants": {"approved": row["approvedCount"], "max": row["maxParticipants"]},
                    "distanceKm": 2.4,
                    "author": {
                        "displayName": row["displayName"],
                        "realNameVerified": row["realNameStatus"] == "verified",
                    },
                    "imageUrl": media_url(str(row["mediaId"]), row["storageKey"]),
                }
            )
        for row in posts:
            items.append(
                {
                    "id": row["id"],
                    "entityType": "post",
                    "title": f'{row["displayName"]} 的动态',
                    "body": row["body"],
                    "publishedAt": row["publishedAt"],
                    "author": {
                        "displayName": row["displayName"],
                        "realNameVerified": row["realNameStatus"] == "verified",
                    },
                    "imageUrl": media_url(str(row["mediaId"]), row["storageKey"]),
                }
            )
        items.sort(key=lambda item: str(item["publishedAt"]), reverse=True)
        response = {"items": items, "nextCursor": None}
        infra.redis.setex(cache_key, 10, json.dumps(response, default=str, ensure_ascii=False))
        return response

    def search(self, query: str, types: str | None) -> dict[str, Any]:
        needle = query.strip().lower()
        selected = set((types or "activity,post,user,place").split(","))
        items: list[dict[str, Any]] = []
        if "activity" in selected or "post" in selected:
            items.extend(
                item
                for item in self.feed()["items"]
                if item["entityType"] in selected
                and needle
                in " ".join(
                    str(item.get(key, "")) for key in ("title", "body", "category", "venueName")
                ).lower()
            )
        with infra.connection() as connection:
            if "user" in selected:
                rows = connection.execute(
                    """
                    select u.id, u.public_id as "publicId", p.display_name as "displayName", p.bio,
                           ph.id as "mediaId", ph.storage_key as "storageKey"
                    from app.users u join app.profiles p on p.user_id = u.id
                    left join lateral (
                      select ma.id, ma.storage_key from app.profile_photos pp
                      join app.media_assets ma on ma.id = pp.media_asset_id
                      where pp.user_id = u.id order by pp.is_primary desc, pp.position limit 1
                    ) ph on true
                    where p.display_name ilike %s or u.public_id ilike %s limit 20
                    """,
                    (f"%{query}%", f"%{query}%"),
                ).fetchall()
                items.extend(
                    {
                        **row,
                        "entityType": "user",
                        "imageUrl": media_url(str(row["mediaId"]), row["storageKey"]),
                    }
                    for row in rows
                )
            if "place" in selected:
                rows = connection.execute(
                    "select distinct venue_name as name from app.activities where venue_name ilike %s limit 10",
                    (f"%{query}%",),
                ).fetchall()
                items.extend({"entityType": "place", **row, "cityCode": "310100"} for row in rows)
        return {"items": items, "nextCursor": None}

    def nearby(self, city_code: str, categories: str | None, participant_max: int) -> dict[str, Any]:
        items = [item for item in self.feed("city", city_code)["items"] if item["entityType"] == "activity"]
        if categories:
            allowed = set(categories.split(","))
            items = [item for item in items if item.get("category") in allowed]
        items = [item for item in items if item["participants"]["max"] <= participant_max]
        return {"items": items, "nextCursor": None}

    def profile(self, user_id: str) -> dict[str, Any]:
        with infra.connection() as connection:
            row = connection.execute(
                """
                select u.id, u.public_id as "publicId", u.real_name_status as "realNameStatus",
                       p.display_name as "displayName", extract(year from age(p.birth_date))::int as age,
                       p.gender, p.bio, p.city_code as "cityCode", p.occupation,
                       p.personality_label as "personalityLabel", p.completion_percent as "completionPercent",
                       p.attendance_rate as "attendanceRate", p.rating, p.extra_attributes as "extraAttributes",
                       (select count(*)::int from app.follows where follower_id = u.id) as "followingCount",
                       (select count(*)::int from app.follows where followed_id = u.id) as "followerCount"
                from app.users u join app.profiles p on p.user_id = u.id where u.id = %s
                """,
                (user_id,),
            ).fetchone()
        if not row:
            raise HTTPException(404, "Profile not found")
        return row

    def update_profile(self, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        with infra.connection() as connection:
            connection.execute(
                """
                update app.profiles set display_name = coalesce(%s, display_name),
                  bio = coalesce(%s, bio), occupation = coalesce(%s, occupation),
                  personality_label = coalesce(%s, personality_label),
                  extra_attributes = coalesce(%s, extra_attributes), updated_at = now()
                where user_id = %s
                """,
                (
                    payload.get("displayName"),
                    payload.get("bio"),
                    payload.get("occupation"),
                    payload.get("personalityLabel"),
                    Jsonb(payload["extraAttributes"]) if payload.get("extraAttributes") else None,
                    user_id,
                ),
            )
        return self.profile(user_id)

    def candidates(self, user_id: str) -> dict[str, Any]:
        with infra.connection() as connection:
            rows = connection.execute(
                """
                select u.id, u.public_id as "publicId", u.real_name_status as "realNameStatus",
                       p.display_name as "displayName", extract(year from age(p.birth_date))::int as age,
                       p.bio, p.occupation, p.personality_label as "personalityLabel",
                       p.extra_attributes as "extraAttributes", p.rating,
                       ph.id as "mediaId", ph.storage_key as "storageKey"
                from app.users u join app.profiles p on p.user_id = u.id
                left join lateral (
                  select ma.id, ma.storage_key from app.profile_photos pp
                  join app.media_assets ma on ma.id = pp.media_asset_id
                  where pp.user_id = u.id order by pp.is_primary desc, pp.position limit 1
                ) ph on true
                where u.id <> %s
                  and not exists (select 1 from app.blocks b where
                    (b.blocker_id = %s and b.blocked_id = u.id) or
                    (b.blocker_id = u.id and b.blocked_id = %s))
                order by p.rating desc nulls last limit 20
                """,
                (user_id, user_id, user_id),
            ).fetchall()
        return {
            "items": [
                {
                    **row,
                    "realNameVerified": row["realNameStatus"] == "verified",
                    "interests": row.get("extraAttributes", {}).get("interests", []),
                    "imageUrl": media_url(str(row["mediaId"]), row["storageKey"]),
                }
                for row in rows
            ],
            "nextCursor": None,
        }

    def swipe(self, user_id: str, target_id: str, decision: str) -> dict[str, Any]:
        with infra.connection() as connection:
            connection.execute(
                """
                insert into app.swipes (actor_id, target_id, decision) values (%s, %s, %s)
                on conflict (actor_id, target_id) do update set decision = excluded.decision, created_at = now()
                """,
                (user_id, target_id, decision),
            )
            matched = False
            match_id = None
            if decision in {"like", "super_like"}:
                reverse = connection.execute(
                    """
                    select 1 from app.swipes where actor_id = %s and target_id = %s
                    and decision in ('like', 'super_like')
                    """,
                    (target_id, user_id),
                ).fetchone()
                if reverse:
                    low, high = sorted([user_id, target_id])
                    match_id = str(uuid4())
                    row = connection.execute(
                        """
                        insert into app.matches (id, user_low_id, user_high_id) values (%s, %s, %s)
                        on conflict (user_low_id, user_high_id) do update set status = 'active'
                        returning id
                        """,
                        (match_id, low, high),
                    ).fetchone()
                    match_id = row["id"]
                    matched = True
        return {"accepted": True, "matched": matched, "matchId": match_id}

    def conversations(self, user_id: str) -> dict[str, Any]:
        with infra.connection() as connection:
            rows = connection.execute(
                """
                select c.id, c.type, c.title, c.last_message_at as "lastMessageAt",
                  coalesce(convert_from(m.body_ciphertext, 'UTF8'), m.payload->>'text', '') as "lastMessage"
                from app.conversations c
                join app.conversation_members cm on cm.conversation_id = c.id
                  and cm.user_id = %s and cm.left_at is null
                left join app.messages m on m.id = c.last_message_id
                order by c.last_message_at desc nulls last
                """,
                (user_id,),
            ).fetchall()
        profile = self.profile(user_id)
        return {
            "items": rows,
            "nextCursor": None,
            "social": {"following": profile["followingCount"], "followers": profile["followerCount"]},
        }

    def messages(self, user_id: str, conversation_id: str) -> dict[str, Any]:
        self._assert_member(user_id, conversation_id)
        with infra.connection() as connection:
            rows = connection.execute(
                """
                select id, sender_id as "senderId", type,
                  coalesce(convert_from(body_ciphertext, 'UTF8'), payload->>'text', '') as text,
                  created_at as "createdAt"
                from app.messages where conversation_id = %s and deleted_at is null
                order by created_at asc, id asc limit 100
                """,
                (conversation_id,),
            ).fetchall()
        return {"items": rows, "nextCursor": None}

    def send_message(self, user_id: str, conversation_id: str, text: str, client_id: str) -> dict[str, Any]:
        self._assert_member(user_id, conversation_id)
        message_id = str(uuid4())
        with infra.connection() as connection:
            row = connection.execute(
                """
                insert into app.messages
                  (id, conversation_id, sender_id, client_message_id, type, body_ciphertext, moderation_status)
                values (%s, %s, %s, %s, 'text', %s, 'approved')
                on conflict (sender_id, client_message_id)
                  do update set client_message_id = excluded.client_message_id
                returning id, sender_id as "senderId", type,
                  convert_from(body_ciphertext, 'UTF8') as text, created_at as "createdAt"
                """,
                (message_id, conversation_id, user_id, client_id, text.encode()),
            ).fetchone()
            connection.execute(
                "update app.conversations set last_message_id = %s, last_message_at = now() where id = %s",
                (row["id"], conversation_id),
            )
        return row

    def create_media_upload(self, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        media_id, upload_id = str(uuid4()), str(uuid4())
        safe_name = re.sub(r"[^a-zA-Z0-9._-]", "-", payload["filename"])
        object_key = f"quarantine/{user_id}/{media_id}/{safe_name}"
        with infra.connection() as connection, connection.transaction():
            connection.execute(
                """
                insert into app.media_assets
                  (id, owner_user_id, purpose, storage_key, mime_type, byte_size, sha256, moderation_status)
                values (%s, %s, %s, %s, %s, %s, %s, 'quarantined')
                """,
                (
                    media_id,
                    user_id,
                    payload["purpose"],
                    object_key,
                    payload["contentType"],
                    payload["byteSize"],
                    payload["sha256"],
                ),
            )
            connection.execute(
                """
                insert into app.media_upload_sessions
                  (id, owner_user_id, media_asset_id, object_key, expires_at)
                values (%s, %s, %s, %s, now() + interval '15 minutes')
                """,
                (upload_id, user_id, media_id, object_key),
            )
        url = infra.s3.presigned_put_object(settings.s3_bucket, object_key, expires=timedelta(minutes=15))
        return {"uploadId": upload_id, "mediaId": media_id, "uploadUrl": url, "method": "PUT", "expiresIn": 900}

    def complete_media_upload(self, user_id: str, upload_id: str) -> dict[str, Any]:
        with infra.connection() as connection:
            row = connection.execute(
                """
                update app.media_upload_sessions set status = 'processing'
                where id = %s and owner_user_id = %s and expires_at > now()
                returning media_asset_id as "mediaId", object_key as "objectKey"
                """,
                (upload_id, user_id),
            ).fetchone()
        if not row:
            raise HTTPException(404, "Upload session not found or expired")
        self._outbox(
            "media",
            str(row["mediaId"]),
            "media.upload.completed",
            {
                "implementation": "python",
                "uploadId": upload_id,
                "mediaId": str(row["mediaId"]),
                "objectKey": row["objectKey"],
            },
        )
        return {"accepted": True, "uploadId": upload_id, "status": "processing"}

    def media(self, media_id: str) -> dict[str, Any]:
        with infra.connection() as connection:
            row = connection.execute(
                """
                select id, purpose, storage_key as "storageKey", mime_type as "mimeType",
                  byte_size as "byteSize", moderation_status as "moderationStatus",
                  ai_generated as "aiGenerated", provenance, created_at as "createdAt"
                from app.media_assets where id = %s and deleted_at is null
                """,
                (media_id,),
            ).fetchone()
        if not row:
            raise HTTPException(404, "Media not found")
        return {**row, "url": media_url(media_id, row["storageKey"])}

    def create_post(self, user_id: str, payload: PostInput, idempotency_key: str | None) -> dict[str, Any]:
        if idempotency_key:
            with infra.connection() as connection:
                existing = connection.execute(
                    """
                    select response_body from app.idempotency_keys where principal_type = 'user'
                      and principal_id = %s and operation_id = 'createPost'
                      and idempotency_key = %s and expires_at > now()
                    """,
                    (user_id, idempotency_key),
                ).fetchone()
            if existing:
                return existing["response_body"]
        post_id = str(uuid4())
        ai_job_id = str(uuid4()) if payload.autoGenerateCover and not payload.mediaIds else None
        response = {"id": post_id, "status": "draft", "aiJobId": ai_job_id, "mediaIds": payload.mediaIds}
        with infra.connection() as connection, connection.transaction():
            connection.execute(
                """
                insert into app.posts (id, author_id, status, body, city_code, visibility, moderation_status)
                values (%s, %s, 'draft', %s, %s, 'public', 'pending')
                """,
                (post_id, user_id, payload.body, payload.cityCode),
            )
            for position, media_id in enumerate(payload.mediaIds):
                connection.execute(
                    "insert into app.post_media (post_id, media_asset_id, position) values (%s, %s, %s)",
                    (post_id, media_id, position),
                )
            if ai_job_id:
                connection.execute(
                    """
                    insert into app.ai_generation_jobs
                      (id, user_id, purpose, status, model_provider, model_name, prompt_redacted, input_refs)
                    values (%s, %s, 'post_cover', 'queued', %s, %s, %s, %s)
                    """,
                    (
                        ai_job_id,
                        user_id,
                        settings.model_provider,
                        settings.model_name,
                        payload.body,
                        Jsonb([{"type": "post", "id": post_id}]),
                    ),
                )
            if idempotency_key:
                request_hash = hashlib.sha256(payload.model_dump_json().encode()).hexdigest()
                connection.execute(
                    """
                    insert into app.idempotency_keys
                      (principal_type, principal_id, operation_id, idempotency_key, request_hash,
                       response_status, response_body, resource_id, expires_at)
                    values ('user', %s, 'createPost', %s, %s, 201, %s, %s, now() + interval '24 hours')
                    """,
                    (user_id, idempotency_key, request_hash, Jsonb(response), post_id),
                )
        return response

    def post(self, post_id: str) -> dict[str, Any]:
        with infra.connection() as connection:
            row = connection.execute(
                """
                select id, body, status, moderation_status as "moderationStatus",
                  published_at as "publishedAt", created_at as "createdAt"
                from app.posts where id = %s and deleted_at is null
                """,
                (post_id,),
            ).fetchone()
            media = connection.execute(
                "select media_asset_id as id from app.post_media where post_id = %s order by position",
                (post_id,),
            ).fetchall()
        if not row:
            raise HTTPException(404, "Post not found")
        return {**row, "mediaIds": [item["id"] for item in media]}

    def publish_post(self, user_id: str, post_id: str) -> dict[str, Any]:
        with infra.connection() as connection:
            row = connection.execute(
                """
                select p.status, p.body,
                  not exists(select 1 from app.post_media pm where pm.post_id = p.id) as "needsAiCover",
                  (select id from app.ai_generation_jobs j where j.input_refs @> %s
                   order by created_at desc limit 1) as "aiJobId"
                from app.posts p where p.id = %s and p.author_id = %s
                """,
                (Jsonb([{"type": "post", "id": post_id}]), post_id, user_id),
            ).fetchone()
        if not row:
            raise HTTPException(404, "Post not found")
        if row["status"] in {"published", "pending_review"}:
            return {"accepted": True, "id": post_id, "status": row["status"]}
        with infra.connection() as connection, connection.transaction():
            connection.execute("update app.posts set status = 'pending_review', updated_at = now() where id = %s", (post_id,))
            connection.execute(
                """
                insert into app.outbox_events (aggregate_type, aggregate_id, event_type, payload)
                values ('post', %s, 'post.submitted', %s)
                """,
                (
                    post_id,
                    Jsonb(
                        {
                            "implementation": "python",
                            "postId": post_id,
                            "userId": user_id,
                            "prompt": row["body"],
                            "needsAiCover": row["needsAiCover"],
                            "aiJobId": str(row["aiJobId"]) if row["aiJobId"] else None,
                        }
                    ),
                ),
            )
        return {"accepted": True, "id": post_id, "status": "pending_review"}

    def create_activity(self, user_id: str, payload: ActivityInput) -> dict[str, Any]:
        activity_id = str(uuid4())
        ai_job_id = str(uuid4()) if payload.autoGenerateCover and not payload.mediaIds else None
        with infra.connection() as connection, connection.transaction():
            connection.execute(
                """
                insert into app.activities
                  (id, organizer_id, title, description, category, status, min_participants,
                   max_participants, starts_at, ends_at, city_code, district_code, venue_name)
                values (%s, %s, %s, %s, %s, 'draft', %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    activity_id,
                    user_id,
                    payload.title,
                    payload.description,
                    payload.category,
                    payload.minParticipants,
                    payload.maxParticipants,
                    payload.startsAt,
                    payload.endsAt,
                    payload.cityCode,
                    payload.districtCode,
                    payload.venueName,
                ),
            )
            connection.execute(
                """
                insert into app.activity_members (activity_id, user_id, role, status, joined_at)
                values (%s, %s, 'organizer', 'joined', now())
                """,
                (activity_id, user_id),
            )
            for position, media_id in enumerate(payload.mediaIds):
                connection.execute(
                    "insert into app.activity_media (activity_id, media_asset_id, position) values (%s, %s, %s)",
                    (activity_id, media_id, position),
                )
            if ai_job_id:
                connection.execute(
                    """
                    insert into app.ai_generation_jobs
                      (id, user_id, purpose, status, model_provider, model_name, prompt_redacted, input_refs)
                    values (%s, %s, 'activity_cover', 'queued', %s, %s, %s, %s)
                    """,
                    (
                        ai_job_id,
                        user_id,
                        settings.model_provider,
                        settings.model_name,
                        f"{payload.title} {payload.description}",
                        Jsonb([{"type": "activity", "id": activity_id}]),
                    ),
                )
        return {"id": activity_id, "status": "draft", "aiJobId": ai_job_id}

    def publish_activity(self, user_id: str, activity_id: str) -> dict[str, Any]:
        with infra.connection() as connection:
            row = connection.execute(
                """
                select a.status, a.title, a.description,
                  not exists(select 1 from app.activity_media am where am.activity_id = a.id) as "needsAiCover",
                  (select id from app.ai_generation_jobs j where j.input_refs @> %s
                   order by created_at desc limit 1) as "aiJobId"
                from app.activities a where a.id = %s and a.organizer_id = %s
                """,
                (Jsonb([{"type": "activity", "id": activity_id}]), activity_id, user_id),
            ).fetchone()
        if not row:
            raise HTTPException(404, "Activity not found")
        if row["status"] in {"published", "pending_review"}:
            return {"accepted": True, "id": activity_id, "status": row["status"]}
        with infra.connection() as connection, connection.transaction():
            connection.execute(
                "update app.activities set status = 'pending_review', updated_at = now() where id = %s",
                (activity_id,),
            )
            connection.execute(
                """
                insert into app.outbox_events (aggregate_type, aggregate_id, event_type, payload)
                values ('activity', %s, 'activity.submitted', %s)
                """,
                (
                    activity_id,
                    Jsonb(
                        {
                            "implementation": "python",
                            "activityId": activity_id,
                            "userId": user_id,
                            "prompt": f'{row["title"]} {row["description"]}',
                            "needsAiCover": row["needsAiCover"],
                            "aiJobId": str(row["aiJobId"]) if row["aiJobId"] else None,
                        }
                    ),
                ),
            )
        return {"accepted": True, "id": activity_id, "status": "pending_review"}

    def join_activity(self, user_id: str, activity_id: str) -> dict[str, Any]:
        with infra.connection() as connection, connection.transaction():
            row = connection.execute(
                """
                select status, approved_count as "approvedCount", max_participants as "maxParticipants",
                  join_policy as "joinPolicy" from app.activities where id = %s for update
                """,
                (activity_id,),
            ).fetchone()
            if not row:
                raise HTTPException(404, "Activity not found")
            if row["status"] not in {"published", "full"}:
                raise HTTPException(409, "Activity is not joinable")
            full = row["approvedCount"] >= row["maxParticipants"]
            status = "waitlisted" if full else "joined" if row["joinPolicy"] == "open" else "applied"
            connection.execute(
                """
                insert into app.activity_members (activity_id, user_id, status, joined_at)
                values (%s, %s, %s, case when %s = 'joined' then now() else null end)
                on conflict (activity_id, user_id) do update set status = excluded.status, updated_at = now()
                """,
                (activity_id, user_id, status, status),
            )
            if status == "joined":
                connection.execute(
                    "update app.activities set approved_count = approved_count + 1 where id = %s",
                    (activity_id,),
                )
        return {"accepted": True, "activityId": activity_id, "status": status}

    def plan(self, user_id: str, prompt: str, participants: int, correlation_id: str) -> dict[str, Any]:
        started = time.perf_counter()
        status = "succeeded"
        try:
            if settings.model_base_url:
                response = httpx.post(
                    f'{settings.model_base_url.rstrip("/")}/chat/completions',
                    headers={"Authorization": f"Bearer {settings.model_api_key}"},
                    json={
                        "model": settings.model_name,
                        "response_format": {"type": "json_object"},
                        "messages": [
                            {
                                "role": "system",
                                "content": "Return JSON activity plan with title, summary, agenda, suggestedTags, safetyNotes.",
                            },
                            {"role": "user", "content": f"{participants} participants. {prompt}"},
                        ],
                    },
                    timeout=30,
                )
                response.raise_for_status()
                plan = json.loads(response.json()["choices"][0]["message"]["content"])
                local = False
            else:
                subject = re.split(r"[。！？]", prompt)[0][:24] or "一起出发"
                plan = {
                    "title": subject,
                    "summary": f"为 {participants} 人生成的活动方案：{prompt}",
                    "agenda": [
                        {"time": "00:00", "item": "集合、实名成员确认与安全说明"},
                        {"time": "00:15", "item": "破冰和活动分组"},
                        {"time": "00:30", "item": "开始主要活动"},
                        {"time": "02:00", "item": "合照、评价和下次组局建议"},
                    ],
                    "suggestedTags": ["同城", "新手友好", "小组活动" if participants <= 6 else "多人活动"],
                    "safetyNotes": ["公开页面只展示模糊集合点", "活动开始前向已批准成员开放精确位置"],
                }
                local = True
        except Exception as error:
            status = "failed"
            self._record_model(user_id, prompt, status, started, correlation_id)
            raise HTTPException(502, f"Model gateway failed: {error}") from error
        self._record_model(user_id, prompt, status, started, correlation_id)
        plan["generatedBy"] = {
            "provider": settings.model_provider,
            "model": settings.model_name,
            "localFallback": local,
        }
        return plan

    def create_ai_generation(self, user_id: str, purpose: str, prompt: str) -> dict[str, Any]:
        job_id = str(uuid4())
        with infra.connection() as connection:
            connection.execute(
                """
                insert into app.ai_generation_jobs
                  (id, user_id, purpose, status, model_provider, model_name, prompt_redacted)
                values (%s, %s, %s, 'queued', %s, %s, %s)
                """,
                (job_id, user_id, purpose, settings.model_provider, settings.model_name, prompt),
            )
        self._outbox(
            "ai_generation",
            job_id,
            "ai.generation.requested",
            {
                "implementation": "python",
                "jobId": job_id,
                "userId": user_id,
                "purpose": purpose,
                "prompt": prompt,
            },
        )
        return {"accepted": True, "id": job_id, "status": "queued"}

    def ai_generation(self, job_id: str) -> dict[str, Any]:
        with infra.connection() as connection:
            row = connection.execute(
                """
                select id, purpose, status, model_provider as "modelProvider", model_name as "modelName",
                  output_media_id as "outputMediaId", error_code as "errorCode",
                  created_at as "createdAt", completed_at as "completedAt"
                from app.ai_generation_jobs where id = %s
                """,
                (job_id,),
            ).fetchone()
        if not row:
            raise HTTPException(404, "AI generation not found")
        return row

    def agent_manifest(self) -> dict[str, Any]:
        return {
            "name": "Dachang Agent Gateway",
            "version": "0.1.0",
            "protocol": "typed-tools-v1",
            "identity": {"delegatedScopes": True, "shortLivedTokens": True},
            "policies": {
                "dryRun": True,
                "idempotencyRequired": True,
                "approvalRequiredFor": ["publish", "send_message", "invite", "delete", "payment"],
                "auditAllActions": True,
            },
            "modelCapabilities": ["activity_planning", "cover_generation", "conversation_summary", "moderation_assist"],
        }

    def agent_tools(self) -> dict[str, Any]:
        return json.loads(
            (REPO_ROOT / "activity-social-app-product" / "api" / "agent-tools.json").read_text()
        )

    def _assert_member(self, user_id: str, conversation_id: str) -> None:
        with infra.connection() as connection:
            row = connection.execute(
                """
                select 1 from app.conversation_members where conversation_id = %s
                  and user_id = %s and left_at is null
                """,
                (conversation_id, user_id),
            ).fetchone()
        if not row:
            raise HTTPException(404, "Conversation not found")

    def _outbox(self, aggregate_type: str, aggregate_id: str, event_type: str, payload: dict[str, Any]) -> None:
        with infra.connection() as connection:
            connection.execute(
                """
                insert into app.outbox_events (aggregate_type, aggregate_id, event_type, payload)
                values (%s, %s, %s, %s)
                """,
                (aggregate_type, aggregate_id, event_type, Jsonb(payload)),
            )

    def _record_model(
        self, user_id: str, prompt: str, status: str, started: float, correlation_id: str
    ) -> None:
        with infra.connection() as connection:
            connection.execute(
                """
                insert into app.model_invocations
                  (id, user_id, capability, provider, model, prompt_hash, status, latency_ms, correlation_id)
                values (%s, %s, 'activity_plan', %s, %s, %s, %s, %s, %s)
                """,
                (
                    str(uuid4()),
                    user_id,
                    settings.model_provider,
                    settings.model_name,
                    hashlib.sha256(prompt.encode()).hexdigest(),
                    status,
                    int((time.perf_counter() - started) * 1000),
                    correlation_id,
                ),
            )


service = Service()
