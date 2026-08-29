'use strict';

/**
 * 交互式演示会话：把五步闭环拆成可单步推进、可在「人审闸」停等的本地会话。
 * 阶段：idle → dispatched(已下发) → decomposed(已拆解) → executing(执行中)
 *      → uploading(凭证上传) → reviewing(凭证审核·人审) → final(终审·人审) → done(已闭环)
 *
 * 与 orchestrator.runAction（一次性 autoReview）的区别：
 *  - 每步由前端「下一步」触发，逐步可视化；
 *  - 凭证由家服主任手动上传（含图片），不再自动生成占位；
 *  - 凭证初审、行动终审均停等人工 通过/驳回，真实还原方案里的「人保留判断」闸门；
 *  - 大行动 / 小行动可设责任人 + 截止时间，逾期自动提醒责任人。
 */

const { Orchestrator } = require('./orchestrator');
const { ACTION_STATUS, TASK_STATUS, VOUCHER_STATUS } = require('../data/schema');
const { RoleRegistry, PHASES, PHASE_KEYS } = require('../data/roles');
const { resetTrace, getTrace } = require('./tools');

// 任务包结构可编辑的阶段窗口（管理员可突破）
const TASK_EDITABLE_PHASES = ['decomposed', 'executing'];

class DemoSession {
  constructor(ctx) {
    this.ctx = ctx;
    this.orch = new Orchestrator(ctx);
    this.roles = new RoleRegistry();
    this.currentRoleId = 'admin'; // 默认管理员，可任意阶段修改
    this.currentMemberId = null;  // 当前操作者（null = 以角色本人操作）
    this.phase = 'idle';
    this.actionId = null;
    this.tasks = [];
    this.vouchers = [];
    this.pendingVouchers = [];
    this.lastStep = null; // 最近一步的角色输出，供前端渲染
  }

  // ---------- 角色权限 ----------
  currentRole() { return this.roles.get(this.currentRoleId); }
  canOperate(phase) { return this.roles.canOperate(this.currentRole(), phase); }
  isAdmin() { const r = this.currentRole(); return !!r && r.scope === 'all'; }
  allowedPhases() { return this.roles.allowedPhases(this.currentRole()); }

  setRole(id) {
    if (!this.roles.get(id)) throw new Error(`角色不存在：${id}`);
    this.currentRoleId = id;
    this.currentMemberId = null; // 切换角色后回到"角色本人"
    this.lastStep = { role: '编排器', name: '切换角色', data: { roleId: id, name: this.currentRole().name } };
    return this.state();
  }

  _assertRole(phase) {
    if (!this.canOperate(phase)) {
      throw new Error(`当前角色「${this.currentRole().name}」无权操作该步骤`);
    }
  }

  _assertAdmin() {
    if (!this.isAdmin()) {
      throw new Error('仅「管理员」可管理角色权限或跳转到任意步骤');
    }
  }

  /** 管理员新增角色：scope='all'（管理员级）或 单/多步骤 key（只绑某一步即"只看到某一个步骤"） */
  addRole({ name, scope }) {
    this._assertAdmin();
    const role = this.roles.add({ name, scope });
    this.lastStep = { role: '编排器', name: '新增角色', data: { id: role.id, name: role.name, scope: role.scope } };
    return this.state();
  }

  updateRole(id, patch) {
    this._assertAdmin();
    const role = this.roles.update(id, patch);
    this.lastStep = { role: '编排器', name: '修改角色权限', data: { id, ...patch } };
    return this.state();
  }

  removeRole(id) {
    this._assertAdmin();
    const role = this.roles.get(id);
    if (!role) throw new Error('角色不存在');
    if (id === 'admin') throw new Error('管理员角色不可删除');
    this.roles.remove(id);
    if (this.currentRoleId === id) { this.currentRoleId = 'admin'; this.currentMemberId = null; } // 删掉当前角色则回落到管理员
    this.lastStep = { role: '编排器', name: '删除角色', data: { id, name: role.name } };
    return this.state();
  }

