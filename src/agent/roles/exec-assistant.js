'use strict';

/**
 * 执行助手（辅助校端家服主任）
 * 按校情生成模板/话术 → 推送给家服主任；辅助生成凭证草稿。
 */
const { ACTION_STATUS, TASK_STATUS } = require('../../data/schema');
const { EXEC_ASSISTANT } = require('../prompts');
const { logStep } = require('../tools');

class ExecAssistant {
  constructor(ctx) {
    this.ctx = ctx;
  }

  _schoolProfile(school_id) {
    const s = this.ctx.base.get('school', school_id);
    return s || { school_id, name: school_id, stages: '小', profile_notes: '', knowledge: '' };
  }

  /** 为某行动的各任务包生成校情化话术/模板，推给家服主任 */
  async pushGuidance(actionId, target = '家服主任') {
    const base = this.ctx.base;
    const action = base.get('action', actionId);
    const school = this._schoolProfile(action.school_id);
    const tasks = base.list('task').filter((t) => t.action_id === actionId);

    const messages = [
      { role: 'system', content: EXEC_ASSISTANT },
      {
        role: 'user',
        content:
          `行动：${action.title}\n学校：${school.name}（${school.stages}）\n` +
          `学校性质：${school.nature || '（未填）'}　招办性质：${school.office_nature || '（未填）'}\n` +
          `校情：${school.profile_notes || '（暂无）'}\n` +
          `任务包：${tasks.map((t) => `- [${t.stage}] ${t.content}`).join('\n')}\n` +
          `请为家服主任生成可直接使用的执行话术与模板要点。`,
      },
    ];
    const fallback = this._defaultGuidance(action, school, tasks);
    const r = await this.ctx.llm.chat(messages);
    const guidance = (r && r.content && !r.content.includes('[规则回退]'))
      ? r.content
      : fallback;

    await this.ctx.feishu.sendMessage(target, `【执行助手·话术模板】\n${guidance}`);
    // 行动推进到「执行中」
    base.update('action', actionId, { status: ACTION_STATUS.EXECUTING });
    for (const t of tasks) if (t.status === TASK_STATUS.TODO) base.update('task', t.task_id, { status: TASK_STATUS.DOING });
    logStep('执行助手', '推送话术模板', { action_id: actionId, target });
    return guidance;
  }

  /** 辅助生成凭证草稿（家服主任填写后提交） */
  async draftVoucher(taskId, submittedBy = '家服主任') {
    const base = this.ctx.base;
    const task = base.get('task', taskId);
    if (!task) throw new Error(`任务不存在: ${taskId}`);
    const v = base.insert('voucher', {
      task_id: taskId,
      type: '执行过程凭证',
      content: `（${submittedBy} 待填）任务「${task.content}」的过程记录与结果，建议含：触达人数/活动照片/家长反馈。`,
      submitted_by: submittedBy,
      review_status: '待审',
      review_note: '',
    });
    logStep('执行助手', '生成凭证草稿', { voucher_id: v.voucher_id, task_id: taskId });
    return v;
  }

  _defaultGuidance(action, school, tasks) {
    const natureLine = (school.nature || school.office_nature)
      ? `\n（该校性质：${school.nature || '—'}；招办性质：${school.office_nature || '—'}）`
      : '';
    return (
      `各位家服主任，关于「${action.title}」，建议按以下步骤推进：\n` +
      `1. 结合本校（${school.name}）实际，认领对应学段任务包；${natureLine}\n` +
      `2. 每完成一项，留存过程照片/截图与家长反馈作为凭证；\n` +
      `3. 按《招生控流工作流》标准整理后提交初审。\n` +
      `（规则回退话术，待校情知识库校准）`
    );
  }
}

module.exports = { ExecAssistant };
