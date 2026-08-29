'use strict';

/**
 * 角色权限注册表（RBAC）
 *  scope = 'all'            → 管理员，可操作/修改任意步骤
 *  scope = [phaseKey...]    → 默认角色或自定义角色，仅可操作绑定的步骤（只绑一步即"只看到某一个步骤"）
 *
 * 步骤 phase 键：dispatched / decomposed / executing / uploading / reviewing / final
 *  对应方案四方角色 + 家服主任：
 *    行动官(下发/终审)、传导官(拆解)、执行助手(执行)、家服主任(上传)、督进官(审核)
 *
 * 运行时新增的角色持久化到 roles.runtime.json（内置角色不落盘，避免污染）；
 * 写盘失败（如只读容器）时静默降级为内存态，不影响主流程。
 */
const fs = require('fs');
const path = require('path');

const PHASES = [
  { key: 'dispatched', label: '① 行动下发', role: '行动官' },
  { key: 'decomposed', label: '② 任务拆解', role: '传导官' },
  { key: 'executing', label: '③ 落地执行', role: '执行助手' },
  { key: 'uploading', label: '④ 凭证上传', role: '家服主任' },
  { key: 'reviewing', label: '⑤ 凭证审核', role: '督进官' },
  { key: 'final', label: '⑥ 终审归档', role: '行动官' },
];

const PHASE_KEYS = PHASES.map((p) => p.key);

const DEFAULT_ROLES = [
  { id: 'admin', name: '管理员', scope: 'all' },
  { id: 'action_officer', name: '行动官', scope: ['dispatched', 'final'] },
  { id: 'conduction_officer', name: '传导官', scope: ['decomposed'] },
  { id: 'exec_assistant', name: '执行助手', scope: ['executing'] },
  { id: 'home_service', name: '家服主任', scope: ['uploading'] },
  { id: 'supervisor', name: '督进官', scope: ['reviewing'] },
];

const RUNTIME_PATH = path.join(__dirname, 'roles.runtime.json');

function normalizeScope(scope) {
  if (scope === 'all') return 'all';
  const arr = Array.isArray(scope) ? scope : [scope];
  if (!arr.length) throw new Error('请至少选择一个可见步骤');
  for (const k of arr) {
    if (!PHASE_KEYS.includes(k)) throw new Error(`未知步骤：${k}`);
  }
  return arr;
}

class RoleRegistry {
  constructor({ persist = true } = {}) {
    this.persistPath = persist ? RUNTIME_PATH : null;
    // 内置角色深拷贝，避免运行时 add/update/remove 污染常量
    this.roles = DEFAULT_ROLES.map((r) => ({ ...r, builtin: true }));
    this._loadRuntime();
  }

  // ---------- 持久化（仅自定义角色） ----------
  _loadRuntime() {
    if (!this.persistPath || !fs.existsSync(this.persistPath)) return;
    try {
      const arr = JSON.parse(fs.readFileSync(this.persistPath, 'utf8'));
      if (!Array.isArray(arr)) return;
      for (const r of arr) {
        if (!r || !r.id || !r.name) continue;
        if (this.roles.some((x) => x.id === r.id)) continue;
        this.roles.push({ id: r.id, name: r.name, scope: normalizeScope(r.scope), builtin: false });
      }
    } catch (_) { /* 读盘失败则忽略，纯内存运行 */ }
  }

  _saveRuntime() {
    if (!this.persistPath) return;
    try {
      const custom = this.roles.filter((r) => !r.builtin).map(({ id, name, scope }) => ({ id, name, scope }));
      fs.writeFileSync(this.persistPath, JSON.stringify(custom, null, 2), 'utf8');
    } catch (_) { /* 写盘失败不影响内存态 */ }
  }

  // ---------- 查询 ----------
  list() {
    return this.roles.map((r) => ({ id: r.id, name: r.name, scope: r.scope, builtin: !!r.builtin }));
  }

  get(id) {
    return this.roles.find((r) => r.id === id) || null;
  }

  /** 该角色能否操作某 phase */
  canOperate(role, phase) {
    if (!role) return false;
    if (role.scope === 'all') return true;
    return (role.scope || []).includes(phase);
  }

  /** 该角色可见/可操作的步骤 key 列表 */
  allowedPhases(role) {
    if (!role) return [];
    return role.scope === 'all' ? PHASE_KEYS.slice() : (role.scope || []).slice();
  }

  // ---------- 变更（仅管理员调用，由 session 层守卫） ----------
  add({ name, scope }) {
    if (!name || !String(name).trim()) throw new Error('角色名称必填');
    const nm = String(name).trim();
    if (this.roles.some((r) => r.name === nm)) throw new Error(`角色「${nm}」已存在`);
    const s = normalizeScope(scope);
    const role = { id: `role_${Date.now().toString(36)}`, name: nm, scope: s, builtin: false };
    this.roles.push(role);
    this._saveRuntime();
    return role;
  }

  update(id, { name, scope } = {}) {
    const r = this.get(id);
    if (!r) throw new Error('角色不存在');
    if (r.builtin) throw new Error('内置角色不可修改');
    if (name !== undefined) {
      const nm = String(name).trim();
      if (!nm) throw new Error('角色名称必填');
      if (this.roles.some((x) => x.name === nm && x.id !== id)) throw new Error(`角色「${nm}」已存在`);
      r.name = nm;
    }
    if (scope !== undefined) r.scope = normalizeScope(scope);
    this._saveRuntime();
    return r;
  }

  remove(id) {
    const r = this.get(id);
    if (!r) throw new Error('角色不存在');
    if (r.builtin) throw new Error('内置角色不可删除');
    this.roles = this.roles.filter((x) => x.id !== id);
    this._saveRuntime();
    return true;
  }
}

module.exports = { RoleRegistry, PHASES, PHASE_KEYS, DEFAULT_ROLES };
