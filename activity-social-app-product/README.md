# 搭场：活动搭子移动社交产品包

搭场不是“先匹配、再尬聊”的陌生人社交，而是“先有一件想做的事，再遇见合适的人”。产品以 2–50 人真实活动为核心，动态内容负责激发兴趣，一对一搭子匹配负责补充关系建立。

## 推荐结论

- **首发视觉：清透蓝**。信任感、可读性和 App Store 级完成度最好，适合陌生人线下社交。
- **品牌备选：极光青**。更有蔚来式科技和社区气质，适合品牌希望显得更独特时使用。
- **增长活动色：日出橙**。行动感最强，可以作为节日、城市主题活动皮肤，不建议首发全局使用。
- **交互调整：推荐/同城使用单击切换**；双击可作为刷新快捷动作，但不能成为唯一操作。
- **筛选使用底部弹层**，而不是桌面式下拉框；在手机上更容易承载地点、距离、时间、人数等多条件。
- **活动和动态可混排，但必须双编码**：颜色标签 + “活动/动态”文字，不只依赖颜色。

## 交付索引

### 原型与视觉

- [可交互手机原型](prototype/index.html)
- [视觉变量](prototype/design-tokens.json)
- [清透蓝五页面总览](prototype/contact-sheets/blue.png)
- [极光青五页面总览](prototype/contact-sheets/teal.png)
- [日出橙五页面总览](prototype/contact-sheets/coral.png)
- [八套首页风格总对比](prototype/contact-sheets/style-comparison.png)
- [午夜红五页面总览](prototype/contact-sheets/midnight.png)
- [电光撞色五页面总览](prototype/contact-sheets/clash.png)
- [钴蓝波普五页面总览](prototype/contact-sheets/cobalt.png)
- [森林米白五页面总览](prototype/contact-sheets/forest.png)
- [黑灰冰蓝五页面总览](prototype/contact-sheets/mono.png)
- [首页筛选弹层](prototype/screens/blue/home-filter.png)
- [产品与 UI 规格](docs/01-product-ui-spec.md)
- [八套界面与品牌方向比较](docs/08-style-directions.md)

原型参数示例：`prototype/index.html?theme=blue&screen=home`。`theme` 可取 `blue/teal/coral`，`screen` 可取 `home/match/publish/messages/profile`。

### 技术设计

- [系统架构与非功能设计](docs/02-architecture.md)
- [数据库模型说明](docs/03-database-design.md)
- [PostgreSQL/PostGIS 建表基线](database/schema.sql)
- [完整接口目录](docs/04-api-catalog.md)
- [OpenAPI 3.1 规格](api/openapi.yaml)
- [Agent 化与审批模型](docs/05-agentization.md)
- [前后端实施蓝图](docs/06-implementation-plan.md)
- [中国大陆上线合规检查表](docs/07-mainland-compliance.md)
- [Agent 工具定义](api/agent-tools.json)
- [领域事件与 Webhook](api/events.md)

## 建议的 MVP 边界

首个城市先验证“活动能否成局”，不是一次做完整社交平台。MVP 应保留：首页混排与同城筛选、活动创建/审核/加入/群聊、个人资料与实名认证状态、举报/拉黑、基础一对一搭子匹配。复杂推荐、支付担保、AI 自动代理发布、多城市运营放到数据闭环成立后。

核心北极星指标：**每周成功成局且至少两人签到的活动数**。配套观察浏览到申请率、申请通过率、成局率、到场率、7/30 天复组率和安全事件率。