  /** 跳转到任意步骤：全员可用（可在任意阶段回到某一步查看/继续编辑）。
   *  非管理员跳转后仍只能修改自己负责的步骤（由各操作的 _assertRole 守卫），其余步骤只读。 */
  jumpTo(phase) {
    if (!PHASE_KEYS.includes(phase)) throw new Error(`未知步骤：${phase}`);
    if (this.phase === 'idle') throw new Error('请先 start() 建立行动');
    this.phase = phase;
    const roleName = this.currentRole().name;
    this.lastStep = { role: '编排器', name: '跳转步骤', data: { phase, role: roleName } };
    logStepSafe(this.ctx, '编排器', '跳转步骤', { phase, role: roleName });
    return this.state();
  }

  rolesInfo() {
    const cur = this.currentRole();
    return {
      roles: this.roles.list(),
      phases: PHASES,
      currentRoleId: this.currentRoleId,
      currentRole: cur ? { id: cur.id, name: cur.name, scope: cur.scope, members: cur.members || [] } : null,
      allowedPhases: this.allowedPhases(),
      isAdmin: this.isAdmin(),
      currentMemberId: this.currentMemberId,
      currentMember: this.currentMember(),
    };
  }

  // ---------- 角色成员（管理员可给各角色添加人员） ----------
  /** 当前操作者成员（null = 角色本人） */
  currentMember() {
    if (!this.currentMemberId) return null;
    const cur = this.currentRole();
    if (!cur || !cur.members) return null;
    return cur.members.find((m) => m.id === this.currentMemberId) || null;
  }

  /** 当前操作者显示名（操作留痕用）：成员名 > 角色名 */
  operatorName() {
    const m = this.currentMember();
    return m ? m.name : (this.currentRole() ? this.currentRole().name : '');
  }

  /** 管理员给某角色添加人员（name 必填；open_id 可选，real 模式发飞书用） */
  addRoleMember(roleId, { name, open_id = '' } = {}) {
    this._assertAdmin();
    const mem = this.roles.addMember(roleId, { name, open_id });
    this.lastStep = { role: '编排器', name: '添加角色成员', data: { roleId, member: mem } };
    return this.state();
  }

  /** 管理员移除某角色下的人员 */
  removeRoleMember(roleId, memberId) {
    this._assertAdmin();
    this.roles.removeMember(roleId, memberId);
    if (this.currentMemberId === memberId) this.currentMemberId = null; // 删掉当前操作者则回到角色本人
    this.lastStep = { role: '编排器', name: '移除角色成员', data: { roleId, memberId } };
    return this.state();
  }

  /** 切换当前操作者：memberId=null 表示以角色本人操作 */
  setMember(memberId) {
    if (memberId !== null && memberId !== undefined) {
      const cur = this.currentRole();
      if (!cur || !(cur.members || []).some((m) => m.id === memberId)) {
        throw new Error(`成员不存在或不属于当前角色`);
      }
      this.currentMemberId = memberId;
    } else {
      this.currentMemberId = null;
    }
    this.lastStep = { role: '编排器', name: '切换操作者', data: { memberId: this.currentMemberId, name: this.operatorName() } };
    return this.state();
  }

  /** 新建并下发一个行动（五步第一步）
   *  school_id：已存在的学校 id；或 school：新建学校对象 {name,stages,nature,office_nature}
   *  responsible / due_at / difficulty：大行动维度的责任人、截止时间、难度
   */
  async start({ title, school_id, school, responsible = '招生管家', due_at = '', difficulty = '中' }) {
    this._assertRole('dispatched'); // 新建/下发行动 = 行动官 / 管理员
    resetTrace();
    let sid = school_id;
    if (!sid && school) {
      const created = this.ctx.base.insert('school', {
        school_id: `sch_${Date.now().toString(36)}`,
        name: school.name,
        stages: Array.isArray(school.stages) ? school.stages.join('/') : (school.stages || '小'),
        nature: school.nature || '',
        office_nature: school.office_nature || '',
        profile_notes: school.profile_notes || '',
        knowledge: school.knowledge || '',
      });
      sid = created.school_id;
    }
    const a = await this.orch.action.createAction({
      school_id: sid || this.ctx.config.mvpSchoolId,
      title: title || '未命名招生控流行动',
      source: '招生服务中心',
      due_at,
      responsible,
      difficulty,
    });
    await this.orch.action.dispatch(a.action_id, '项目群');
    this.actionId = a.action_id;
    this.phase = 'dispatched';
    this.lastStep = { role: '行动官', name: '行动下发', data: a };
    return this.state();
  }

