'use strict';

/**
 * 入口：CloudBase HTTP 云函数（监听 $PORT，默认 9000）
 * 路由：
 *   GET  /health             健康检查（CloudBase 探活）
 *   POST /feishu/webhook     飞书事件订阅回调（URL 验证 / 消息 / 卡片 action）
 *   GET  /                   交互式演示页
 *   GET  /api/meta           学校列表 + 默认选项集（前端初始化下拉）
 *   GET  /api/state          当前会话状态（含逾期标记与逾期项、当前角色权限）
 *   GET  /api/roles          角色列表 + 步骤定义 + 当前角色可见步骤
 *   POST /api/role           新增角色（仅管理员；scope='all' 或 单/多步骤 key）
 *   PUT  /api/role           修改角色名称/权限（仅管理员，内置角色不可改）
 *   DELETE /api/role         删除自定义角色（仅管理员）
 *   POST /api/role/switch    切换当前操作角色
 *   POST /api/jump           跳转到任意步骤（全员可用；非管理员仅可修改自己负责的步骤）
 *   PUT  /api/action         修改行动主表（标题/难度/责任人/截止）
 *   POST /api/school         新建学校（写入学校档案表）
 *   POST /api/start          新建并下发行动（五步第一步，含学校/责任人/难度/截止）
 *   POST /api/next           推进一步自动化阶段
 *   POST /api/voucher        家服主任上传凭证（含图片附件）
 *   PUT  /api/task           更新任务责任人/截止时间
 *   POST /api/check-overdue  扫描逾期项；real 模式发飞书提醒（mock 仅返回）
 *   POST /api/review         人工初审凭证 / 人工终审行动
 *   POST /api/reset          重置会话
 *   GET  /demo               一次性端到端 demo（兼容旧调用）
 */
const path = require('path');
const fs = require('fs');
const express = require('express');
const config = require('./config');
const { FeishuAdapter } = require('./feishu/adapter');
const { Orchestrator } = require('./agent/orchestrator');
const { DemoSession } = require('./agent/session');
const { resetTrace, getTrace } = require('./agent/tools');
const { ACTION_STATUS } = require('./data/schema');

const app = express();
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

// 兜底：任何未捕获异常只记日志，不退出进程（避免容器 CrashLoop）
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e && e.message));

const feishu = new FeishuAdapter();
const ctx = { feishu, base: feishu.base, llm: require('./llm/hunyuan'), config };
const orch = new Orchestrator(ctx);
const session = new DemoSession(ctx);

// 预置 3 个试点校档案（惠州/温州/衡阳），便于 demo 直接选
// real 模式为异步飞书写入：失败仅记日志，绝不阻塞/打断服务启动
(async () => {
  for (const s of config.pilotSchools) {
    try {
      await feishu.base.insert('school', s);
    } catch (e) {
      console.error('[startup] 试点校写入失败（不阻塞启动）:', e && e.message);
    }
  }
})();

app.get('/health', (req, res) => res.json({ ok: true, mode: feishu.mode, llm: ctx.llm._channel() }));

// 交互式演示页
app.get('/', (req, res) => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  res.type('html').send(html);
});

// ---------- 交互 API ----------
app.get('/api/meta', (req, res) => res.json({
  schools: feishu.base.list('school'),
  options: config.options,
  mvpSchoolId: config.mvpSchoolId,
}));

app.get('/api/state', (req, res) => res.json(session.state()));

// ---------- 角色权限 ----------
app.get('/api/roles', (req, res) => res.json(session.rolesInfo()));

app.post('/api/role', (req, res) => {
  try {
    const { name, scope } = req.body || {};
    res.json(session.addRole({ name, scope }));
  } catch (e) { res.status(400).json({ ok: false, msg: e.message }); }
});

app.put('/api/role', (req, res) => {
  try {
    const { id, name, scope } = req.body || {};
    if (!id) return res.status(400).json({ ok: false, msg: 'id 必填' });
    res.json(session.updateRole(id, { name, scope }));
  } catch (e) { res.status(400).json({ ok: false, msg: e.message }); }
});

app.delete('/api/role', (req, res) => {
  try {
    const id = (req.body && req.body.id) || req.query.id;
    if (!id) return res.status(400).json({ ok: false, msg: 'id 必填' });
    res.json(session.removeRole(id));
  } catch (e) { res.status(400).json({ ok: false, msg: e.message }); }
});

app.post('/api/role/switch', (req, res) => {
  try {
    const { roleId } = req.body || {};
    if (!roleId) return res.status(400).json({ ok: false, msg: 'roleId 必填' });
    res.json(session.setRole(roleId));
  } catch (e) { res.status(400).json({ ok: false, msg: e.message }); }
});

app.post('/api/jump', (req, res) => {
  try {
    const { phase } = req.body || {};
    if (!phase) return res.status(400).json({ ok: false, msg: 'phase 必填' });
    res.json(session.jumpTo(phase));
  } catch (e) { res.status(400).json({ ok: false, msg: e.message }); }
});

app.put('/api/action', async (req, res) => {
  try {
    const { title, difficulty, responsible, due_at } = req.body || {};
    res.json(await session.updateAction({ title, difficulty, responsible, due_at }));
  } catch (e) { res.status(400).json({ ok: false, msg: e.message }); }
});

