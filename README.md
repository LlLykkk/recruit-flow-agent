# 招生控流智能体（recruit-flow-agent）

把《招生控流智能体方案（总体框架）》里的 **五步闭环 + 四方角色** 落成一套**可部署在腾讯云 CloudBase** 的飞书原生多角色 Agent。MVP 锁定 **温州慧中公学**。

- 部署：腾讯云 CloudBase HTTP 云函数（监听 9000）
- 对接：飞书（事件/消息/多维表），`FEISHU_MODE=mock|real` 开关，无凭证也能本地跑通
- 模型：腾讯混元（缺密钥时规则化回退）
- 角色：行动官 / 传导官 / 督进官 / 执行助手 + 编排器（状态机）

---

## 1. 本地运行（无需任何凭证）

```bash
cd recruit-flow-agent
npm install
npm run demo        # 端到端跑一次五步闭环（温州慧中公学 MVP）
npm test            # 最小闭环自检
npm start           # 启动 Express（/health、/feishu/webhook、/、/demo）
```

默认 `FEISHU_MODE=mock`：飞书消息/多维表全部走内存模拟，大模型无密钥时走规则回退，**完整可跑通**。

启动后访问 `http://localhost:9000` 进入**交互式演示页**：

- 顶部流程条显示五步闭环进度（行动下发 → 任务拆解 → 落地执行 → 凭证上传与审核 → 终审归档）；右上角「逾期提醒」浮钮实时显示逾期项数。
- ① 新建行动表单：选/建学校（可填**学校性质 / 招办性质 / 学段**，下拉均可「＋新建选项」）、填行动标题、**行动难度**（低/中/高，驱动拆解任务数）、**大行动责任人**（默认招生管家）、**大行动截止时间**。
- 逐步点「下一步」推进；每步右侧卡片展示对应角色（行动官/传导官/执行助手/督进官）的真实输出。
- **④ 凭证上传与审核**：进入「凭证上传」阶段后，家服主任**逐任务**填凭证类型/内容、**传图片**、点「上传凭证」；上传齐后进入「凭证初审」人审闸。
- **小行动可改责任人与截止时间**（每个任务卡内「保存」）；传导官会按大行动截止窗口把小行动截止时间均摊到各任务。
- **逾期自动提醒**：大行动/小行动超过截止时间未闭环即标红；点右上「逾期提醒」或页面「检查逾期」扫描，mock 模式列出逾期项+责任人，real 模式（飞书）给责任人发提醒。
- **两道「人审闸」由你点按钮裁决**：`凭证审核`阶段逐张点「通过/驳回」，`终审归档`阶段点「通过终审并归档 / 驳回整改」—— 还原方案里"机器干活、人保判断"的设计。
- **角色与权限（RBAC）**：顶部角色栏可随时切换「管理员 / 五方默认角色（行动官·传导官·执行助手·家服主任·督进官）」。
  - **全员可看全部步骤**：任何角色都能看到完整的五步流程页面（行动主表 / 任务包 / 凭证 / 审核闸门 / 运行轨迹）。
  - **操作按角色受控**：只有自己负责的步骤可点（按钮/表单可用），其余步骤为**只读**——按钮禁用、表单禁点、带「🔒 只读」提示；后端接口同样拒绝越权操作。
  - **🧭 跳转任意步骤（全员可用）**：任何角色都可跳转到任意步骤页面查看/继续；**管理员跳转后可全部修改，其他成员跳转后仍只能修改自己负责的步骤**（其余步骤只读，后端接口同样拒绝越权操作）。面板上绿色=可修改步骤、灰色=只读。
  - **管理员**：可操作任意步骤，并可跳转到任意步骤修改（可回跳到已过步骤继续编辑任务/凭证/主表）。
  - **⚙ 权限管理**（仅管理员可见）：可**新增自定义角色**——只勾选一个步骤，该角色就只能**操作**这一个步骤（页面仍可全部查看）；也可勾选「全部步骤」赋予管理员级权限。自定义角色可删除、自动持久化（重启服务仍在），内置角色不可改/删。
- 底部可展开运行轨迹，查看四角色每一步日志。

非交互接口：`curl http://localhost:9000/demo`（一次性跑完整闭环，兼容自动化测试）。

### 交互 API（供前端/外部调用）
| 方法 | 路径 | 说明 |
|-|-|-|
| GET | `/api/meta` | 学校列表 + 默认选项集 |
| GET | `/api/state` | 当前会话状态（含 `overdueItems` / `overdueCount`） |
| POST | `/api/school` | 新建学校（写入学校档案表） |
| POST | `/api/start` | 新建并下发行动（school/responsible/due_at/difficulty） |
| POST | `/api/next` | 推进一步自动化阶段（遇到人审闸/待上传返回标志） |
| POST | `/api/voucher` | 家服主任上传凭证（含 `attachment` 图片） |
| PUT | `/api/task` | 更新任务责任人/截止时间 |
| POST | `/api/check-overdue` | 扫描逾期项（real 模式 `notify:true` 发飞书提醒） |
| POST | `/api/review` | 人工初审凭证 / 人工终审行动 |
| GET | `/api/roles` | 角色列表 + 步骤定义 + 当前角色可见步骤 |
| POST | `/api/role` | 新增自定义角色（仅管理员；`scope='all'` 或 单/多步骤 key） |
| PUT | `/api/role` | 修改自定义角色名称/权限（仅管理员） |
| DELETE | `/api/role` | 删除自定义角色（仅管理员） |
| POST | `/api/role/switch` | 切换当前操作角色 |
| POST | `/api/jump` | 跳转到任意步骤（全员可用；非管理员仅可修改自己负责的步骤） |
| PUT | `/api/action` | 修改行动主表（标题/难度/责任人/截止，行动官/管理员） |
| POST | `/api/reset` | 重置会话 |

