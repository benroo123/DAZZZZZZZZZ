import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config';
import { ActivityInput, PostInput } from './domain';
import { InfraService } from './infra.service';

type Row = Record<string, any>;

@Injectable()
export class AppService {
  constructor(@Inject(InfraService) private readonly infra: InfraService) {}

  async getConfig(): Promise<Record<string, unknown>> {
    const themePath = path.resolve(process.cwd(), '../../packages/contracts/themes.json');
    const themes = JSON.parse(await fs.readFile(themePath, 'utf8'));
    return {
      implementation: config.implementation,
      version: '0.1.0',
      themes,
      featureFlags: {
        mixedFeed: true,
        cityFeed: true,
        aiCover: true,
        aiActivityPlan: true,
        realtimeMessages: true,
        agentGateway: true,
      },
      aiDisclosure: {
        provider: config.model.provider,
        model: config.model.name,
        generatedMediaRequiresConfirmation: true,
      },
    };
  }

  async health(): Promise<Record<string, unknown>> {
    const dependencies = await this.infra.health();
    const ready = Object.values(dependencies).every((value) => value === 'up');
    return {
      status: ready ? 'ready' : 'degraded',
      implementation: config.implementation,
      dependencies,
      timestamp: new Date().toISOString(),
    };
  }

  async metrics(): Promise<string> {
    const result = await this.infra.pool.query(
      `select
         (select count(*) from app.outbox_events where published_at is null) as outbox_pending,
         (select count(*) from app.ai_generation_jobs where status in ('queued', 'running')) as ai_pending,
         (select count(*) from app.posts where status = 'published') as posts_published,
         (select count(*) from app.activities where status in ('published', 'full')) as activities_published`,
    );
    const row = result.rows[0];
    return [
      '# HELP dachang_outbox_pending Pending transactional outbox events',
      '# TYPE dachang_outbox_pending gauge',
      `dachang_outbox_pending{implementation="ts"} ${row.outbox_pending}`,
      '# HELP dachang_ai_pending Pending AI generation jobs',
      '# TYPE dachang_ai_pending gauge',
      `dachang_ai_pending{implementation="ts"} ${row.ai_pending}`,
      `dachang_posts_published ${row.posts_published}`,
      `dachang_activities_published ${row.activities_published}`,
      '',
    ].join('\n');
  }

  async feed(mode = 'recommended', cityCode = '310100'): Promise<{ items: Row[]; nextCursor: null }> {
    const cacheKey = `feed:${config.implementation}:${mode}:${cityCode}`;
    const cached = await this.infra.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const activityResult = await this.infra.pool.query(
      `select a.id, a.title, a.description, a.category, a.starts_at as "startsAt",
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
       where a.status in ('published', 'full') and ($1::text <> 'city' or a.city_code = $2)
       order by a.published_at desc limit 30`,
      [mode, cityCode],
    );
    const postResult = await this.infra.pool.query(
      `select post.id, post.body, post.published_at as "publishedAt",
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
         and ($1::text <> 'city' or post.city_code = $2)
       order by post.published_at desc limit 30`,
      [mode, cityCode],
    );

    const activities = await Promise.all(
      activityResult.rows.map(async (row) => ({
        id: row.id,
        entityType: 'activity',
        title: row.title,
        body: row.description,
        category: row.category,
        startsAt: row.startsAt,
        publishedAt: row.publishedAt,
        venueName: row.venueName,
        participants: { approved: row.approvedCount, max: row.maxParticipants },
        distanceKm: 2.4,
        author: {
          displayName: row.displayName,
          realNameVerified: row.realNameStatus === 'verified',
        },
        imageUrl: await this.mediaUrl(row.mediaId, row.storageKey),
      })),
    );
    const posts = await Promise.all(
      postResult.rows.map(async (row) => ({
        id: row.id,
        entityType: 'post',
        title: `${row.displayName} 的动态`,
        body: row.body,
        publishedAt: row.publishedAt,
        author: {
          displayName: row.displayName,
          realNameVerified: row.realNameStatus === 'verified',
        },
        imageUrl: await this.mediaUrl(row.mediaId, row.storageKey),
      })),
    );
    const response = {
      items: [...activities, ...posts].sort(
        (a, b) => Date.parse(String(b.publishedAt)) - Date.parse(String(a.publishedAt)),
      ),
      nextCursor: null,
    };
    await this.infra.redis.set(cacheKey, JSON.stringify(response), 'EX', 10);
    return response;
  }