  /** 推进一步自动化阶段；遇到人审闸返回 needReview/needFinal；等待上传返回 needUpload */
  async next() {
    if (this.phase === 'idle') throw new Error('请先 start()');
    this._assertRole(this.phase); // 只能推进自己角色负责（或管理员可任意）的步骤
    switch (this.phase) {
      case 'dispatched': {
        const tasks = await this.orch.conduction.decompose(this.actionId);
        this.tasks = tasks;
        this.phase = 'decomposed';
        this.lastStep = { role: '传导官', name: '拆解任务包', data: tasks };
        break;
      }

      case 'decomposed': {
        const guidance = await this.orch.exec.pushGuidance(this.actionId, '家服主任');
        this.phase = 'executing';
        this.lastStep = { role: '执行助手', name: '推送话术模板', data: { guidance } };
        break;
      }

      case 'executing': {
        // 进入凭证上传阶段：由家服主任手动逐任务上传凭证（含图片），不再自动生成占位
        this.phase = 'uploading';
        this.lastStep = { role: '编排器', name: '进入凭证上传', data: { taskCount: this.tasks.length } };
        break;
      }

      case 'uploading': {
        const tasks = this.ctx.base.list('task').filter((t) => t.action_id === this.actionId);
        const missing = tasks.filter((t) => !this.vouchers.some((v) => v.task_id === t.task_id));
        if (missing.length > 0) {
          this.lastStep = { role: '编排器', name: '等待凭证上传', data: { missing: missing.length } };
          return { ...this.state(), needUpload: true };
        }
        this.phase = 'reviewing';
        this.lastStep = { role: '执行助手', name: '凭证已上传·进入审核', data: null };
        break;
      }

      case 'reviewing': {
        if (this.pendingVouchers.length > 0) {
          return { ...this.state(), needReview: true };
        }
        // 全部凭证已审 → 跟盯扫描 → 进入终审闸
        await this.orch.supervisor.followUp(this.actionId);
        this.phase = 'final';
        this.lastStep = { role: '编排器', name: '凭证审毕·进入终审', data: null };
        break;
      }

      case 'final':
        return { ...this.state(), needFinal: true };

      default:
        break;
    }
    return this.state();
  }

  /** 家服主任为某任务手动上传凭证（含图片附件）；提交人默认用当前操作者名（角色成员 > 角色名） */
  async uploadVoucher({ task_id, type, content, attachment = null, submitted_by = '' }) {
    this._assertRole('uploading'); // 上传凭证 = 家服主任 / 管理员
    const task = this.ctx.base.get('task', task_id);
    if (!task) throw new Error(`任务不存在: ${task_id}`);
    const sub = submitted_by || this.operatorName() || '家服主任';
    const v = this.ctx.base.insert('voucher', {
      task_id,
      type: type || '执行过程凭证',
      content: content || '',
      attachment,
      submitted_by: sub,
      review_status: '待审',
      review_note: '',
    });
    this.vouchers.push(v);
    this.pendingVouchers.push(v.voucher_id);
    this.lastStep = { role: '执行助手', name: '接收凭证上传', data: { voucher_id: v.voucher_id, task_id, submitted_by: sub } };
    logStepSafe(this.ctx, '执行助手', '接收凭证上传', { voucher_id: v.voucher_id, task_id, submitted_by: sub, hasAttachment: !!attachment });
    return this.state();
  }

  /** 人工初审某张凭证 */
  async reviewVoucher(voucherId, decision) {
    this._assertRole('reviewing'); // 凭证初审 = 督进官 / 管理员
    if (!this.pendingVouchers.includes(voucherId)) {
      throw new Error('该凭证不在待审队列');
    }
    await this.orch.supervisor.reviewVoucher(voucherId, decision);
    this.pendingVouchers = this.pendingVouchers.filter((x) => x !== voucherId);
    this.lastStep = { role: '督进官', name: '凭证初审（人审）', data: { voucher_id: voucherId, decision } };
    return this.state();
  }

