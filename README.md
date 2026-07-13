# DAZZZZZZZZZ 可运行产品基线

这是一个面向 iOS / Android 的“活动搭子”产品：用户先决定想做什么，再找到合适的人，组织 2–50 人活动。仓库不仅包含 UI 原型和完整接口设计，也包含已经接通数据库、缓存、消息队列、对象存储和 AI 工作流的可运行代码。

产品对外品牌统一为 **DAZZZZZZZZZ**。现有 `@dachang/*` npm scope、`dachang-dev` 本地 machine、数据库账号、MQ exchange 和监控指标属于内部稳定标识，暂不随品牌名变化，避免破坏开发环境和接口兼容。

## 已实现

- Expo React Native 移动端：`首页 / 搭子 / 发布 / 消息 / 我的` 五个底部页签。
- 首页：推荐/同城、活动与动态混排、多实体搜索、活动筛选底部弹层。
- 搭子：真人照片、公开 ID、实名状态、年龄、职业、性格、兴趣和喜欢/略过操作。
- 发布：图片必填；无图时自动创建 AI 配图任务，用户先得到“发布已受理”，Worker 异步完成生成、审核和正式发布。
- 消息：关注关系摘要、群组/个人会话、真实消息发送和静默拉黑交互。
- 资料：照片入口、年龄和匹配资料、资料完整度、到场率、信用评分。
- 八套完整主题：清透蓝、极光青、日出橙、午夜红、电光撞色、钴蓝波普、森林米白、黑灰冰蓝。
- 两套等价后端：NestJS + TypeScript（推荐主版本）和 FastAPI + Python（模型/数据团队友好版本）。
- Supabase SDK 与 Auth：Expo 会话持久化、两套后端的 JWT/JWKS 验证，以及 `auth.users` 到业务用户的自动桥接。
- OrbStack 原生 Linux 服务：PostgreSQL/PostGIS、Redis、RabbitMQ、MinIO，以及 Transactional Outbox、重试队列、死信队列、幂等键和 Agent 工具协议。

## 目录

| 路径 | 内容 |
|---|---|
| `apps/mobile` | Expo React Native 移动 App，Web 只作为本地快速测试面 |
| `services/api-ts` | 推荐主后端和异步 Worker |
| `services/api-python` | Python 等价 API 和异步 Worker |
| `infra/db` | 运行时迁移与演示种子数据 |
| `infra/supabase` | Supabase Auth 用户与业务 schema 的桥接迁移 |
| `scripts/orbstack` | 创建 OrbStack Ubuntu machine，并以 systemd 管理全部基础设施 |
| `packages/contracts` | 两端共享的接口说明与八套主题 Token |
| `tests/e2e` | 两套 API、MQ、对象存储和五页签端到端测试 |
| `activity-social-app-product` | 产品规格、完整 OpenAPI、115 个操作、表设计、Agent 方案和 41 张原型图 |

## 最快启动

前置依赖：OrbStack 2+、Node.js 22+、Python 3.12+。

```bash
cd /Users/benroo.liu/Documents/trae_projects/DAZZZZZZZZZ
npm install
npm run infra:up

python3 -m venv services/api-python/.venv
services/api-python/.venv/bin/pip install -e 'services/api-python[dev]'
```

然后分别打开终端运行：

```bash
# 推荐主后端
npm run dev:ts
npm run worker:ts

# Python 等价后端
npm run dev:python
npm run worker:python

# 移动端本地测试面
npm run dev:mobile
```

本机地址：

- 移动端测试面：<http://127.0.0.1:19006>
- TypeScript API：<http://127.0.0.1:3100/v1/docs>
- Python API：<http://127.0.0.1:8100/v1/docs>
- RabbitMQ 控制台：<http://127.0.0.1:15672>（`dachang / dachang`）
- MinIO 控制台：<http://127.0.0.1:9001>（`dachang / dachang-local-secret`）

`npm run infra:up` 首次会创建名为 `dachang-dev` 的 Ubuntu 24.04 machine，在其中直接安装并运行四个 systemd 服务。可用 `npm run infra:status` 查看状态，`npm run infra:down` 停止 machine。

本地演示鉴权为 `Authorization: Bearer demo-user`。真机不能用 `127.0.0.1` 访问电脑，扫码前要设置局域网地址：

```bash
EXPO_PUBLIC_API_BASE_URL=http://你的电脑局域网IP:3100/v1 npm --workspace @dachang/mobile start
```

## Supabase 接入

Expo 使用 `EXPO_PUBLIC_SUPABASE_URL` 和 `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`；这两项会进入客户端 Bundle。`SUPABASE_SECRET_KEY` 和数据库密码只能放在服务端密钥管理中，不能使用 `EXPO_PUBLIC_` 前缀，也不能提交到 Git。

两套后端支持三种 `AUTH_MODE`：`demo` 仅供本地测试，`hybrid` 同时接受本地演示 Token 和 Supabase JWT，`supabase` 用于生产。后端通过 `SUPABASE_JWKS_URL` 验证 JWT，并将 `sub` 作为业务用户 ID。

把完整且已转义的云数据库连接串写入未跟踪的根目录 `.env.local` 后，可从 OrbStack machine 执行迁移：

```bash
SUPABASE_DATABASE_URL=postgresql://... # 写入 .env.local，不要直接提交
npm run supabase:migrate
```

迁移会安装业务 schema 和 `auth.users` 触发器，不会默认写入演示数据；如需临时测试数据，显式设置 `SUPABASE_SEED_DEMO=true`。

## 验证

真实服务保持运行后：

```bash
npm run test:all
```

该命令覆盖 TypeScript/Python 单元和静态检查、移动端主题契约、原生 JS Bundle、API 等价性、权限/校验、幂等发布、MQ Worker、AI 配图、直接对象上传，以及五个移动端页面的真实浏览器交互。

更详细的运行、部署和故障处理见 [本地运行说明](docs/LOCAL-RUNTIME.md) 与 [多 Pod 部署说明](docs/DEPLOYMENT.md)。产品和完整接口索引见 [产品包](activity-social-app-product/README.md)。