  async search(q: string, types?: string): Promise<{ items: Row[]; nextCursor: null }> {
    const needle = q.trim().toLocaleLowerCase('zh-CN');
    if (!needle) return { items: [], nextCursor: null };
    const selected = new Set((types ?? 'activity,post,user,place').split(','));
    const items: Row[] = [];
    if (selected.has('activity') || selected.has('post')) {
      const feed = await this.feed('recommended');
      items.push(
        ...feed.items.filter(
          (item) =>
            selected.has(item.entityType) &&
            `${item.title} ${item.body} ${item.category ?? ''} ${item.venueName ?? ''}`
              .toLocaleLowerCase('zh-CN')
              .includes(needle),
        ),
      );
    }
    if (selected.has('user')) {
      const users = await this.infra.pool.query(
        `select u.id, u.public_id as "publicId", p.display_name as "displayName", p.bio,
                ph.id as "mediaId", ph.storage_key as "storageKey"
         from app.users u join app.profiles p on p.user_id = u.id
         left join lateral (
           select ma.id, ma.storage_key from app.profile_photos pp
           join app.media_assets ma on ma.id = pp.media_asset_id
           where pp.user_id = u.id order by pp.is_primary desc, pp.position limit 1
         ) ph on true
         where p.display_name ilike $1 or u.public_id ilike $1 limit 20`,
        [`%${q}%`],
      );
      for (const row of users.rows) {
        items.push({
          ...row,
          entityType: 'user',
          imageUrl: await this.mediaUrl(row.mediaId, row.storageKey),
        });
      }
    }
    if (selected.has('place')) {
      const places = await this.infra.pool.query(
        `select distinct venue_name as name from app.activities
         where venue_name ilike $1 and venue_name is not null limit 10`,
        [`%${q}%`],
      );
      items.push(...places.rows.map((row) => ({ entityType: 'place', ...row, cityCode: '310100' })));
    }
    return { items, nextCursor: null };
  }

  async nearbyActivities(filters: Record<string, unknown>): Promise<{ items: Row[]; nextCursor: null }> {
    const response = await this.feed('city', String(filters.cityCode ?? '310100'));
    let items = response.items.filter((item) => item.entityType === 'activity');
    if (filters.categories) {
      const categories = String(filters.categories).split(',');
      items = items.filter((item) => categories.includes(item.category));
    }
    const maxPeople = Number(filters.participantMax ?? 50);
    items = items.filter((item) => item.participants.max <= maxPeople);
    return { items, nextCursor: null };
  }

  async profile(userId: string): Promise<Row> {
    const result = await this.infra.pool.query(
      `select u.id, u.public_id as "publicId", u.real_name_status as "realNameStatus",
              p.display_name as "displayName", extract(year from age(p.birth_date))::int as age,
              p.gender, p.bio, p.city_code as "cityCode", p.occupation,
              p.personality_label as "personalityLabel", p.completion_percent as "completionPercent",
              p.attendance_rate as "attendanceRate", p.rating, p.extra_attributes as "extraAttributes",
              (select count(*)::int from app.follows where follower_id = u.id) as "followingCount",
              (select count(*)::int from app.follows where followed_id = u.id) as "followerCount"
       from app.users u join app.profiles p on p.user_id = u.id where u.id = $1`,
      [userId],
    );
    if (!result.rowCount) throw new NotFoundException('Profile not found');
    return result.rows[0];
  }

