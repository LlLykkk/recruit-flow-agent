'use strict';

/**
 * 编排器（串联器）：驱动五步闭环状态机。
 * 待下发 → 已下发(任务布置) → 已拆解(解读拆解) → 执行中(落地执行) → 审核中(凭证审核) → 已闭环(归档)
 * 每个角色只做机械动作，人审闸（终审/驳回）由 action-officer / supervisor-officer 暴露。
 */
const { ActionOfficer } = require('./roles/action-officer');
const { ConductionOfficer } = require('./roles/conduction-officer');
const { SupervisorOfficer } = require('./roles/supervisor-officer');
const { ExecAssistant } = require('./roles/exec-assistant');
const { logStep } = require('./tools');

class Orchestrator {
  constructor(ctx) {
    this.ctx = ctx;
    this.action = new ActionOfficer(ctx);
    this.conduction = new ConductionOfficer(ctx);
    this.supervisor = new SupervisorOfficer(ctx);
    this.exec = new ExecAssistant(ctx);
  }

  /** 端到端跑一个行动（MVP demo 用）。autoReview=true 时模拟人审通过。 */
  async runAction({ school_id, title, source, due_at, autoReview = true, notifyTarget = '项目群' }) {
    logStep('编排器', '启动五步闭环', { school_id, title });

    const a = await this.action.createAction({ school_id, title, source, due_at });
    await this.action.dispatch(a.action_id, notifyTarget);                 // → 已下发
    const tasks = await this.conduction.decompose(a.action_id);            // → 已拆解
    await this.exec.pushGuidance(a.action_id, '家服主任');                  // → 执行中

    // 模拟校端执行：为每个任务生成凭证草稿并提交
    for (const t of tasks) {
      const v = await this.exec.draftVoucher(t.task_id, '家服主任');
      await this.supervisor.reviewVoucher(v.voucher_id);                   // → 审核中（通过则任务完成）
    }
    await this.supervisor.followUp(a.action_id);

    // 人审闸：终审
    const rec = await this.action.finalReview(a.action_id, autoReview ? 'approve' : 'reject'); // → 已闭环
    logStep('编排器', '闭环完成', { action_id: a.action_id, status: rec.status });
    return rec;
  }

  /** 飞书卡片回调：终审通过/驳回 */
  async handleReviewCallback(value) {
    if (!value || !value.action_id) return null;
    if (value.action === 'approve') return this.action.finalReview(value.action_id, 'approve');
    if (value.action === 'reject') return this.action.finalReview(value.action_id, 'reject');
    return null;
  }

  getStatus(actionId) {
    return this.ctx.base.get('action', actionId);
  }
}

module.exports = { Orchestrator };
