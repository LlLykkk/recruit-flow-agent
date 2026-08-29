'use strict';

/**
 * 任务包增删测试：验证「传导官·任务包」可手动新增 / 删除，
 * 且仅在 任务拆解 / 落地执行 阶段允许；凭证上传后结构锁定。
 */
const assert = require('assert');
const { app, feishu, session } = require('../src/index');

function req(method, url, body) {
  return new Promise((resolve) => {
    const server = app.listen(0, async () => {
      const port = server.address().port;
      const opt = { method, headers: { 'Content-Type': 'application/json' } };
      if (body !== undefined) opt.body = JSON.stringify(body);
      const r = await fetch(`http://127.0.0.1:${port}${url}`, opt);
      const data = await r.json();
      server.close(() => resolve(data));
    });
  });
}

(async () => {
  // 预置试点校
  for (const s of require('../src/config').pilotSchools) feishu.base.insert('school', s);
  await req('POST', '/api/reset');

  let s = await req('POST', '/api/start', { school_id: 'sch_wz', title: '任务增删测试', difficulty: '中' });
  assert.strictEqual(s.phase, 'dispatched');

  s = await req('POST', '/api/next', {}); // decomposed
  const baseCount = s.tasks.length;
  assert.ok(baseCount > 0, '拆解应生成任务包');

  // 新增任务
  s = await req('POST', '/api/task', { stage: '初', content: '新增：组织校园开放日', responsible: '家服主任李四', due_at: '' });
  assert.strictEqual(s.tasks.length, baseCount + 1, '新增后任务数 +1');
  const added = s.tasks[s.tasks.length - 1];
  assert.strictEqual(added.content, '新增：组织校园开放日');
  assert.strictEqual(added.responsible, '家服主任李四');
  // 留空截止应跟随大行动截止
  assert.strictEqual(added.due_at, s.action.due_at);

  // 删除任务
  const delId = s.tasks[0].task_id;
  s = await req('DELETE', '/api/task', { task_id: delId });
  assert.strictEqual(s.tasks.length, baseCount, '删除后任务数回到基线');
  assert.ok(!s.tasks.some((t) => t.task_id === delId), '被删任务不再出现');

  // 进入凭证上传后：普通角色（传导官）增删应被拒
  await req('POST', '/api/next', {}); // executing
  await req('POST', '/api/next', {}); // uploading
  await req('POST', '/api/role/switch', { roleId: 'conduction_officer' });
  const blockedAdd = await req('POST', '/api/task', { content: 'x' });
  assert.strictEqual(blockedAdd.ok, false, 'uploading 阶段普通角色禁止新增');
  const blockedDel = await req('DELETE', '/api/task', { task_id: s.tasks[0].task_id });
  assert.strictEqual(blockedDel.ok, false, 'uploading 阶段普通角色禁止删除');

  // 管理员不受阶段限制：凭证上传阶段仍可增删（"管理员可选择任意步骤进行修改"）
  await req('POST', '/api/role/switch', { roleId: 'admin' });
  const adminAdd = await req('POST', '/api/task', { content: '管理员在上传阶段新增的任务' });
  assert.notStrictEqual(adminAdd.ok, false, '管理员可在任意阶段新增任务');
  assert.strictEqual(adminAdd.tasks.length, baseCount + 1, '管理员新增后任务数 +1');
  const adminDel = await req('DELETE', '/api/task', { task_id: adminAdd.tasks[adminAdd.tasks.length - 1].task_id });
  assert.notStrictEqual(adminDel.ok, false, '管理员可在任意阶段删除任务');
  assert.strictEqual(adminDel.tasks.length, baseCount, '管理员删除后任务数复原');

  // 空内容新增应被拒
  await req('POST', '/api/reset');
  await req('POST', '/api/start', { title: 't', difficulty: '低' });
  await req('POST', '/api/next', {});
  const noContent = await req('POST', '/api/task', { content: '' });
  assert.strictEqual(noContent.ok, false, '空内容新增应被拒');

  console.log('✓ 任务增删测试通过（新增/删除/阶段守卫/空内容拦截）');
})().catch((e) => {
  console.error('✗ 任务增删测试失败:', e.message);
  process.exit(1);
});