  async updateProfile(userId: string, input: Row): Promise<Row> {
    await this.infra.pool.query(
      `update app.profiles set
         display_name = coalesce($2, display_name), bio = coalesce($3, bio),
         occupation = coalesce($4, occupation), personality_label = coalesce($5, personality_label),
         extra_attributes = coalesce($6, extra_attributes), updated_at = now()
       where user_id = $1`,
      [
        userId,
        input.displayName ?? null,
        input.bio ?? null,
        input.occupation ?? null,
        input.personalityLabel ?? null,
        input.extraAttributes ?? null,
      ],
    );
    await this.infra.redis.del(`profile:${userId}`);
    return this.profile(userId);
  }

  async matchingCandidates(userId: string): Promise<{ items: Row[]; nextCursor: null }> {
    const result = await this.infra.pool.query(
      `select u.id, u.public_id as "publicId", u.real_name_status as "realNameStatus",
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
       where u.id <> $1
         and not exists (select 1 from app.blocks b where (b.blocker_id = $1 and b.blocked_id = u.id) or (b.blocker_id = u.id and b.blocked_id = $1))
       order by p.rating desc nulls last limit 20`,
      [userId],
    );
    return {
      items: await Promise.all(
        result.rows.map(async (row) => ({
          ...row,
          realNameVerified: row.realNameStatus === 'verified',
          interests: row.extraAttributes?.interests ?? [],
          imageUrl: await this.mediaUrl(row.mediaId, row.storageKey),
        })),
      ),
      nextCursor: null,
    };
  }

  async swipe(userId: string, targetUserId: string, decision: string): Promise<Row> {
    await this.infra.pool.query(
      `insert into app.swipes (actor_id, target_id, decision) values ($1, $2, $3)
       on conflict (actor_id, target_id) do update set decision = excluded.decision, created_at = now()`,
      [userId, targetUserId, decision],
    );
    let matched = false;
    let matchId: string | null = null;
    if (decision === 'like' || decision === 'super_like') {
      const reverse = await this.infra.pool.query(
        `select 1 from app.swipes where actor_id = $1 and target_id = $2 and decision in ('like', 'super_like')`,
        [targetUserId, userId],
      );
      if (reverse.rowCount) {
        const [low, high] = [userId, targetUserId].sort();
        const match = await this.infra.pool.query(
          `insert into app.matches (id, user_low_id, user_high_id) values ($1, $2, $3)
           on conflict (user_low_id, user_high_id) do update set status = 'active'
           returning id`,
          [randomUUID(), low, high],
        );
        matched = true;
        matchId = match.rows[0].id;
      }
    }
    return { accepted: true, matched, matchId };
  }

  async conversations(userId: string): Promise<{ items: Row[]; nextCursor: null; social: Row }> {
    const result = await this.infra.pool.query(
      `select c.id, c.type, c.title, c.last_message_at as "lastMessageAt",
              coalesce(convert_from(m.body_ciphertext, 'UTF8'), m.payload->>'text', '') as "lastMessage"
       from app.conversations c
       join app.conversation_members cm on cm.conversation_id = c.id and cm.user_id = $1 and cm.left_at is null
       left join app.messages m on m.id = c.last_message_id
       order by c.last_message_at desc nulls last`,
      [userId],
    );
    const profile = await this.profile(userId);
    return {
      items: result.rows,
      nextCursor: null,
      social: { following: profile.followingCount, followers: profile.followerCount },
    };
  }

  async messages(userId: string, conversationId: string): Promise<{ items: Row[]; nextCursor: null }> {
    await this.assertConversationMember(userId, conversationId);
    const result = await this.infra.pool.query(
      `select id, sender_id as "senderId", type,
              coalesce(convert_from(body_ciphertext, 'UTF8'), payload->>'text', '') as text,
              created_at as "createdAt"
       from app.messages where conversation_id = $1 and deleted_at is null
       order by created_at asc, id asc limit 100`,
      [conversationId],
    );
    return { items: result.rows, nextCursor: null };
  }

