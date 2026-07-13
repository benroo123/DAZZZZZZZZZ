# API 完整目录

公共前缀为 `/v1`。移动端和 Agent 使用同一组领域 API，但 Agent 必须额外携带 Agent 身份与授权，且高风险命令会返回审批需求。

## 1. 通用约定

- 鉴权：`Authorization: Bearer <token>`。
- 所有创建/状态变更请求必须携带 `Idempotency-Key`。
- 每个请求接受/返回 `X-Correlation-Id`；Agent 请求附 `X-Agent-Principal`。
- 列表使用不透明 `cursor`，返回 `next_cursor`，不使用深页码。
- 命令可带 `dry_run=true` 或 `Prefer: preview`，返回预计变更、策略命中和是否需审批。
- 异步任务返回 `202` + `job_id` + `status_url`。
- 乐观并发通过 `If-Match` / `ETag` 或请求中的 `version`。
- 错误统一为 `code`, `message`, `details`, `correlation_id`, `retryable`。
- 时间为 ISO 8601；金额为最小货币单位；坐标显式指定 `coordinate_system`。
- 每个资源都返回 `visibility`、`capabilities` 或可执行动作，Agent 不应猜测权限。

## 2. 系统、认证与实名

| 方法 | 路径 | operationId | 用途 |
|---|---|---|---|
| GET | `/system/config` | `getSystemConfig` | 客户端开关、最低版本、AI 模型披露信息 |
| GET | `/system/health` | `getHealth` | 健康检查 |
| POST | `/auth/otp/request` | `requestOtp` | 请求短信验证码 |
| POST | `/auth/otp/verify` | `verifyOtp` | 登录/注册并签发令牌 |
| POST | `/auth/token/refresh` | `refreshToken` | 旋转刷新令牌 |
| POST | `/auth/logout` | `logout` | 注销当前设备会话 |
| GET | `/auth/sessions` | `listSessions` | 查看登录设备 |
| DELETE | `/auth/sessions/{session_id}` | `revokeSession` | 撤销设备会话 |
| POST | `/identity/real-name/sessions` | `createRealNameSession` | 创建实名供应商会话 |
| GET | `/identity/real-name/status` | `getRealNameStatus` | 查询实名结果，不返回证件原文 |

## 3. 用户、资料与关系

| 方法 | 路径 | operationId | 用途 |
|---|---|---|---|
| GET/PATCH | `/me/profile` | `getMyProfile` / `updateMyProfile` | 查看/更新本人资料与字段可见性 |
| GET | `/users/{user_id}` | `getUserProfile` | 获取经可见性过滤的公开资料 |
| GET | `/users/by-public-id/{public_id}` | `getUserByPublicId` | 公开 ID 查找用户 |
| POST | `/me/photos` | `addProfilePhoto` | 添加资料照片 |
| PATCH | `/me/photos/{photo_id}` | `updateProfilePhoto` | 排序/设主图 |
| DELETE | `/me/photos/{photo_id}` | `deleteProfilePhoto` | 删除照片 |
| GET | `/interests` | `listInterests` | 兴趣词典 |
| PUT | `/me/interests` | `replaceMyInterests` | 批量更新兴趣 |
| GET/PATCH | `/me/preferences/match` | `getMatchPreferences` / `updateMatchPreferences` | 匹配偏好 |
| GET/PATCH | `/me/privacy` | `getPrivacySettings` / `updatePrivacySettings` | 个性化推荐、位置、Agent 权限与字段可见性 |
| POST/DELETE | `/users/{user_id}/follow` | `followUser` / `unfollowUser` | 关注/取消关注 |
| GET | `/me/follows` | `listFollowing` | 我关注的人 |
| GET | `/me/followers` | `listFollowers` | 关注我的人 |
| POST | `/users/{user_id}/block` | `blockUser` | 标准或静默屏蔽 |
| DELETE | `/users/{user_id}/block` | `unblockUser` | 解除屏蔽 |
| GET | `/me/blocks` | `listBlockedUsers` | 屏蔽列表 |

## 4. 首页、统一搜索与行为事件

| 方法 | 路径 | operationId | 用途 |
|---|---|---|---|
| GET | `/feed` | `getHomeFeed` | 推荐/同城混排活动与动态 |
| GET | `/search` | `searchEntities` | 搜活动、地点、名称、帖子、人员 |
| GET | `/search/suggestions` | `getSearchSuggestions` | 搜索补全与历史 |
| GET | `/activities/nearby` | `listNearbyActivities` | 结构化活动筛选与地理排序 |
| POST | `/events/batch` | `ingestClientEvents` | 曝光、点击、停留、筛选和转化事件批量上报 |

