'use strict';

/**
 * 逾期提醒自检：大行动 + 小行动设过去截止时间，校验 checkOverdue 命中；改某任务为未来则不再逾期。
 * 运行：node test/overdue.test.js
 */
const config = require('../src/config');
const { FeishuAdapter } = require('../src/feishu/adapter');
const { DemoSession } = require('../src/agent/session');

function makeCtx() {
  const feishu = new FeishuAdapter();
  return { feishu, base: feishu.base, llm: require('../src/llm/hunyuan'), config };
}

async function main() {
  const ctx = makeCtx();
  ctx.feishu.base.insert('school', {
    school_id: 'test_school', name: '测试校', stages: '小/初',
    nature: '民办', office_nature: '集团派驻', profile_notes: '', knowledge: '',
  });
  const session = new DemoSession(ctx);
  const assert = (c, m) => { if (!c) { console.error('❌', m); process.exit(1); } console.log('✓', m); };

  const past = new Date(Date.now() - 2 * 86400000).toISOString();
  await session.start({
    title: '逾期测试行动', school_id: 'test_school', difficulty: '中',
    responsible: '招生管家', due_at: past,
  });
  await session.next(); // 拆解（任务截止均摊在 past 窗口内）

  // 大行动逾期 + 每个任务逾期
  let items = session.checkOverdue(Date.now());
  assert(items.some((i) => i.kind === 'action'), '大行动命中逾期');
  assert(items.filter((i) => i.kind === 'task').length === session.tasks.length, '所有小行动命中逾期');
  assert(session.state().overdueCount === items.length, 'state.overdueCount 与扫描一致');
  assert(session.state().action.overdue === true, 'state 中 action.overdue 标红');

  // 把其中一个任务改为未来截止
  const fixTask = session.tasks[0];
  await session.updateTask(fixTask.task_id, { due_at: new Date(Date.now() + 5 * 86400000).toISOString() });
  items = session.checkOverdue(Date.now());
  assert(!items.some((i) => i.kind === 'task' && i.id === fixTask.task_id), '改未来后该小行动不再逾期');
  assert(items.filter((i) => i.kind === 'task').length === session.tasks.length - 1, '其余小行动仍逾期');

  // notify=false 时不发飞书（mock 默认不报错）
  const r = session.checkOverdue(Date.now(), false);
  assert(Array.isArray(r), 'checkOverdue 返回数组');

  console.log('\n逾期提醒全部断言通过 ✅');
}

main().catch((e) => { console.error('测试失败：', e); process.exit(1); });