  async sendMessage(userId: string, conversationId: string, text: string, clientMessageId: string): Promise<Row> {
    await this.assertConversationMember(userId, conversationId);
    const id = randomUUID();
    const result = await this.infra.pool.query(
      `insert into app.messages
       (id, conversation_id, sender_id, client_message_id, type, body_ciphertext, moderation_status)
       values ($1, $2, $3, $4, 'text', $5, 'approved')
       on conflict (sender_id, client_message_id) do update set client_message_id = excluded.client_message_id
       returning id, sender_id as "senderId", type, convert_from(body_ciphertext, 'UTF8') as text, created_at as "createdAt"`,
      [id, conversationId, userId, clientMessageId, Buffer.from(text, 'utf8')],
    );
    await this.infra.pool.query(
      `update app.conversations set last_message_id = $2, last_message_at = now() where id = $1`,
      [conversationId, result.rows[0].id],
    );
    return result.rows[0];
  }

  async createMediaUpload(userId: string, input: Row): Promise<Row> {
    const mediaId = randomUUID();
    const uploadId = randomUUID();
    const safeName = String(input.filename).replace(/[^a-zA-Z0-9._-]/g, '-');
    const objectKey = `quarantine/${userId}/${mediaId}/${safeName}`;
    const client = await this.infra.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `insert into app.media_assets
         (id, owner_user_id, purpose, storage_key, mime_type, byte_size, sha256, moderation_status)
         values ($1, $2, $3, $4, $5, $6, $7, 'quarantined')`,
        [mediaId, userId, input.purpose, objectKey, input.contentType, input.byteSize, input.sha256],
      );
      await client.query(
        `insert into app.media_upload_sessions
         (id, owner_user_id, media_asset_id, object_key, expires_at)
         values ($1, $2, $3, $4, now() + interval '15 minutes')`,
        [uploadId, userId, mediaId, objectKey],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    const uploadUrl = await this.infra.s3.presignedPutObject(config.s3.bucket, objectKey, 15 * 60);
    return { uploadId, mediaId, uploadUrl, method: 'PUT', expiresIn: 900 };
  }

  async completeMediaUpload(userId: string, uploadId: string): Promise<Row> {
    const result = await this.infra.pool.query(
      `update app.media_upload_sessions set status = 'processing'
       where id = $1 and owner_user_id = $2 and expires_at > now()
       returning media_asset_id as "mediaId", object_key as "objectKey"`,
      [uploadId, userId],
    );
    if (!result.rowCount) throw new NotFoundException('Upload session not found or expired');
    await this.insertOutbox('media', result.rows[0].mediaId, 'media.upload.completed', {
      implementation: config.implementation,
      uploadId,
      ...result.rows[0],
    });
    return { accepted: true, uploadId, status: 'processing' };
  }

  async media(mediaId: string): Promise<Row> {
    const result = await this.infra.pool.query(
      `select id, purpose, storage_key as "storageKey", mime_type as "mimeType",
              byte_size as "byteSize", moderation_status as "moderationStatus",
              ai_generated as "aiGenerated", provenance, created_at as "createdAt"
       from app.media_assets where id = $1 and deleted_at is null`,
      [mediaId],
    );
    if (!result.rowCount) throw new NotFoundException('Media not found');
    return {
      ...result.rows[0],
      url: await this.mediaUrl(mediaId, result.rows[0].storageKey),
    };
  }