  /** 人工终审行动 */
  async reviewFinal(decision) {
    this._assertRole('final'); // 终审归档 = 行动官 / 管理员
    const rec = await this.orch.action.finalReview(this.actionId, decision === 'approve' ? 'approve' : 'reject');
    this.phase = 'done';
    this.lastStep = { role: '行动官', name: '终审归档（人审）', data: { decision, status: rec.status } };
    return this.state();
  }

  /** 更新某任务的责任人 / 截止时间（仅当前角色负责该步骤时；管理员任意阶段可改） */
  async updateTask(taskId, { responsible, due_at } = {}) {
    if (!this.canOperate(this.phase)) throw new Error('当前角色无权修改该任务属性');
    const patch = {};
    if (responsible !== undefined) patch.responsible = responsible;
    if (due_at !== undefined) patch.due_at = due_at;
    this.ctx.base.update('task', taskId, patch);
    const t = this.tasks.find((x) => x.task_id === taskId);
    if (t) Object.assign(t, patch);
    this.lastStep = { role: '编排器', name: '更新任务属性', data: { task_id: taskId, ...patch } };
    return this.state();
  }

  /** 编辑行动主表（标题/难度/责任人/截止）；仅行动官(下发/终审)或管理员可改，且管理员任意阶段可改 */
  async updateAction({ title, difficulty, responsible, due_at } = {}) {
    if (!this.isAdmin() && !this.canOperate('dispatched')) {
      throw new Error(`当前角色「${this.currentRole().name}」无权修改行动主表（需 行动官 / 管理员）`);
    }
    const patch = {};
    if (title !== undefined) patch.title = title;
    if (difficulty !== undefined) patch.difficulty = difficulty;
    if (responsible !== undefined) patch.responsible = responsible;
    if (due_at !== undefined) patch.due_at = due_at;
    this.ctx.base.update('action', this.actionId, patch);
    this.lastStep = { role: '编排器', name: '更新行动主表', data: patch };
    logStepSafe(this.ctx, '编排器', '更新行动主表', patch);
    return this.state();
  }

  /** 手动新增任务包（传导官在「任务拆解 / 落地执行」阶段可增删；管理员任意阶段可增删） */
  async addTask({ stage = '统筹', content, responsible = '家服主任', due_at = '', assignee = '' } = {}) {
    this._assertEditable();
    this._assertRole('decomposed');
    if (!content || !String(content).trim()) throw new Error('任务内容必填');
    const base = this.ctx.base;
    const action = base.get('action', this.actionId);
    const due = due_at || (action && action.due_at) || ''; // 默认跟随大行动截止
    const rec = base.insert('task', {
      action_id: this.actionId,
      stage: stage || '统筹',
      role: '家服主任',
      content: String(content).trim(),
      due_at: due,
      status: TASK_STATUS.TODO,
      responsible: responsible || '家服主任',
      assignee: assignee || responsible || '家服主任',
    });
    this.tasks.push(rec);
    this.lastStep = { role: '编排器', name: '手动新增任务包', data: { task_id: rec.task_id, content: rec.content } };
    logStepSafe(this.ctx, '编排器', '手动新增任务包', { task_id: rec.task_id });
    return this.state();
  }

  /** 删除任务包（同允许阶段内；该任务已有上传凭证则禁止，避免孤儿凭证） */
  deleteTask(taskId) {
    this._assertEditable();
    this._assertRole('decomposed');
    if (!taskId) throw new Error('task_id 必填');
    const base = this.ctx.base;
    const t = base.get('task', taskId);
    if (!t) throw new Error('任务不存在');
    const hasVoucher = this.vouchers.some((v) => v.task_id === taskId);
    if (hasVoucher) throw new Error('该任务已有上传凭证，无法删除；如需删除请先移除其凭证');
    base.remove('task', taskId);
    this.tasks = this.tasks.filter((x) => x.task_id !== taskId);
    this.lastStep = { role: '编排器', name: '删除任务包', data: { task_id: taskId } };
    logStepSafe(this.ctx, '编排器', '删除任务包', { task_id: taskId });
    return this.state();
  }

