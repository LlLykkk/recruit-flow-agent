'use strict';

/**
 * 最小闭环自检：不依赖外部服务，验证五步状态机走到「已闭环」。
 * 运行：node test/loop.test.js
 */
const { FeishuAdapter } = require('../src/feishu/adapter');
const { Orchestrator } = require('../src/agent/orchestrator');
const { ACTION_STATUS } = require('../src/data/schema');

async function main() {
  const feishu = new FeishuAdapter();
  feishu.base.insert('school', {
    school_id: 'test_school', name: '测试校', stages: '小/初', profile_notes: '', knowledge: '',
  });
  const ctx = { feishu, base: feishu.base, llm: require('../src/llm/hunyuan') };
  const orch = new Orchestrator(ctx);

  const rec = await orch.runAction({
    school_id: 'test_school',
    title: '测试行动',
    autoReview: true,
  });

  const assert = (cond, msg) => { if (!cond) { console.error('❌', msg); process.exit(1); } console.log('✓', msg); };
  assert(rec.status === ACTION_STATUS.CLOSED, '行动最终状态为「已闭环」');
  assert(feishu.store.tables.task.length >= 2, '至少生成 2 个任务包');
  assert(feishu.store.tables.voucher.length >= 1, '至少生成 1 张凭证');
  console.log('\n全部断言通过 ✅');
}

main().catch((e) => { console.error('测试失败：', e); process.exit(1); });