  async createPost(userId: string, input: PostInput, idempotencyKey?: string): Promise<Row> {
    const existing = await this.idempotentResponse(userId, 'createPost', idempotencyKey);
    if (existing) return existing;
    const id = randomUUID();
    const aiJobId = input.autoGenerateCover && input.mediaIds.length === 0 ? randomUUID() : null;
    const client = await this.infra.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `insert into app.posts (id, author_id, status, body, city_code, visibility, moderation_status)
         values ($1, $2, 'draft', $3, $4, 'public', 'pending')`,
        [id, userId, input.body, input.cityCode],
      );
      for (const [position, mediaId] of input.mediaIds.entries()) {
        await client.query(
          `insert into app.post_media (post_id, media_asset_id, position) values ($1, $2, $3)`,
          [id, mediaId, position],
        );
      }
      if (aiJobId) {
        await client.query(
          `insert into app.ai_generation_jobs
           (id, user_id, purpose, status, model_provider, model_name, prompt_redacted, input_refs)
           values ($1, $2, 'post_cover', 'queued', $3, $4, $5, $6)`,
          [aiJobId, userId, config.model.provider, config.model.name, input.body, JSON.stringify([{ type: 'post', id }])],
        );
      }
      const response = { id, status: 'draft', aiJobId, mediaIds: input.mediaIds };
      await this.storeIdempotency(client, userId, 'createPost', idempotencyKey, input, response, id);
      await client.query('commit');
      return response;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async getPost(postId: string): Promise<Row> {
    const result = await this.infra.pool.query(
      `select id, body, status, moderation_status as "moderationStatus",
              published_at as "publishedAt", created_at as "createdAt"
       from app.posts where id = $1 and deleted_at is null`,
      [postId],
    );
    if (!result.rowCount) throw new NotFoundException('Post not found');
    const media = await this.infra.pool.query(
      `select ma.id from app.post_media pm join app.media_assets ma on ma.id = pm.media_asset_id
       where pm.post_id = $1 order by pm.position`,
      [postId],
    );
    return { ...result.rows[0], mediaIds: media.rows.map((row) => row.id) };
  }

  async publishPost(userId: string, postId: string): Promise<Row> {
    const post = await this.infra.pool.query(
      `select p.status, p.body,
              not exists(select 1 from app.post_media pm where pm.post_id = p.id) as "needsAiCover",
              (select id from app.ai_generation_jobs j where j.input_refs @> $2::jsonb order by created_at desc limit 1) as "aiJobId"
       from app.posts p where p.id = $1 and p.author_id = $3`,
      [postId, JSON.stringify([{ type: 'post', id: postId }]), userId],
    );
    if (!post.rowCount) throw new NotFoundException('Post not found');
    if (post.rows[0].status === 'published') return { accepted: true, id: postId, status: 'published' };
    if (post.rows[0].status === 'pending_review') {
      return { accepted: true, id: postId, status: 'pending_review' };
    }
    const client = await this.infra.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `update app.posts set status = 'pending_review', updated_at = now() where id = $1`,
        [postId],
      );
      await client.query(
        `insert into app.outbox_events
         (aggregate_type, aggregate_id, event_type, payload)
         values ('post', $1, 'post.submitted', $2)`,
        [
          postId,
          JSON.stringify({
            implementation: config.implementation,
            postId,
            userId,
            prompt: post.rows[0].body,
            needsAiCover: post.rows[0].needsAiCover,
            aiJobId: post.rows[0].aiJobId,
          }),
        ],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    return { accepted: true, id: postId, status: 'pending_review' };
  }

