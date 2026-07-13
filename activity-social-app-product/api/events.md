# 领域事件与 Webhook

所有外部 Webhook 使用 HTTPS，JSON 正文，至少一次投递。请求头包含：

- `X-DAZZZZZZZZZ-Event-Id`
- `X-DAZZZZZZZZZ-Event-Type`
- `X-DAZZZZZZZZZ-Event-Version`
- `X-DAZZZZZZZZZ-Timestamp`
- `X-DAZZZZZZZZZ-Signature: v1=<HMAC-SHA256>`

消费者应以 `event_id` 幂等去重，先校验时间窗口和签名，再处理正文。2xx 视为成功；失败按指数退避，达到阈值进入死信并暂停异常端点。

## 事件信封

```json
{
  "event_id": "4abca513-06e6-4dcb-8262-cc14bb74f2a0",
  "event_type": "activity.member_updated",
  "event_version": 1,
  "occurred_at": "2026-07-13T10:00:00+08:00",
  "correlation_id": "c76f6174-6e62-4f02-a3b1-cf3a3e0b6f3f",
  "subject": { "type": "activity", "id": "e2c0a47c-a43f-47ed-8466-62be8f04c504" },
  "data": {},
  "privacy_class": "internal"
}
```

Webhook 数据是面向订阅者的最小投影，不等于内部 Outbox 全量 payload。不会包含手机号、实名原文、精确常住位置、静默屏蔽策略或内部风控分。

## 事件目录

| 事件 | 触发点 | 典型消费者 |
|---|---|---|
| `profile.updated` | 资料或可见性改变 | 搜索索引、推荐特征、审计 |
| `social.followed` | 关注建立 | 通知、关系计数 |
| `social.blocked` | 标准/静默屏蔽 | 搜索、推荐、匹配、活动、消息缓存失效 |
| `post.published` | 动态审核通过并发布 | 首页索引、通知、分析 |
| `post.deleted` | 动态删除/隐藏 | 搜索删除、缓存失效 |
| `activity.published` | 活动可见 | 搜索、推荐、通知 |
| `activity.updated` | 时间/地点/名额等变化 | 成员通知、索引、Agent |
| `activity.cancelled` | 活动取消 | 成员通知、退款流程（未来） |
| `activity.member_updated` | 申请/候补/审核/退出 | 群成员同步、名额、通知 |
| `activity.full` | 名额达到上限 | 索引状态、候补策略 |
| `activity.checkin_recorded` | 成员签到 | 履约、评价开放、分析 |
| `activity.completed` | 活动完成 | 双盲评价、复组建议 |
| `match.created` | 双向喜欢 | 私聊资格、共同活动推荐 |
| `match.ended` | 解除/拉黑 | 私聊权限、推荐排除 |
| `conversation.created` | 私聊/活动群建立 | 实时网关、通知 |
| `message.created` | 消息持久化并通过策略 | 实时推送、Push、审核抽检 |
| `message.read` | 已读游标推进 | 实时同步 |
| `ai.generation_completed` | AI 任务完成 | App/Agent 预览通知 |
| `ai.asset_confirmed` | 用户确认具体生成物 | 发布前置校验 |
| `moderation.case_opened` | 举报或模型命中 | 人工审核台 |
| `moderation.decision_applied` | 处置执行 | 内容/账号、通知、申诉 |
| `agent.approval_requested` | 高风险动作待确认 | App 审批中心、Push |
| `agent.action_completed` | Agent 动作执行完成 | Agent 回调、审计 |

## 版本策略

新增可选字段不提升大版本；删除/改名/语义变化发布新的 `event_version`。消费者声明支持版本范围，平台在迁移窗口内并行发送旧版和新版。内部事件不可直接当作公共 Webhook，避免未来领域重构破坏合作方。