app.post('/api/school', (req, res) => {
  try {
    const { name, stages, nature, office_nature } = req.body || {};
    if (!name) return res.status(400).json({ ok: false, msg: '学校名称必填' });
    const created = feishu.base.insert('school', {
      school_id: `sch_${Date.now().toString(36)}`,
      name,
      stages: Array.isArray(stages) ? stages.join('/') : (stages || '小'),
      nature: nature || '',
      office_nature: office_nature || '',
      profile_notes: req.body.profile_notes || '',
      knowledge: req.body.knowledge || '',
    });
    res.json({ ok: true, school: created });
  } catch (e) { res.status(400).json({ ok: false, msg: e.message }); }
});

app.post('/api/start', async (req, res) => {
  try {
    const { title, school_id, school, responsible, due_at, difficulty } = req.body || {};
    const s = await session.start({ title, school_id, school, responsible, due_at, difficulty });
    res.json(s);
  } catch (e) { res.status(400).json({ ok: false, msg: e.message }); }
});

app.post('/api/voucher', async (req, res) => {
  try {
    const { task_id, type, content, attachment, submitted_by } = req.body || {};
    if (!task_id) return res.status(400).json({ ok: false, msg: 'task_id 必填' });
    const s = await session.uploadVoucher({ task_id, type, content, attachment, submitted_by });
    res.json(s);
  } catch (e) { res.status(400).json({ ok: false, msg: e.message }); }
});

app.put('/api/task', async (req, res) => {
  try {
    const { task_id, responsible, due_at } = req.body || {};
    if (!task_id) return res.status(400).json({ ok: false, msg: 'task_id 必填' });
    const s = await session.updateTask(task_id, { responsible, due_at });
    res.json(s);
  } catch (e) { res.status(400).json({ ok: false, msg: e.message }); }
});

app.post('/api/task', async (req, res) => {
  try {
    const { stage, content, responsible, due_at, assignee } = req.body || {};
    const s = await session.addTask({ stage, content, responsible, due_at, assignee });
    res.json(s);
  } catch (e) { res.status(400).json({ ok: false, msg: e.message }); }
});

app.delete('/api/task', async (req, res) => {
  try {
    const task_id = (req.body && req.body.task_id) || req.query.task_id;
    const s = await session.deleteTask(task_id);
    res.json(s);
  } catch (e) { res.status(400).json({ ok: false, msg: e.message }); }
});

app.post('/api/check-overdue', (req, res) => {
  try {
    const notify = !!(req.body && req.body.notify);
    const items = session.checkOverdue(Date.now(), notify);
    res.json({ ok: true, count: items.length, items, mode: feishu.mode });
  } catch (e) { res.status(400).json({ ok: false, msg: e.message }); }
});

app.post('/api/next', async (req, res) => {
  try {
    const s = await session.next();
    res.json(s);
  } catch (e) { res.status(400).json({ ok: false, msg: e.message }); }
});

app.post('/api/review', async (req, res) => {
  try {
    const { target, id, decision } = req.body || {};
    if (target === 'voucher') {
      const s = await session.reviewVoucher(id, decision);
      return res.json(s);
    }
    if (target === 'final') {
      const s = await session.reviewFinal(decision);
      return res.json(s);
    }
    res.status(400).json({ ok: false, msg: 'target 需为 voucher 或 final' });
  } catch (e) { res.status(400).json({ ok: false, msg: e.message }); }
});

app.post('/api/reset', (req, res) => res.json(session.reset()));

// 飞书事件订阅
app.post('/feishu/webhook', async (req, res) => {
  try {
    const body = req.body || {};
    // 1) URL 验证
    const challenge = await feishu.verifyChallenge(body);
    if (challenge) return res.json(challenge);

    // 2) 签名校验（real 模式）
    const ok = await feishu.verifySignature(req);
    if (!ok) return res.status(401).json({ ok: false, msg: 'signature invalid' });

    // 3) 卡片回传（人审闸）
    const action = body?.event?.action;
    if (action && action.value) {
      const rec = await orch.handleReviewCallback(action.value);
      return res.json({ ok: true, action_id: action.value.action_id, status: rec && rec.status });
    }

    // 4) 消息事件：把"新建行动"类指令接入编排（简单示例：含「新建行动」即起一个闭环）
    const msg = body?.event?.message;
    if (msg && msg.content) {
      let text = '';
      try { text = JSON.parse(msg.content).text || ''; } catch (_) {}
      if (text.includes('新建行动')) {
        const title = text.replace('新建行动', '').trim() || '未命名招生控流行动';
        const rec = await orch.runAction({ school_id: config.mvpSchoolId, title, autoReview: false });
        return res.json({ ok: true, started: rec.action_id });
      }
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error('[webhook] error', e);
    return res.status(500).json({ ok: false, msg: e.message });
  }
});

// 一次性端到端 demo（兼容旧调用 / 自动化测试）
app.get('/demo', async (req, res) => {
  resetTrace();
  const rec = await orch.runAction({
    school_id: config.mvpSchoolId,
    title: '最美家长服务中心评比（温州慧中公学专场）',
    source: '招生服务中心',
    due_at: new Date(Date.now() + 5 * 86400000).toISOString(),
    autoReview: true,
  });
  res.json({ ok: true, finalStatus: rec.status, action_id: rec.action_id, trace: getTrace() });
});

const port = config.port;
if (require.main === module) {
  app.listen(port, () => {
    console.log(`招生控流智能体已启动：http://localhost:${port}  (feishu=${feishu.mode}, llm=${ctx.llm._channel()})`);
  });
}

module.exports = { app, orch, session, feishu, ctx };