  async createActivity(userId: string, input: ActivityInput): Promise<Row> {
    const id = randomUUID();
    const aiJobId = input.autoGenerateCover && input.mediaIds.length === 0 ? randomUUID() : null;
    const client = await this.infra.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `insert into app.activities
         (id, organizer_id, title, description, category, status, min_participants,
          max_participants, starts_at, ends_at, city_code, district_code, venue_name)
         values ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9, $10, $11, $12)`,
        [
          id,
          userId,
          input.title,
          input.description,
          input.category,
          input.minParticipants,
          input.maxParticipants,
          input.startsAt,
          input.endsAt,
          input.cityCode,
          input.districtCode ?? null,
          input.venueName ?? null,
        ],
      );
      await client.query(
        `insert into app.activity_members (activity_id, user_id, role, status, joined_at)
         values ($1, $2, 'organizer', 'joined', now())`,
        [id, userId],
      );
      for (const [position, mediaId] of input.mediaIds.entries()) {
        await client.query(
          `insert into app.activity_media (activity_id, media_asset_id, position) values ($1, $2, $3)`,
          [id, mediaId, position],
        );
      }
      if (aiJobId) {
        await client.query(
          `insert into app.ai_generation_jobs
           (id, user_id, purpose, status, model_provider, model_name, prompt_redacted, input_refs)
           values ($1, $2, 'activity_cover', 'queued', $3, $4, $5, $6)`,
          [
            aiJobId,
            userId,
            config.model.provider,
            config.model.name,
            `${input.title} ${input.description}`,
            JSON.stringify([{ type: 'activity', id }]),
          ],
        );
      }
      await client.query('commit');
      return { id, status: 'draft', aiJobId };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async publishActivity(userId: string, activityId: string): Promise<Row> {
    const result = await this.infra.pool.query(
      `select a.status, a.title, a.description,
              not exists(select 1 from app.activity_media am where am.activity_id = a.id) as "needsAiCover",
              (select id from app.ai_generation_jobs j where j.input_refs @> $2::jsonb order by created_at desc limit 1) as "aiJobId"
       from app.activities a where a.id = $1 and a.organizer_id = $3`,
      [activityId, JSON.stringify([{ type: 'activity', id: activityId }]), userId],
    );
    if (!result.rowCount) throw new NotFoundException('Activity not found');
    if (result.rows[0].status === 'published') return { accepted: true, id: activityId, status: 'published' };
    if (result.rows[0].status === 'pending_review') return { accepted: true, id: activityId, status: 'pending_review' };
    await this.infra.pool.query(`update app.activities set status = 'pending_review', updated_at = now() where id = $1`, [activityId]);
    await this.insertOutbox('activity', activityId, 'activity.submitted', {
      implementation: config.implementation,
      activityId,
      userId,
      prompt: `${result.rows[0].title} ${result.rows[0].description}`,
      needsAiCover: result.rows[0].needsAiCover,
      aiJobId: result.rows[0].aiJobId,
    });
    return { accepted: true, id: activityId, status: 'pending_review' };
  }

