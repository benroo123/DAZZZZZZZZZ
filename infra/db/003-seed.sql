SET search_path TO app, public;

INSERT INTO users (id, public_id, status, age_verified, real_name_status) VALUES
  ('11111111-1111-4111-8111-111111111111', 'DC10001', 'active', true, 'verified'),
  ('22222222-2222-4222-8222-222222222222', 'LIN2026', 'active', true, 'verified'),
  ('33333333-3333-4333-8333-333333333333', 'HE0098', 'active', true, 'verified'),
  ('44444444-4444-4444-8444-444444444444', 'WU7788', 'active', true, 'unverified'),
  ('55555555-5555-4555-8555-555555555555', 'CHEN66', 'active', true, 'verified');

INSERT INTO profiles (
  user_id, display_name, birth_date, gender, bio, city_code, district_code,
  occupation, personality_label, preferred_group_min, preferred_group_max,
  completion_percent, attendance_rate, rating, extra_attributes
) VALUES
  ('11111111-1111-4111-8111-111111111111', 'Ben', '1996-06-18', 'male', '喜欢把想法变成真实活动。', '310100', '310104', '产品经理', 'ENTP', 2, 12, 92, 96.00, 4.88, '{"interests":["羽毛球","Citywalk","咖啡"]}'),
  ('22222222-2222-4222-8222-222222222222', '林夏', '1998-04-12', 'female', '周末出门走走，也爱拍城市里的光。', '310100', '310105', '视觉设计师', 'ENFP', 2, 8, 96, 98.00, 4.92, '{"interests":["摄影","展览","Citywalk"]}'),
  ('33333333-3333-4333-8333-333333333333', '何川', '1995-09-20', 'male', '羽毛球和咖啡都认真。', '310100', '310106', '工程师', 'ISTP', 2, 6, 88, 94.00, 4.76, '{"interests":["羽毛球","咖啡","桌游"]}'),
  ('44444444-4444-4444-8444-444444444444', '吴桐', '2000-02-03', 'female', '新手徒步，寻找靠谱搭子。', '310100', '310112', '研究生', 'INFJ', 3, 10, 83, 91.00, 4.70, '{"interests":["徒步","音乐","露营"]}'),
  ('55555555-5555-4555-8555-555555555555', '陈野', '1997-11-08', 'male', '城市探索和现场音乐。', '310100', '310109', '建筑师', 'INTJ', 2, 20, 90, 97.00, 4.85, '{"interests":["Citywalk","音乐","建筑"]}');

INSERT INTO privacy_settings (user_id) SELECT id FROM users;