`/feed` 和 `/activities/nearby` 支持：`mode`, `city_code`, `lat`, `lng`, `coordinate_system`, `radius_km`, `categories`, `starts_after`, `starts_before`, `participant_min`, `participant_max`, `real_name_required`, `cursor`, `limit`。

## 5. 媒体与 AI

| 方法 | 路径 | operationId | 用途 |
|---|---|---|---|
| POST | `/media/uploads` | `createMediaUpload` | 创建对象存储直传会话 |
| POST | `/media/uploads/{upload_id}/complete` | `completeMediaUpload` | 完成上传、触发扫描审核 |
| GET | `/media/{media_id}` | `getMediaAsset` | 获取媒体状态和短期访问地址 |
| DELETE | `/media/{media_id}` | `deleteMediaAsset` | 删除未被资源引用的媒体 |
| POST | `/ai/generations` | `createAiGeneration` | 创建活动/动态封面或摘要任务 |
| GET | `/ai/generations/{job_id}` | `getAiGeneration` | 查询任务与 AI 标识信息 |
| POST | `/ai/generations/{job_id}/confirm` | `confirmAiGeneration` | 用户确认使用生成结果 |
| POST | `/ai/generations/{job_id}/cancel` | `cancelAiGeneration` | 取消任务 |

## 6. 动态内容

| 方法 | 路径 | operationId | 用途 |
|---|---|---|---|
| POST | `/posts` | `createPost` | 创建草稿，至少一个媒体 |
| GET/PATCH/DELETE | `/posts/{post_id}` | `getPost` / `updatePost` / `deletePost` | 读写动态 |
| POST | `/posts/{post_id}/publish` | `publishPost` | 发布并触发审核/审批 |
| POST/DELETE | `/posts/{post_id}/reactions/{reaction}` | `reactToPost` / `removePostReaction` | 点赞等互动 |
| GET/POST | `/posts/{post_id}/comments` | `listComments` / `createComment` | 评论列表/创建 |
| PATCH/DELETE | `/comments/{comment_id}` | `updateComment` / `deleteComment` | 编辑/删除评论 |

## 7. 活动与成局

| 方法 | 路径 | operationId | 用途 |
|---|---|---|---|
| POST | `/activities` | `createActivity` | 创建活动草稿 |
| GET/PATCH/DELETE | `/activities/{activity_id}` | `getActivity` / `updateActivity` / `deleteActivity` | 读写草稿/活动 |
| POST | `/activities/{activity_id}/publish` | `publishActivity` | 发布活动 |
| POST | `/activities/{activity_id}/cancel` | `cancelActivity` | 取消并通知成员 |
| POST | `/activities/{activity_id}/join` | `joinActivity` | 申请、直接加入或进入候补 |
| DELETE | `/activities/{activity_id}/join` | `leaveActivity` | 撤回申请/退出活动 |
| GET | `/activities/{activity_id}/members` | `listActivityMembers` | 组织者与允许的成员查看列表 |
| POST | `/activities/{activity_id}/members/{user_id}/approve` | `approveActivityMember` | 审核通过，原子占用名额 |
| POST | `/activities/{activity_id}/members/{user_id}/reject` | `rejectActivityMember` | 拒绝申请 |
| DELETE | `/activities/{activity_id}/members/{user_id}` | `removeActivityMember` | 移出成员 |
| POST | `/activities/{activity_id}/invites` | `inviteToActivity` | 邀请用户 |
| POST | `/activity-invites/{invite_id}/respond` | `respondActivityInvite` | 接受/拒绝邀请 |
| POST | `/activities/{activity_id}/check-in-token` | `createCheckinToken` | 组织者生成短期签到凭证 |
| POST | `/activities/{activity_id}/check-ins` | `checkInActivity` | 参与者签到 |
| POST | `/activities/{activity_id}/reviews` | `createActivityReview` | 活动后双盲评价 |
| GET | `/activities/{activity_id}/reviews` | `listActivityReviews` | 达到可见时间后读取评价 |

## 8. 搭子匹配

| 方法 | 路径 | operationId | 用途 |
|---|---|---|---|
| GET | `/matching/candidates` | `listMatchCandidates` | 获取已过滤的匹配候选与解释 |
| POST | `/matching/swipes` | `submitSwipe` | pass/like/super_like，幂等 |
| GET | `/matches` | `listMatches` | 匹配列表 |
| GET | `/matches/{match_id}` | `getMatch` | 匹配详情和共同活动建议 |
| DELETE | `/matches/{match_id}` | `unmatch` | 解除匹配，不通知具体原因 |

## 9. 消息、群组与通知

