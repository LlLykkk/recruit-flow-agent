'use strict';

/**
 * 传导官（对应项目经理人）
 * 行动下发后，按校情把行动拆成结构化任务包，写入《任务包表》。
 */
const { TASK_STATUS, STAGES } = require('../../data/schema');
const { CONDUCTION_OFFICER } = require('../prompts');
const { logStep } = require('../tools');

class ConductionOfficer {
  constructor(ctx) {
    this.ctx = ctx;
  }

  /** 读取学校档案（校情/学段/知识种子） */
  _schoolProfile(school_id) {
    const s = this.ctx.base.get('school', school_id);
    if (!s) return { school_id, name: school_id, stages: STAGES.join('/'), profile_notes: '', knowledge: '' };
    return s;
  }

  async decompose(actionId) {
    const base = this.ctx.base;
    const action = base.get('action', actionId);
    if (!action) throw new Error(`行动不存在: ${actionId}`);
    const school = this._schoolProfile(action.school_id);
    const difficulty = action.difficulty || '中';

    const messages = [
      { role: 'system', content: CONDUCTION_OFFICER },
      {
        role: 'user',
        content:
          `行动标题：${action.title}\n` +
          `行动难度：${difficulty}\n` +
          `学校：${school.name}（${school.stages}）\n` +
          `学校性质：${school.nature || '（未填）'}　招办性质：${school.office_nature || '（未填）'}\n` +
          `校情：${school.profile_notes || '（暂无）'}\n` +
          `知识种子：${school.knowledge || '（暂无）'}\n` +
          `请按难度（${difficulty}）与学段拆成任务包，输出 JSON。`,
      },
    ];

    // 默认任务骨架（规则回退用，保证无密钥也能产出可执行结果）
    const fallback = this._defaultTasks(action, school, difficulty);
    const parsed = await this.ctx.llm.chatJSON(messages, fallback);
    const tasks = (parsed && parsed.tasks) ? parsed.tasks : fallback.tasks;

    // 截止时间均摊：把大行动截止窗口按任务数均匀分到各小行动
    const created = [];
    const actionDue = action.due_at ? new Date(action.due_at).getTime() : null;
    const start = Date.now();
    const total = tasks.length;
    tasks.forEach((t, i) => {
      let due;
      if (actionDue) {
        const frac = (i + 1) / total; // 第 i 个任务落在窗口的对应分位，最后一个恰好=大行动截止
        due = new Date(start + (actionDue - start) * frac).toISOString();
      } else {
        due = new Date(start + (i + 1) * 2 * 86400000).toISOString(); // 未设截止则默认每任务相隔 2 天
      }
      const rec = base.insert('task', {
        action_id: actionId,
        stage: t.stage || school.stages.split('/')[0],
        role: t.role || '家服主任',
        content: t.content,
        responsible: t.responsible || '家服主任', // 小行动责任人，默认家服主任，可改
        due_at: due,
        status: TASK_STATUS.TODO,
        assignee: t.assignee || '家服主任',
      });
      created.push(rec);
    });

    // 行动状态推进到「已拆解」
    base.update('action', actionId, { status: '已拆解' });
    await this.ctx.feishu.sendMessage('项目群',
      `【任务布置】${action.title}（难度：${difficulty}）已拆为 ${created.length} 个任务包，进入解读拆解。`);
    logStep('传导官', '拆解任务包', { action_id: actionId, count: created.length, difficulty });
    return created;
  }

  _defaultTasks(action, school, difficulty) {
    const stages = (school.stages || '小').split('/').filter(Boolean);
    const per = difficulty === '高' ? 3 : difficulty === '中' ? 2 : 1; // 低1/中2/高3（每学段）
    const tasks = [];
    const natureNote = school.nature ? `学校性质：${school.nature}；` : '';
    const officeNote = school.office_nature ? `招办性质：${school.office_nature}。` : '';
    const compliance = school.office_nature === '外包代理'
      ? '（外包代理，需强化过程留痕与合规佐证）'
      : '';
    for (const st of stages) {
      for (let i = 1; i <= per; i += 1) {
        tasks.push({
          stage: st,
          role: '家服主任',
          responsible: '家服主任',
          content:
            `【${st}·第${i}项】落地「${action.title}」：${natureNote}${officeNote}` +
            `制定执行清单并组织一次家长/生源触达活动，留存过程凭证${compliance}。`,
        });
      }
    }
    return { tasks };
  }
}

module.exports = { ConductionOfficer };