  async joinActivity(userId: string, activityId: string): Promise<Row> {
    const client = await this.infra.pool.connect();
    try {
      await client.query('begin');
      const activity = await client.query(
        `select status, approved_count as "approvedCount", max_participants as "maxParticipants", join_policy as "joinPolicy"
         from app.activities where id = $1 for update`,
        [activityId],
      );
      if (!activity.rowCount) throw new NotFoundException('Activity not found');
      if (!['published', 'full'].includes(activity.rows[0].status)) {
        throw new ConflictException('Activity is not joinable');
      }
      const full = activity.rows[0].approvedCount >= activity.rows[0].maxParticipants;
      const status = full ? 'waitlisted' : activity.rows[0].joinPolicy === 'open' ? 'joined' : 'applied';
      await client.query(
        `insert into app.activity_members (activity_id, user_id, status, joined_at)
         values ($1, $2, $3, case when $3 = 'joined' then now() else null end)
         on conflict (activity_id, user_id) do update set status = excluded.status, updated_at = now()`,
        [activityId, userId, status],
      );
      if (status === 'joined') {
        await client.query(`update app.activities set approved_count = approved_count + 1 where id = $1`, [activityId]);
      }
      await client.query('commit');
      return { accepted: true, activityId, status };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async createAiGeneration(userId: string, purpose: string, prompt: string): Promise<Row> {
    if (!['post_cover', 'activity_cover', 'summary', 'moderation_assist'].includes(purpose)) {
      throw new UnprocessableEntityException('Unsupported AI purpose');
    }
    const id = randomUUID();
    await this.infra.pool.query(
      `insert into app.ai_generation_jobs
       (id, user_id, purpose, status, model_provider, model_name, prompt_redacted)
       values ($1, $2, $3, 'queued', $4, $5, $6)`,
      [id, userId, purpose, config.model.provider, config.model.name, prompt],
    );
    await this.insertOutbox('ai_generation', id, 'ai.generation.requested', {
      implementation: config.implementation,
      jobId: id,
      userId,
      purpose,
      prompt,
    });
    return { accepted: true, id, status: 'queued' };
  }

  async aiGeneration(jobId: string): Promise<Row> {
    const result = await this.infra.pool.query(
      `select id, purpose, status, model_provider as "modelProvider", model_name as "modelName",
              output_media_id as "outputMediaId", error_code as "errorCode",
              created_at as "createdAt", completed_at as "completedAt"
       from app.ai_generation_jobs where id = $1`,
      [jobId],
    );
    if (!result.rowCount) throw new NotFoundException('AI generation not found');
    return result.rows[0];
  }

  async agentManifest(): Promise<Row> {
    return {
      name: 'Dachang Agent Gateway',
      version: '0.1.0',
      protocol: 'typed-tools-v1',
      identity: { delegatedScopes: true, shortLivedTokens: true },
      policies: {
        dryRun: true,
        idempotencyRequired: true,
        approvalRequiredFor: ['publish', 'send_message', 'invite', 'delete', 'payment'],
        auditAllActions: true,
      },
      modelCapabilities: ['activity_planning', 'cover_generation', 'conversation_summary', 'moderation_assist'],
    };
  }

  async agentTools(): Promise<Row> {
    const toolsPath = path.resolve(process.cwd(), '../../activity-social-app-product/api/agent-tools.json');
    return JSON.parse(await fs.readFile(toolsPath, 'utf8'));
  }

  private async mediaUrl(mediaId?: string, storageKey?: string): Promise<string | null> {
    if (!mediaId || !storageKey) return null;
    if (storageKey.startsWith('demo-assets/')) return `${config.publicBaseUrl}/${storageKey}`;
    return this.infra.s3.presignedGetObject(config.s3.bucket, storageKey, 15 * 60);
  }

  private async assertConversationMember(userId: string, conversationId: string): Promise<void> {
    const member = await this.infra.pool.query(
      `select 1 from app.conversation_members
       where conversation_id = $1 and user_id = $2 and left_at is null`,
      [conversationId, userId],
    );
    if (!member.rowCount) throw new NotFoundException('Conversation not found');
  }

  private async insertOutbox(aggregateType: string, aggregateId: string, eventType: string, payload: Row): Promise<void> {
    await this.infra.pool.query(
      `insert into app.outbox_events (aggregate_type, aggregate_id, event_type, payload)
       values ($1, $2, $3, $4)`,
      [aggregateType, aggregateId, eventType, JSON.stringify(payload)],
    );
  }

  private async idempotentResponse(userId: string, operationId: string, key?: string): Promise<Row | null> {
    if (!key) return null;
    const result = await this.infra.pool.query(
      `select response_body from app.idempotency_keys
       where principal_type = 'user' and principal_id = $1 and operation_id = $2
         and idempotency_key = $3 and expires_at > now()`,
      [userId, operationId, key],
    );
    return result.rowCount ? result.rows[0].response_body : null;
  }

  private async storeIdempotency(
    client: { query: (text: string, values?: unknown[]) => Promise<unknown> },
    userId: string,
    operationId: string,
    key: string | undefined,
    request: unknown,
    response: unknown,
    resourceId: string,
  ): Promise<void> {
    if (!key) return;
    const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
    await client.query(
      `insert into app.idempotency_keys
       (principal_type, principal_id, operation_id, idempotency_key, request_hash,
        response_status, response_body, resource_id, expires_at)
       values ('user', $1, $2, $3, $4, 201, $5, $6, now() + interval '24 hours')`,
      [userId, operationId, key, requestHash, JSON.stringify(response), resourceId],
    );
  }
}
