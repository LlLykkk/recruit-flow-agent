'use strict';

/**
 * 端到端演示（温州慧中公学 MVP）
 * 用 mock 模式跑完整五步闭环，逐步骤打印四角色输出，无需任何云/飞书/模型凭证。
 * 运行：node simulator/run.js
 */
const config = require('../src/config');
const { FeishuAdapter } = require('../src/feishu/adapter');
const { Orchestrator } = require('../src/agent/orchestrator');
const { resetTrace, getTrace } = require('../src/agent/tools');

async function main() {
  console.log('==================================================');
  console.log(' 招生控流智能体 · 端到端演示（MVP：温州慧中公学）');
  console.log(` 飞书模式=${config.feishuMode}  大模型通道=${config.llmEnabled ? (config.hunyuan.secretId ? 'hunyuan' : 'openai') : 'rule-fallback'}`);
  console.log('==================================================');

  const feishu = new FeishuAdapter();
  feishu.base.insert('school', {
    school_id: config.mvpSchoolId,
    name: '温州慧中公学',
    stages: '小/初',
    profile_notes: '第二年合作校，校情较熟；初中部为重点生源段。',
    knowledge: '话术库种子：家长开放日邀约话术、生源转介绍激励说明。',
  });
  const ctx = { feishu, base: feishu.base, llm: require('../src/llm/hunyuan') };
  const orch = new Orchestrator(ctx);

  resetTrace();
  const rec = await orch.runAction({
    school_id: config.mvpSchoolId,
    title: '最美家长服务中心评比（温州慧中公学专场）',
    source: '招生服务中心',
    due_at: new Date(Date.now() + 5 * 86400000).toISOString(),
    autoReview: true,
  });

  console.log('\n------ 飞书消息（mock 记录）------');
  for (const m of feishu.store.messages) console.log(`· [${m.target}] ${m.text}`);
  console.log('\n------ 闭环结果 ------');
  console.log('行动状态：', rec.status);
  console.log('任务包数：', feishu.store.tables.task.length);
  console.log('凭证数：', feishu.store.tables.voucher.length);
  console.log('轨迹步数：', getTrace().length);
  console.log('\n✅ 五步闭环跑通（待下发→已下发→已拆解→执行中→审核中→已闭环）');
}

main().catch((e) => { console.error('演示失败：', e); process.exit(1); });