## 2. 配置（可选，接真实服务）

复制 `.env.example` 为 `.env` 填写：

| 变量 | 说明 | 缺省行为 |
|-|-|-|
| `FEISHU_MODE` | `mock` / `real` | mock |
| `HUNYUAN_SECRET_ID/KEY` | 腾讯混元密钥 | 规则回退 |
| `FEISHU_APP_ID/SECRET` | 飞书自建应用 | mock |
| `FEISHU_BASE_APP_TOKEN` + 四表 `table_id` | 《招生控流工作流》多维表 | mock |
| `FEISHU_NOTIFY_CHAT_ID` | 通知群/人 | mock |

OpenAI 兼容通道（可选）：`OPENAI_BASE_URL` + `OPENAI_API_KEY` + `OPENAI_MODEL`。

## 3. 部署到腾讯云 CloudBase

> 部署动作需你授权后在本地执行；本仓库已配好 `cloudbaserc.json` 与 `scf_bootstrap`。

前置：安装 [CloudBase CLI](https://cloud.tencent.com/product/cloudbase)（`npm i -g @cloudbase/cli`），登录并创建环境。

```bash
# 1) 创建/指定环境
tcb env:create recruit-flow-agent      # 或已有环境直接记录 envId

# 2) 修改 cloudbaserc.json 的 envId 与本环境一致

# 3) 配置环境变量（密钥放 CloudBase 密钥管理，勿入库）
tcb env:config --envId <你的envId> --name FEISHU_MODE --value real
# ... 其余 HUNYUAN_*/FEISHU_* 同法配置

# 4) 部署 HTTP 云函数
tcb fn deploy --httpFn --envId <你的envId>

# 5) 在飞书开放平台把事件订阅回调填为：https://<你的云函数域名>/feishu/webhook
```

### 逾期提醒自动化（可选定时触发器）
部署到 CloudBase 后，可加一个**定时触发器**周期性调 `/api/check-overdue`（带 `notify:true`）实现无人值守的逾期提醒：

```bash
# cloudbaserc.json 的 functions[].triggers 增加（示例：每 30 分钟一次）
# { "name": "overdue", "type": "timer", "config": "*/30 * * * *" }
# 触发目标内部请求 POST /api/check-overdue { "notify": true }
```

> 当前 mock 模式仅返回/标红；real 模式需配置 `FEISHU_MODE=real` + 飞书自建应用 + `FEISHU_NOTIFY_CHAT_ID`，方可向责任人发送飞书消息。

### 备选：云托管（容器）
`Dockerfile` 方式：以 `node:18` 为基础镜像，`CMD ["node","src/index.js"]`，监听 `PORT`（平台注入 9000），在 CloudBase 控制台「云托管」创建服务并绑定代码仓库即可。

## 4. 目录结构

```
src/
  config.js              配置中心（仅读环境变量）
  index.js               Express 入口：/health /feishu/webhook / /api/* 交互接口 / 交互演示页
  agent/session.js       交互式单步会话（五步状态机 + 人审闸）
  llm/hunyuan.js         混元客户端（可插拔 OpenAI + 规则回退）
  feishu/adapter.js      飞书适配层（mock/real 统一接口）
  feishu/base.js         多维表适配层（四表 CRUD）
  feishu/store.js        mock 内存存储
  data/schema.js         Base 字段框架（行动/任务包/凭证/学校档案）
  data/seed.js           预置 3 试点校 + 默认选项集
  data/roles.js          角色权限注册表（RBAC：管理员/五方默认角色 + 自定义单步角色）
  agent/orchestrator.js  五步闭环状态机
  agent/roles/*.js       行动官/传导官/督进官/执行助手
  agent/prompts.js       各角色系统提示词（v1，F2 待校情校准）
  agent/tools.js         步骤日志 + 人审卡片
public/index.html        交互式演示页（角色栏 + 流程条 + 角色卡片 + 人审闸 + 权限管理）
simulator/run.js         端到端演示（温州慧中公学）
test/loop.test.js        最小闭环自检
test/roles.test.js       角色权限测试（默认角色/单步可见/管理员跳转/内置保护）
test/view.test.js        页面可见性测试（全员可看全部步骤 / 只读禁点）
cloudbaserc.json         CloudBase 部署配置
scf_bootstrap            云函数启动脚本
```

## 5. 五步闭环状态机

```
待下发 → 已下发(任务布置) → 已拆解(解读拆解) → 执行中(落地执行) → 审核中(凭证审核) → 已闭环(归档)
```

人审闸：终审（行动官）、驳回（督进官初审不通过）由人确认；智能体只做流程自动化与初审辅助。

## 6. 待补齐项（对齐方案第 6 章）

- **F1** 真实 Base 字段对齐（行动/任务包/凭证/学校档案表 table_id 与列名）
- **F2** 各角色完整提示词（按真实校情/话术库校准）
- **F3** 各校准剧本（逾期阈值、凭证标准）
- **F4** 指标目标值回填（自主达标率、一次通过率等）
- **F5** MVP 试点校最终锁定
- **F6** 校情知识库种子清单