| 方法 | 路径 | operationId | 用途 |
|---|---|---|---|
| GET | `/conversations` | `listConversations` | 对话列表与未读数 |
| POST | `/conversations/direct` | `createDirectConversation` | 仅满足关系/风控条件时创建私聊 |
| GET | `/conversations/{conversation_id}` | `getConversation` | 会话详情 |
| GET/POST | `/conversations/{conversation_id}/messages` | `listMessages` / `sendMessage` | 历史消息/发送 |
| POST | `/conversations/{conversation_id}/summary` | `summarizeConversation` | 在授权范围内生成会话摘要，不向 Agent 暴露原始全文 |
| POST | `/conversations/{conversation_id}/read` | `markConversationRead` | 更新已读游标 |
| PATCH | `/conversations/{conversation_id}/preferences` | `updateConversationPreferences` | 免打扰、隐藏 |
| DELETE | `/messages/{message_id}` | `deleteMessage` | 撤回/本人删除，按策略执行 |
| GET | `/notifications` | `listNotifications` | 系统通知 |
| POST | `/notifications/read` | `markNotificationsRead` | 批量已读 |
| GET/PATCH | `/me/notification-preferences` | `getNotificationPreferences` / `updateNotificationPreferences` | Push 与聚合偏好 |

实时通道：`wss://api.example.com/v1/realtime?token=...`。事件包括 `message.created`, `message.read`, `conversation.updated`, `activity.member_updated`, `notification.created`。客户端断线后必须用 REST 游标补偿。

## 10. 举报、安全、数据权利

| 方法 | 路径 | operationId | 用途 |
|---|---|---|---|
| POST | `/reports` | `createReport` | 举报用户/内容/活动/消息 |
| GET | `/reports/{report_id}` | `getReport` | 举报人查看处理状态 |
| POST | `/safety/emergency-shares` | `createEmergencyShare` | 创建限时行程分享 |
| DELETE | `/safety/emergency-shares/{share_id}` | `revokeEmergencyShare` | 撤销分享 |
| POST | `/me/data-exports` | `requestDataExport` | 个人数据导出任务 |
| GET | `/me/data-exports/{job_id}` | `getDataExport` | 查询导出状态 |
| POST | `/me/deletion-requests` | `requestAccountDeletion` | 账户删除/注销申请 |
| DELETE | `/me/deletion-requests/{request_id}` | `cancelAccountDeletion` | 冷静期内撤销 |

## 11. Agent 与 Webhook

| 方法 | 路径 | operationId | 用途 |
|---|---|---|---|
| GET | `/agent/manifest` | `getAgentManifest` | 能力、风险和审批策略清单 |
| GET | `/agent/tools` | `listAgentTools` | 可调用工具 JSON Schema |
| POST | `/agent/runs` | `createAgentRun` | 声明目标和委托上下文 |
| GET | `/agent/runs/{run_id}` | `getAgentRun` | 计划、动作和状态 |
| POST | `/agent/runs/{run_id}/actions:execute` | `executeAgentAction` | 单步 dry-run/execute |
| POST | `/agent/runs/{run_id}/cancel` | `cancelAgentRun` | 取消工作流 |
| GET | `/agent/approvals` | `listAgentApprovals` | 用户待审批列表 |
| POST | `/agent/approvals/{approval_id}/decision` | `decideAgentApproval` | 批准/拒绝，绑定动作摘要 |
| POST | `/webhooks` | `createWebhook` | 创建事件订阅 |
| GET | `/webhooks` | `listWebhooks` | 列出订阅 |
| PATCH/DELETE | `/webhooks/{webhook_id}` | `updateWebhook` / `deleteWebhook` | 更新/删除订阅 |
| POST | `/webhooks/{webhook_id}/rotate-secret` | `rotateWebhookSecret` | 轮换签名密钥 |

## 12. 未来支付接口（启用前另做合规和牌照评估）

| 方法 | 路径 | operationId | 用途 |
|---|---|---|---|
| POST | `/activities/{activity_id}/orders` | `createActivityOrder` | 创建活动费用订单 |
| GET | `/orders/{order_id}` | `getOrder` | 订单状态 |
| POST | `/orders/{order_id}/pay` | `payOrder` | 调起持牌支付渠道 |
| POST | `/orders/{order_id}/refunds` | `requestRefund` | 退款申请，高风险 Agent 动作 |

支付接口默认不在 MVP 开启；平台不得自行沉淀资金。

机器可读的核心规格见 [`api/openapi.yaml`](../api/openapi.yaml)，Agent 函数定义见 [`api/agent-tools.json`](../api/agent-tools.json)。
