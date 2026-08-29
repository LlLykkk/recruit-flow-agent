'use strict';

/**
 * 角色权限测试：
 *  1) 默认角色齐全（管理员 + 五方角色），管理员 scope='all'
 *  2) 切换角色后，非授权步骤被后端拒绝
 *  3) 管理员可新增「只绑定一个步骤」的角色，该角色仅能操作该步骤
 *  4) 管理员可跳转到任意步骤修改
 *  5) 全员可跳转到任意步骤，但非管理员只能修改自己负责的步骤
 *  6) 内置角色不可删除/修改，自定义角色可删除
 *  7) 行动主表修改受角色约束
 */
const assert = require('assert');
const { app, feishu } = require('../src/index');

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

const uniq = () => `测试角色_${Date.now().toString(36)}`;

(async () => {
  for (const s of require('../src/config').pilotSchools) feishu.base.insert('school', s);
  await req('POST', '/api/reset');
  await req('POST', '/api/role/switch', { roleId: 'admin' });

  // 1) 默认角色
  let info = await req('GET', '/api/roles');
  assert.strictEqual(info.phases.length, 6, '应有 6 个步骤定义');
  const names = info.roles.map((r) => r.name);
  for (const n of ['管理员', '行动官', '传导官', '执行助手', '家服主任', '督进官']) {
    assert.ok(names.includes(n), `默认角色缺少：${n}`);
  }
  const admin = info.roles.find((r) => r.id === 'admin');
  assert.strictEqual(admin.scope, 'all', '管理员 scope 应为 all');
  assert.strictEqual(info.allowedPhases.length, 6, '管理员可见全部步骤');

  // 2) 切换角色 → 非授权步骤被拒
  let s = await req('POST', '/api/role/switch', { roleId: 'home_service' });
  assert.deepStrictEqual(s.allowedPhases, ['uploading'], '家服主任仅可见「凭证上传」');
  assert.strictEqual(s.isAdmin, false);
  const deniedStart = await req('POST', '/api/start', { title: '家服主任尝试下发' });
  assert.strictEqual(deniedStart.ok, false, '家服主任无权新建行动');

  s = await req('POST', '/api/role/switch', { roleId: 'conduction_officer' });
  assert.deepStrictEqual(s.allowedPhases, ['decomposed'], '传导官仅可见「任务拆解」');

  // 3) 管理员新增「只绑一步」的角色
  await req('POST', '/api/role/switch', { roleId: 'admin' });
  const rn = uniq();
  const added = await req('POST', '/api/role', { name: rn, scope: ['reviewing'] });
  assert.ok(added.currentRole, '新增角色后应返回 state');
  info = await req('GET', '/api/roles');
  const custom = info.roles.find((r) => r.name === rn);
  assert.ok(custom, '自定义角色应出现在列表中');
  assert.deepStrictEqual(custom.scope, ['reviewing'], '自定义角色仅绑定「凭证审核」一步');

  const scoped = await req('POST', '/api/role/switch', { roleId: custom.id });
  assert.deepStrictEqual(scoped.allowedPhases, ['reviewing'], '切换后仅可见该一步');
  assert.strictEqual(scoped.isAdmin, false);
  // 非授权步骤被拒（上传 / 新增任务 / 改主表）
  assert.strictEqual((await req('POST', '/api/voucher', { task_id: 'x', content: 'y' })).ok, false, '无权上传凭证');
  assert.strictEqual((await req('POST', '/api/task', { content: 'z' })).ok, false, '无权新增任务');
  assert.strictEqual((await req('PUT', '/api/action', { title: 'x' })).ok, false, '无权修改行动主表');

  // 4) 管理员跳转任意步骤
  await req('POST', '/api/role/switch', { roleId: 'admin' });
  let st = await req('POST', '/api/start', { school_id: 'wenzhou_huizhong', title: '角色权限测试行动', difficulty: '低' });
  assert.strictEqual(st.phase, 'dispatched');
  st = await req('POST', '/api/next', {});
  assert.strictEqual(st.phase, 'decomposed');
  st = await req('POST', '/api/jump', { phase: 'uploading' });
  assert.strictEqual(st.phase, 'uploading', '管理员应可跳到 ④ 凭证上传');
  st = await req('POST', '/api/jump', { phase: 'decomposed' });
  assert.strictEqual(st.phase, 'decomposed', '管理员应可回跳到 ② 任务拆解');
  // 管理员在拆解阶段可增删任务
  const before = st.tasks.length;
  st = await req('POST', '/api/task', { stage: '初', content: '管理员回跳后新增的任务' });
  assert.strictEqual(st.tasks.length, before + 1, '管理员回跳后可新增任务');

  // 5) 非管理员可跳转任意步骤，但只能修改自己负责的步骤
  await req('POST', '/api/role/switch', { roleId: 'supervisor' });
  let j = await req('POST', '/api/jump', { phase: 'final' });
  assert.strictEqual(j.phase, 'final', '督进官应可跳转到任意步骤查看');
  assert.strictEqual((await req('POST', '/api/review', { target: 'final', decision: 'approve' })).ok, false, '跳转后仍无权操作他人步骤（终审需行动官/管理员）');
  // 跳回自己负责的审核步骤可查看；操作仍受角色约束
  j = await req('POST', '/api/jump', { phase: 'reviewing' });
  assert.strictEqual(j.phase, 'reviewing', '督进官可跳回自己负责的审核步骤');
  // 传导官跳回自己负责的拆解步骤可增删任务
  await req('POST', '/api/role/switch', { roleId: 'conduction_officer' });
  j = await req('POST', '/api/jump', { phase: 'decomposed' });
  assert.strictEqual(j.phase, 'decomposed', '传导官可跳回拆解步骤');
  const ownOp = await req('POST', '/api/task', { stage: '初', content: '传导官跳转后新增自己的任务' });
  assert.notStrictEqual(ownOp.ok, false, '传导官跳到自己负责的步骤可新增任务');
  assert.strictEqual(ownOp.tasks.length, j.tasks.length + 1, '跳转后新增任务数 +1');
  // 跳转到他人步骤不能增删任务（上传阶段普通角色被拒）
  j = await req('POST', '/api/jump', { phase: 'uploading' });
  assert.strictEqual(j.phase, 'uploading', '传导官可跳到凭证上传查看');
  assert.strictEqual((await req('POST', '/api/task', { content: 'x' })).ok, false, '跳转到他人步骤不能增删任务');

  // 6) 行动主表修改受约束：非行动官角色不可改，行动官可改
  assert.strictEqual((await req('PUT', '/api/action', { title: '传导官改标题' })).ok, false, '传导官无权改主表');
  await req('POST', '/api/role/switch', { roleId: 'action_officer' });
  const edited = await req('PUT', '/api/action', { title: '行动官改后的标题', difficulty: '高' });
  assert.strictEqual(edited.action.title, '行动官改后的标题', '行动官可修改主表');
  assert.strictEqual(edited.action.difficulty, '高');

  // 7) 内置角色不可删除/修改；自定义角色可删除
  await req('POST', '/api/role/switch', { roleId: 'admin' });
  assert.strictEqual((await req('DELETE', '/api/role', { id: 'supervisor' })).ok, false, '内置角色不可删除');
  assert.strictEqual((await req('PUT', '/api/role', { id: 'supervisor', name: '改名' })).ok, false, '内置角色不可修改');
  const del = await req('DELETE', '/api/role', { id: custom.id });
  assert.ok(del && del.phase !== undefined, '删除成功应返回 state（而非 {ok:false} 错误）');
  info = await req('GET', '/api/roles');
  assert.ok(!info.roles.some((r) => r.id === custom.id), '删除后自定义角色不再出现');
  // 持久化校验：重启会话后自定义角色不应残留（roles.runtime.json 应为空数组）
  const fs = require('fs');
  const runtimePath = require('path').join(__dirname, '..', 'src', 'data', 'roles.runtime.json');
  if (fs.existsSync(runtimePath)) {
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(runtimePath, 'utf8')), [], '删除后持久化文件应为空');
  }

  await req('POST', '/api/reset');
  console.log('✓ 角色权限测试通过（默认角色/单步可见/全员可跳转但仅能改自己步骤/管理员任意修改/内置保护/主表约束）');
})().catch((e) => {
  console.error('✗ 角色权限测试失败:', e.message);
  process.exit(1);
});
