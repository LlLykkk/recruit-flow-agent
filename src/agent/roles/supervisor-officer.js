'use strict';

/**
 * 督进官（对应项目主理人）
 * 跟盯任务逾期 → 催办；对提交凭证做【初审】（齐备性/格式），不裁决业务真实性。
 */
const { TASK_STATUS, VOUCHER_STATUS, ACTION_STATUS } = require('../../data/schema');
const { SUPERVISOR_OFFICER } = require('../prompts');
const { logStep } = require('../tools');

class SupervisorOfficer {
  constructor(ctx) {
    this.ctx = ctx;
  }

  /** 扫描逾期任务并催办 */
  async followUp(actionId) {
    const base = this.ctx.base;
    const tasks = base.list('task').filter((t) => t.action_id === actionId);
    const now = Date.now();
    const overdue = tasks.filter((t) => {
      if (t.status === TASK_STATUS.DONE) return false;
      const due = t.due_at ? new Date(t.due_at).getTime() : 0;
      return due && due < now;
    });
    for (const t of overdue) {
      base.update('task', t.task_id, { status: TASK_STATUS.OVERDUE });
      await this.ctx.feishu.sendMessage('项目群', `【催办】任务「${t.content}」已逾期，请 ${t.assignee} 尽快推进。`);
      logStep('督进官', '逾期催办', { task_id: t.task_id });
    }
    if (overdue.length === 0) logStep('督进官', '跟盯扫描', { action_id: actionId, note: '无逾期' });
    return overdue;
  }

  /** 凭证初审：对齐标准判断齐备性，输出 通过/驳回
   *  decision 可人工传入 'approve' | 'reject'；不传则由模型/规则回退裁决。 */
  async reviewVoucher(voucherId, decision = null) {
    const base = this.ctx.base;
    const v = base.get('voucher', voucherId);
    if (!v) throw new Error(`凭证不存在: ${voucherId}`);
    const task = base.get('task', v.task_id);

    let verdict, note;
    if (decision === 'approve' || decision === 'reject') {
      verdict = decision === 'approve' ? VOUCHER_STATUS.PASS : VOUCHER_STATUS.REJECT;
      note = decision === 'approve' ? '人工初审通过（齐备、合规）。' : '人工初审驳回，请补充执行过程与结果后重提。';
    } else {
      const messages = [
        { role: 'system', content: SUPERVISOR_OFFICER },
        {
          role: 'user',
          content:
            `任务要求：${task ? task.content : '（未知）'}\n` +
            `凭证类型：${v.type}\n凭证内容：${v.content}\n` +
            `附件：${v.attachment ? `有（${v.attachment.filename || ''}）` : '无'}\n` +
            `请判断材料是否齐备、格式是否合规，输出 JSON。`,
        },
      ];
      const fallback = this._defaultReview(v);
      const parsed = await this.ctx.llm.chatJSON(messages, fallback);
      verdict = (parsed && parsed.decision === '驳回') ? VOUCHER_STATUS.REJECT : VOUCHER_STATUS.PASS;
      note = (parsed && parsed.note) || fallback.note;
    }

    const rec = base.update('voucher', voucherId, { review_status: verdict, review_note: note });
    if (verdict === VOUCHER_STATUS.REJECT) {
      await this.ctx.feishu.sendMessage('项目群', `【初审驳回】凭证 ${voucherId}：${note}`); // 人审闸：驳回需整改
    } else {
      // 通过则把对应任务置已完成、推进行动到审核中
      if (task) base.update('task', task.task_id, { status: TASK_STATUS.DONE });
      base.update('action', v.action_id, { status: ACTION_STATUS.REVIEWING });
    }
    logStep('督进官', '凭证初审', { voucher_id: voucherId, decision: verdict, note });
    return rec;
  }

  _defaultReview(v) {
    const ok = v.content && v.content.length >= 4 && v.type;
    return ok
      ? { decision: '通过', note: '材料齐备、格式合规（规则回退判定）' }
      : { decision: '驳回', note: '内容过短或缺少凭证类型，请补充具体执行过程与结果' };
  }
}

module.exports = { SupervisorOfficer };