  /** 任务结构可编辑窗口：任务拆解 / 落地执行；管理员不受阶段限制 */
  _assertEditable() {
    if (!this.actionId) throw new Error('请先 start()');
    if (this.isAdmin()) return; // 管理员可任意阶段修改
    const ok = TASK_EDITABLE_PHASES.includes(this.phase);
    if (!ok) throw new Error('仅可在「任务拆解 / 落地执行」阶段增删任务包（凭证上传后结构锁定；管理员可跳转步骤后修改）');
  }

  /** 扫描逾期项（大行动 / 小行动），返回 overdueItems；mock 模式仅返回，real 模式逐条发飞书提醒 */
  checkOverdue(now = Date.now(), notify = false) {
    const items = [];
    const action = this.actionId ? this.ctx.base.get('action', this.actionId) : null;
    if (action && action.status !== ACTION_STATUS.CLOSED && action.due_at) {
      const due = new Date(action.due_at).getTime();
      if (due < now) {
        items.push({
          kind: 'action',
          id: action.action_id,
          title: action.title,
          responsible: action.responsible || action.owner || '',
          due_at: action.due_at,
          overdue_by_ms: now - due,
        });
      }
    }
    for (const t of this.tasks) {
      if (t.status === TASK_STATUS.DONE) continue; // 已完成不计逾期
      if (t.due_at) {
        const due = new Date(t.due_at).getTime();
        if (due < now) {
          items.push({
            kind: 'task',
            id: t.task_id,
            title: t.content,
            responsible: t.responsible || t.assignee || '',
            due_at: t.due_at,
            overdue_by_ms: now - due,
          });
        }
      }
    }
    if (notify && items.length) {
      const mode = this.ctx.feishu.mode;
      for (const it of items) {
        const text = `【逾期提醒】${it.kind === 'action' ? '大行动' : '小行动'}「${it.title}」应于 ${it.due_at} 前完成，已逾期，责任人：${it.responsible}。`;
        if (mode === 'real') {
          this.ctx.feishu.sendMessage(this.ctx.config.feishu.notifyChatId || '项目群', text);
        } else {
          this.ctx.feishu.sendMessage('项目群', text);
        }
      }
      logStepSafe(this.ctx, '督进官', '逾期提醒', { count: items.length, real: mode === 'real' });
    }
    return items;
  }

  reset() {
    this.phase = 'idle';
    this.actionId = null;
    this.tasks = [];
    this.vouchers = [];
    this.pendingVouchers = [];
    this.lastStep = null;
    resetTrace();
    return this.state();
  }

  state() {
    const now = Date.now();
    const overdueItems = this.checkOverdue(now);
    const overdueSet = new Set(overdueItems.map((i) => i.id));
    const rawAction = this.actionId ? this.ctx.base.get('action', this.actionId) : null;
    const action = rawAction ? { ...rawAction, overdue: overdueSet.has(rawAction.action_id) } : null;
    const tasks = this.tasks.map((t) => ({ ...t, overdue: overdueSet.has(t.task_id) }));
    const cur = this.currentRole();
    const allowed = this.allowedPhases();
    return {
      phase: this.phase,
      actionId: this.actionId,
      action,
      tasks,
      vouchers: this.vouchers,
      pendingVouchers: this.pendingVouchers,
      lastStep: this.lastStep,
      trace: getTrace(),
      overdueItems,
      overdueCount: overdueItems.length,
      currentRoleId: this.currentRoleId,
      currentRole: cur ? { id: cur.id, name: cur.name, scope: cur.scope, members: cur.members || [] } : null,
      currentMemberId: this.currentMemberId,
      currentMember: this.currentMember(),
      operatorName: this.operatorName(),
      // 角色权限：前端据此决定「可见 / 可操作」的步骤与按钮
      allowedPhases: allowed,
      isAdmin: this.isAdmin(),
      canEditCurrent: allowed.includes(this.phase),
      phases: PHASES,
    };
  }
}

function logStepSafe(ctx, actor, action, detail) {
  try { require('./tools').logStep(actor, action, detail); } catch (_) {} // 避免工具缺失导致崩溃
}

module.exports = { DemoSession, ACTION_STATUS, TASK_STATUS, VOUCHER_STATUS };
