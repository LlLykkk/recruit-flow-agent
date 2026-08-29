'use strict';

/**
 * 交互闭环自检：走 start→拆解→执行→上传凭证→审核→终审，覆盖学校/难度/上传。
 * 运行：node test/interactive.test.js
 */
const config = require('../src/config');
const { FeishuAdapter } = require('../src/feishu/adapter');
const { DemoSession } = require('../src/agent/session');
const { ACTION_STATUS } = require('../src/data/schema');

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

  await session.start({
    title: '交互测试行动', school_id: 'test_school', difficulty: '中',
    responsible: '招生管家', due_at: new Date(Date.now() + 10 * 86400000).toISOString(),
  });
  assert(session.phase === 'dispatched', 'start 后处于 已下发');

  await session.next(); // 拆解
  assert(session.phase === 'decomposed', '拆解后 已拆解');
  assert(session.tasks.length === 4, `中难度×2学段 = 4 个任务包（实际 ${session.tasks.length}）`);
  assert(session.tasks.every((t) => t.responsible === '家服主任'), '小行动责任人默认 家服主任');
  assert(session.tasks.every((t) => t.due_at), '每个小行动均摊到截止时间');

  await session.next(); // 执行
  await session.next(); // 进入上传
  assert(session.phase === 'uploading', '进入 凭证上传 阶段');

  // 家服主任逐任务上传凭证（含图片附件）
  for (const t of session.tasks) {
    const s = await session.uploadVoucher({
      task_id: t.task_id, type: '活动照片', content: `任务 ${t.stage} 执行过程记录`,
      attachment: { filename: 'a.png', mime: 'image/png', dataUrl: 'data:image/png;base64,AAA' },
      submitted_by: '家服主任',
    });
    assert((s.vouchers || []).some((v) => v.task_id === t.task_id), `任务 ${t.task_id} 凭证已上传`);
  }

  const s2 = await session.next(); // 上传齐 → 进入审核
  assert(!s2.needUpload, '所有任务已上传，无需等待');
  assert(session.phase === 'reviewing', '进入 凭证审核');

  for (const v of session.pendingVouchers.slice()) {
    await session.reviewVoucher(v, 'approve');
  }
  assert(session.pendingVouchers.length === 0, '全部凭证初审通过');

  await session.next(); // 进入终审
  assert(session.phase === 'final', '进入 终审');
  await session.reviewFinal('approve');
  assert(session.phase === 'done', '终审后 已闭环');
  const a = ctx.base.get('action', session.actionId);
  assert(a.status === ACTION_STATUS.CLOSED, '行动最终状态 已闭环');

  console.log('\n交互闭环全部断言通过 ✅');
}

main().catch((e) => { console.error('测试失败：', e); process.exit(1); });
