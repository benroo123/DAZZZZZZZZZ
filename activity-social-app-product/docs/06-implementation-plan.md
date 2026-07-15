# 前后端实施蓝图

## 1. 移动端：Flutter

### 推荐技术栈

- Flutter stable + Dart 3
- Riverpod：状态与依赖管理
- go_router：声明式导航与登录/实名守卫
- Dio：REST、重试、幂等键与 Token 刷新拦截器
- WebSocket：实时消息；REST 游标负责断线补偿
- freezed/json_serializable：不可变模型和严格 JSON
- secure storage：刷新令牌和设备密钥；普通偏好不与密钥混存
- 国内地图 SDK 原生桥接：定位、地点选择、坐标系显式转换
- 原生 Push：APNs + 国内 Android 厂商通道聚合

### 建议目录

```text
lib/
  app/                 # 路由、主题、启动、feature flags
  core/
    api/               # OpenAPI 生成 client、拦截器、错误
    auth/              # token、设备会话、实名守卫
    design_system/     # 颜色、字号、按钮、卡片、底部弹层
    media/             # 压缩、直传、进度、AI 标识
    realtime/          # websocket + REST 补偿
    safety/            # 举报、拉黑、紧急分享
  features/
    home/              # 推荐/同城、搜索、筛选、混排卡片
    matching/          # 候选、滑动、共同活动建议
    publishing/        # 活动/动态编辑器、AI 封面确认
    messaging/         # 对话、群聊、私信、静默屏蔽
    profile/           # 照片、资料、可见性、匹配偏好
    activity/          # 详情、申请、成员、签到、评价
  generated_api/       # 从 openapi.yaml 生成，禁止手改
```

每个 feature 内使用 `data / domain / presentation` 三层，但不为简单页面创造无意义抽象。领域状态以服务端为准；客户端可乐观更新点赞和已读，名额、审核、拉黑等关键状态必须等待服务端确认。

### 页面路由

```text
/home?mode=recommended|city
/search?q=&type=
/activity/:id
/match
/publish?type=activity|post
/inbox
/conversation/:id
/me
/profile/edit
/approvals
/safety/report
```

## 2. 后端：NestJS 模块化单体

### 推荐目录

```text
src/
  bootstrap/           # app, worker, websocket 启动入口
  shared/
    auth/              # user/agent principal, scopes, guards
    database/          # transaction, repositories, migrations
    events/            # outbox, event envelope, consumers
    observability/     # logs, metrics, tracing, audit
    policy/            # visibility, blocks, rate, approval engine
    storage/           # object store, signed upload/download
  modules/
    identity/
    profile/
    social/
    content/
    activity/
    discovery/
    matching/
    messaging/
    notification/
    media/
    ai/
    safety/
    agent/
    webhook/
  api/
    mobile/             # BFF controllers and response projections
    admin/              # isolated moderation API
  workers/              # outbox, media, AI, search projection, push
```

### 模块内部规则

```text
activity/
  api/                  # controller + DTO, no business rules
  application/          # commands, queries, transactions
  domain/               # activity/member state machines and policies
  infrastructure/       # SQL repository, outbox adapters
  activity.module.ts
```

- Controller 只处理协议、鉴权和 DTO。
- Application service 负责用例与事务。
- Domain 负责人数、候补、状态机和权限等不可绕过规则。
- Infrastructure 可替换存储/第三方实现。
- 模块之间优先调用公开 application port；异步副作用通过事件。

## 3. 关键实现细节

### 防止活动超卖

审核/直接加入在同一事务中锁定活动行，校验 `approved_count < max_participants`，原子更新成员状态和计数；失败者进入候补或返回 `ACTIVITY_FULL`。客户端重试使用相同幂等键。

### 拉黑统一策略

`RelationshipPolicy` 是公共服务，查询双方任一方向的 block。搜索投影做预过滤，业务服务再次强校验，消息网关最后执行写入前校验。缓存更新由 `social.blocked` 事件驱动。

### 图片发布链

```text
选择/生成 -> 直传 -> 病毒扫描 -> EXIF 清理 -> 图片审核
          -> 缩略图 -> AI 显式/隐式标识 -> 用户确认 -> 资源引用 -> 发布
```

没有 `approved` 媒体或未经用户确认的 AI 媒体，活动/动态发布命令必须失败。生成服务不可直接调用 publish。

### 搜索

OpenSearch 使用统一文档：`entity_type`, `entity_id`, `title`, `body`, `city_code`, `geo`, `tags`, `starts_at`, `visibility`, `safety_status`, `popularity_features`。结果 ID 回源 PostgreSQL/BFF 投影，避免索引成为权限事实源。

### 推荐

首发采用规则打分：可参与时间、距离、兴趣、活动成局概率、内容质量、组织者履约、安全和新鲜度。曝光必须带 `impression_id`；点击/申请/签到回传同一链路。为用户提供关闭个性化的入口与非个性化同城时间流。

## 4. 环境与部署

| 环境 | 用途 | 数据 |
|---|---|---|
| local | 单模块开发、契约测试 | 合成数据 |
| dev | 联调、第三方沙箱 | 脱敏测试数据 |
| staging | 上线演练、灰度包 | 生产等价配置，不复制敏感生产数据 |
| production | 单城首发 | 分区、加密、审计、备份 |

建议容器化部署到中国大陆合规云区域；入口使用 CDN/WAF/API Gateway，应用和 Worker 独立扩容。PostgreSQL 主备、多可用区对象存储、Redis 哨兵/托管高可用。第三方短信、地图、实名、推送、模型都通过 Adapter 隔离。

## 5. 测试策略

- Domain 单元测试：人数边界 2/50、候补晋升、取消、审核竞争、拉黑。
- API 契约测试：OpenAPI 请求/响应、错误码、幂等、ETag、Agent scope。
- 集成测试：数据库事务、Outbox、搜索投影、对象存储回调。
- E2E：发布无图活动、AI 确认、申请加入、群聊、签到、评价、静默屏蔽。
- 安全测试：越权、IDOR、上传绕过、重放、WebSocket 权限、提示词注入、Agent 自批权限。
- 移动端视觉回归：320/390/430 宽，字体放大，深浅色（如上线），刘海与底部安全区。

## 6. 12 周 MVP 建议

| 周期 | 重点 |
|---|---|
| 1–2 | 设计系统、登录/资料、媒体直传、数据库迁移、观测基线 |
| 3–4 | 活动草稿/发布/详情、人数与审核状态机 |
| 5–6 | 首页混排、同城筛选、统一搜索基础版 |
| 7–8 | 活动群、私信、关注/拉黑、Push |
| 9 | 搭子候选与匹配、共同活动建议 |
| 10 | AI 封面、显式/隐式标识、审核台 |
| 11 | 签到/评价、数据埋点、安全压测 |
| 12 | 单城灰度、运营后台、应急预案和商店提交 |

团队最小配置：1 产品/运营、1 设计、2 Flutter、2 后端、1 测试/质量，安全合规与算法可由共享角色支持。若团队更小，应延后滑卡匹配和 AI 生成，先保证活动成局闭环。

