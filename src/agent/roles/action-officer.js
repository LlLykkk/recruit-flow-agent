'use strict';

/**
 * 行动官（对应招生管家）
 * 收行动 → 建《行动主表》→ 下发通知；人审通过后终审归档。
 */
const { ACTION_STATUS } = require('../../data/schema');
const { ACTION_OFFICER } = require('../prompts');
const { logStep, reviewCard } = require('../tools');

class ActionOfficer {
  constructor(ctx) {
    this.ctx = ctx; // { feishu, base, llm }
  }

  async createAction({ school_id, title, source = '招生服务中心', due_at = '', owner = '行动官', responsible = '招生管家', difficulty = '中' }) {
    const base = this.ctx.base;
    const record = {
      school_id,
      title,
      source,
      owner,
      responsible,
      difficulty,
      status: ACTION_STATUS.PENDING,
      created_at: new Date().toISOString(),
      due_at,
      closed_at: '',
    };
    const saved = base.insert('action', record);
    logStep('行动官', '建立行动主表', { action_id: saved.action_id, title, school_id, difficulty, responsible });
    return saved;
  }

  /** 下发：状态置「已下发」，并通知相关方 */
  async dispatch(actionId, notifyTarget) {
    const base = this.ctx.base;
    const rec = base.update('action', actionId, { status: ACTION_STATUS.DISPATCHED });
    const text = `【行动下发】${rec.title}\n学校：${rec.school_id}\n难度：${rec.difficulty || '中'}　责任人：${rec.responsible || rec.owner}\n截止：${rec.due_at || '未设'}\n请传导官按校情拆解任务包。`;
    await this.ctx.feishu.sendMessage(notifyTarget || '项目群', text);
    logStep('行动官', '行动下发通知', { action_id: actionId, status: ACTION_STATUS.DISPATCHED });
    return rec;
  }

  /**
   * 终审归档（人审闸）：默认 demo 模式自动通过；
   * real 模式应等待飞书卡片「通过/驳回」回传后再调用。
   */
  async finalReview(actionId, decision = 'approve') {
    const base = this.ctx.base;
    if (decision !== 'approve') {
      logStep('行动官', '终审驳回', { action_id: actionId, note: '需整改后重新提交' });
      return base.get('action', actionId);
    }
    const rec = base.update('action', actionId, {
      status: ACTION_STATUS.CLOSED,
      closed_at: new Date().toISOString(),
    });
    await this.ctx.feishu.sendMessage('项目群', `【闭环归档】${rec.title} 已通过终审并归档。`);
    logStep('行动官', '终审归档', { action_id: actionId, status: ACTION_STATUS.CLOSED });
    return rec;
  }

  /** 生成人审卡片（真实模式推送到飞书，等待回调） */
  buildReviewCard(actionId, title) {
    return reviewCard(`请终审：${title}`, actionId, '通过终审', '驳回');
  }
}

module.exports = { ActionOfficer };