INSERT INTO media_assets (
  id, owner_user_id, purpose, storage_key, mime_type, byte_size, sha256,
  moderation_status, exif_removed
) VALUES
  ('a1111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'profile', 'demo-assets/profile-lin.jpg', 'image/jpeg', 1, repeat('1', 64), 'approved', true),
  ('a2222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', 'profile', 'demo-assets/profile-he.jpg', 'image/jpeg', 1, repeat('2', 64), 'approved', true),
  ('a3333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', 'profile', 'demo-assets/profile-wu.jpg', 'image/jpeg', 1, repeat('3', 64), 'approved', true),
  ('a4444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555', 'profile', 'demo-assets/profile-chen.jpg', 'image/jpeg', 1, repeat('4', 64), 'approved', true),
  ('b1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'activity', 'demo-assets/badminton.jpg', 'image/jpeg', 1, repeat('5', 64), 'approved', true),
  ('b2222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'activity', 'demo-assets/citywalk.jpg', 'image/jpeg', 1, repeat('6', 64), 'approved', true),
  ('b3333333-3333-4333-8333-333333333333', '55555555-5555-4555-8555-555555555555', 'post', 'demo-assets/friends.jpg', 'image/jpeg', 1, repeat('7', 64), 'approved', true);

INSERT INTO profile_photos (user_id, media_asset_id, position, is_primary) VALUES
  ('22222222-2222-4222-8222-222222222222', 'a1111111-1111-4111-8111-111111111111', 0, true),
  ('33333333-3333-4333-8333-333333333333', 'a2222222-2222-4222-8222-222222222222', 0, true),
  ('44444444-4444-4444-8444-444444444444', 'a3333333-3333-4333-8333-333333333333', 0, true),
  ('55555555-5555-4555-8555-555555555555', 'a4444444-4444-4444-8444-444444444444', 0, true);

INSERT INTO activities (
  id, organizer_id, title, description, category, status, join_policy,
  min_participants, max_participants, approved_count, starts_at, ends_at,
  application_deadline, city_code, district_code, venue_name, public_location,
  cost_type, moderation_status, published_at
) VALUES
  ('c1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '周三下班羽毛球', '徐汇体育馆双打，新手友好，打完一起吃夜宵。', '运动', 'published', 'approval', 4, 8, 5, now() + interval '2 days', now() + interval '2 days 2 hours', now() + interval '1 day', '310100', '310104', '徐汇体育馆', ST_GeogFromText('POINT(121.437 31.183)'), 'aa', 'approved', now() - interval '2 hours'),
  ('c2222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', '苏州河黄昏 Citywalk', '从昌平路走到外白渡桥，边走边拍照。', 'Citywalk', 'published', 'open', 3, 12, 7, now() + interval '3 days', now() + interval '3 days 3 hours', now() + interval '2 days', '310100', '310106', '昌平路地铁站', ST_GeogFromText('POINT(121.449 31.240)'), 'free', 'approved', now() - interval '1 hour'),
  ('c3333333-3333-4333-8333-333333333333', '55555555-5555-4555-8555-555555555555', '周末独立音乐现场', '一起看现场，结束后可以附近喝一杯。', '音乐', 'published', 'approval', 2, 6, 3, now() + interval '5 days', now() + interval '5 days 4 hours', now() + interval '4 days', '310100', '310109', '杨浦滨江', ST_GeogFromText('POINT(121.536 31.267)'), 'fixed', 'approved', now() - interval '30 minutes');

INSERT INTO activity_media (activity_id, media_asset_id, position) VALUES
  ('c1111111-1111-4111-8111-111111111111', 'b1111111-1111-4111-8111-111111111111', 0),
  ('c2222222-2222-4222-8222-222222222222', 'b2222222-2222-4222-8222-222222222222', 0),
  ('c3333333-3333-4333-8333-333333333333', 'b3333333-3333-4333-8333-333333333333', 0);

INSERT INTO activity_members (activity_id, user_id, role, status, joined_at) VALUES
  ('c1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'organizer', 'joined', now()),
  ('c2222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'organizer', 'joined', now()),
  ('c3333333-3333-4333-8333-333333333333', '55555555-5555-4555-8555-555555555555', 'organizer', 'joined', now());

INSERT INTO posts (
  id, author_id, status, body, city_code, visibility, moderation_status, published_at
) VALUES
  ('d1111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'published', '今天的城市光线太好了，苏州河边随手拍都很有故事。', '310100', 'public', 'approved', now() - interval '45 minutes'),
  ('d2222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', 'published', '第一次和搭子们打混双，水平不同也玩得很开心。', '310100', 'public', 'approved', now() - interval '20 minutes');

INSERT INTO post_media (post_id, media_asset_id, position) VALUES
  ('d1111111-1111-4111-8111-111111111111', 'b2222222-2222-4222-8222-222222222222', 0),
  ('d2222222-2222-4222-8222-222222222222', 'b3333333-3333-4333-8333-333333333333', 0);

INSERT INTO follows (follower_id, followed_id) VALUES
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111'),
  ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111');

INSERT INTO conversations (id, type, title, created_by, last_message_at) VALUES
  ('e1111111-1111-4111-8111-111111111111', 'direct', '林夏', '11111111-1111-4111-8111-111111111111', now() - interval '5 minutes'),
  ('e2222222-2222-4222-8222-222222222222', 'system', '活动通知', '11111111-1111-4111-8111-111111111111', now() - interval '1 hour');

INSERT INTO conversation_members (conversation_id, user_id, role) VALUES
  ('e1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'member'),
  ('e1111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'member'),
  ('e2222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'member');

INSERT INTO messages (id, conversation_id, sender_id, client_message_id, type, body_ciphertext, moderation_status, created_at) VALUES
  ('f1111111-1111-4111-8111-111111111111', 'e1111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'seed-1', 'text', convert_to('周六 Citywalk 还差一个人，要一起吗？', 'UTF8'), 'approved', now() - interval '5 minutes'),
  ('f2222222-2222-4222-8222-222222222222', 'e2222222-2222-4222-8222-222222222222', NULL, 'seed-2', 'system', convert_to('你报名的羽毛球活动已通过审核', 'UTF8'), 'approved', now() - interval '1 hour');

UPDATE conversations SET last_message_id = 'f1111111-1111-4111-8111-111111111111' WHERE id = 'e1111111-1111-4111-8111-111111111111';
UPDATE conversations SET last_message_id = 'f2222222-2222-4222-8222-222222222222' WHERE id = 'e2222222-2222-4222-8222-222222222222';

INSERT INTO notifications (user_id, type, title, body) VALUES
  ('11111111-1111-4111-8111-111111111111', 'follow', '新的关注', '吴桐关注了你'),
  ('11111111-1111-4111-8111-111111111111', 'activity', '报名通过', '周三下班羽毛球报名已通过');
