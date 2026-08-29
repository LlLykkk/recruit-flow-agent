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
  // 持久化校验：自定义角色删除后不落盘（新格式 {roles, members}）
  const fs = require('fs');
  const runtimePath = require('path').join(__dirname, '..', 'src', 'data', 'roles.runtime.json');
  if (fs.existsSync(runtimePath)) {
    const rt = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
    assert.deepStrictEqual(rt.roles || [], [], '删除后自定义角色应为空');
  }

  // 8) 角色成员管理：管理员（最高权限）可给各角色添加/移除人员，可切换当前操作者
  await req('POST', '/api/role/switch', { roleId: 'admin' });
  const mr = await req('POST', '/api/role/member', { role_id: 'home_service', name: '李四' });
  assert.notStrictEqual(mr.ok, false, '管理员可给角色添加人员');
  assert.strictEqual((await req('POST', '/api/role/member', { role_id: 'home_service', name: '李四' })).ok, false, '重复人员应被拒');
  let rinfo = await req('GET', '/api/roles');
  const hsRole = rinfo.roles.find((r) => r.id === 'home_service');
  assert.ok(hsRole && hsRole.members.some((m) => m.name === '李四'), '角色下应出现人员');
  const memId = hsRole.members.find((m) => m.name === '李四').id;
  // 以成员身份操作：切换当前操作者 → 凭证提交人用成员名
  await req('POST', '/api/role/switch', { roleId: 'home_service' });
  let ms = await req('POST', '/api/member/switch', { member_id: memId });
  assert.strictEqual(ms.operatorName, '李四', '当前操作者应为李四');
  const taskId = ms.tasks[0].task_id;
  const up = await req('POST', '/api/voucher', { task_id: taskId, type: '活动照片', content: '成员上传测试' });
  assert.strictEqual(up.vouchers[up.vouchers.length - 1].submitted_by, '李四', '凭证提交人应为当前操作者');
  // 非管理员不能管理成员
  await req('POST', '/api/role/switch', { roleId: 'conduction_officer' });
  assert.strictEqual((await req('POST', '/api/role/member', { role_id: 'home_service', name: '王五' })).ok, false, '非管理员无权添加人员');
  assert.strictEqual((await req('DELETE', '/api/role/member', { role_id: 'home_service', member_id: memId })).ok, false, '非管理员无权移除人员');
  // 管理员移除成员 → 名单清空
  await req('POST', '/api/role/switch', { roleId: 'admin' });
  assert.notStrictEqual((await req('DELETE', '/api/role/member', { role_id: 'home_service', member_id: memId })).ok, false, '管理员可移除成员');
  rinfo = await req('GET', '/api/roles');
  assert.ok(!rinfo.roles.find((r) => r.id === 'home_service').members.some((m) => m.id === memId), '移除后成员消失');
  if (fs.existsSync(runtimePath)) {
    const rt = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
    assert.ok(!rt.members || !rt.members.home_service || rt.members.home_service.length === 0, '移除后成员不应落盘');
  }

  await req('POST', '/api/reset');
  console.log('✓ 角色权限测试通过（默认角色/单步可见/全员可跳转但仅能改自己步骤/管理员任意修改/内置保护/主表约束/成员管理）');
})().catch((e) => {
  console.error('✗ 角色权限测试失败:', e.message);
  process.exit(1);
});
