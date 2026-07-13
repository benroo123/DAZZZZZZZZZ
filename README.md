# 搭场（Dachang）可运行产品基线

这是一个面向 iOS / Android 的“活动搭子”产品：用户先决定想做什么，再找到合适的人，组织 2–50 人活动。仓库不仅包含 UI 原型和完整接口设计，也包含已经接通数据库、缓存、消息队列、对象存储和 AI 工作流的可运行代码。

## 已实现

- Expo React Native 移动端：`首页 / 搭子 / 发布 / 消息 / 我的` 五个底部页签。
- 首页：推荐/同城、活动与动态混排、多实体搜索、活动筛选底部弹层。
- 搭子：真人照片、公开 ID、实名状态、年龄、职业、性格、兴趣和喜欢/略过操作。
- 发布：图片必填；无图时自动创建 AI 配图任务，用户先得到“发布已受理”，Worker 异步完成生成、审核和正式发布。
- 消息：关注关系摘要、群组/个人会话、真实消息发送和静默拉黑交互。
- 资料：照片入口、年龄和匹配资料、资料完整度、到场率、信用评分。
- 八套完整主题：清透蓝、极光青、日出橙、午夜红、电光撞色、钴蓝波普、森林米白、黑灰冰蓝。
- 两套等价后端：NestJS + TypeScript（推荐主版本）和 FastAPI + Python（模型/数据团队友好版本）。
- PostgreSQL/PostGIS、Redis、RabbitMQ、MinIO、Transactional Outbox、重试队列、死信队列、幂等键和 Agent 工具协议。

## 目录

| 路径 | 内容 |
|---|---|
| `apps/mobile` | Expo React Native 移动 App，Web 只作为本地快速测试面 |
| `services/api-ts` | 推荐主后端和异步 Worker |
| `services/api-python` | Python 等价 API 和异步 Worker |
| `infra/db` | 运行时迁移与演示种子数据 |
| `packages/contracts` | 两端共享的接口说明与八套主题 Token |
| `tests/e2e` | 两套 API、MQ、对象存储和五页签端到端测试 |
| `activity-social-app-product` | 产品规格、完整 OpenAPI、115 个操作、表设计、Agent 方案和 41 张原型图 |

## 最快启动

前置依赖：Docker、Node.js 22+、Python 3.12+。

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
cd services/api-python && .venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8100
cd services/api-python && .venv/bin/python -m app.worker

# 移动端本地测试面
npm run dev:mobile
```

本机地址：

- 移动端测试面：<http://127.0.0.1:19006>
- TypeScript API：<http://127.0.0.1:3100/v1/docs>
- Python API：<http://127.0.0.1:8100/v1/docs>
- RabbitMQ 控制台：<http://127.0.0.1:15673>（`dachang / dachang`）
- MinIO 控制台：<http://127.0.0.1:59001>（`dachang / dachang-local-secret`）

本地演示鉴权为 `Authorization: Bearer demo-user`。真机不能用 `127.0.0.1` 访问电脑，扫码前要设置局域网地址：

```bash
EXPO_PUBLIC_API_BASE_URL=http://你的电脑局域网IP:3100/v1 npm --workspace @dachang/mobile start
```

## 验证

真实服务保持运行后：

```bash
npm run test:all
```

该命令覆盖 TypeScript/Python 单元和静态检查、移动端主题契约、原生 JS Bundle、API 等价性、权限/校验、幂等发布、MQ Worker、AI 配图、直接对象上传，以及五个移动端页面的真实浏览器交互。

更详细的运行、部署和故障处理见 [本地运行说明](docs/LOCAL-RUNTIME.md) 与 [多 Pod 部署说明](docs/DEPLOYMENT.md)。产品和完整接口索引见 [产品包](activity-social-app-product/README.md)。
