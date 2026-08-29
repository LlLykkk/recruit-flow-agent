'use strict';

/**
 * Base 字段框架（对齐方案第 5 章 / 待真实字段对齐 F1）
 * 四张飞书多维表：行动主表 / 任务包表 / 凭证表 / 学校档案表。
 * 真实模式经 bitable API；mock 模式用内存表，字段结构一致。
 */

// 五步闭环状态机（行动主表.status）
const ACTION_STATUS = {
  PENDING: '待下发',
  DISPATCHED: '已下发',     // 任务布置
  DECOMPOSED: '已拆解',     // 解读拆解
  EXECUTING: '执行中',      // 落地执行
  REVIEWING: '审核中',      // 凭证审核
  CLOSED: '已闭环',         // 归档
};
const ACTION_STATUS_FLOW = [
  ACTION_STATUS.PENDING,
  ACTION_STATUS.DISPATCHED,
  ACTION_STATUS.DECOMPOSED,
  ACTION_STATUS.EXECUTING,
  ACTION_STATUS.REVIEWING,
  ACTION_STATUS.CLOSED,
];

// 任务包状态
const TASK_STATUS = {
  TODO: '待开始',
  DOING: '进行中',
  DONE: '已完成',
  OVERDUE: '逾期',
};

// 凭证审核状态
const VOUCHER_STATUS = {
  PENDING: '待审',
  PASS: '通过',
  REJECT: '驳回',
};

// 学段
const STAGES = ['幼', '小', '初', '高'];

// 学校性质 / 招办性质 / 凭证类型 / 行动难度（默认选项集，前端可运行时新建）
const SCHOOL_NATURE = ['民办', '公办', '合作办学', '集团直营'];
const OFFICE_NATURE = ['自建招办', '外包代理', '集团派驻', '校方兼管'];
const VOUCHER_TYPE = ['活动照片', '触达名单', '家长反馈', '会议纪要'];
const DIFFICULTY = ['低', '中', '高'];

// 表字段定义（name 为中文列名，便于真实模式按列名映射；mock 用 key）
const SCHEMA = {
  action: {
    key: 'action',
    label: '行动主表',
    fields: [
      { key: 'action_id', name: '行动ID', type: 'text' },
      { key: 'school_id', name: '学校ID', type: 'text' },
      { key: 'title', name: '行动标题', type: 'text' },
      { key: 'source', name: '发起方', type: 'text' },      // 招生服务中心
      { key: 'owner', name: '负责人', type: 'text' },       // 行动官
      { key: 'responsible', name: '责任人', type: 'text' },  // 大行动责任人（默认招生管家）
      { key: 'difficulty', name: '行动难度', type: 'text' }, // 低/中/高
      { key: 'status', name: '状态', type: 'text' },
      { key: 'created_at', name: '创建时间', type: 'datetime' },
      { key: 'due_at', name: '截止时间', type: 'datetime' },
      { key: 'closed_at', name: '闭环时间', type: 'datetime' },
    ],
  },
  task: {
    key: 'task',
    label: '任务包表',
    fields: [
      { key: 'task_id', name: '任务ID', type: 'text' },
      { key: 'action_id', name: '行动ID', type: 'text' },
      { key: 'stage', name: '学段', type: 'text' },
      { key: 'role', name: '责任角色', type: 'text' },     // 家服主任
      { key: 'content', name: '任务内容', type: 'text' },
      { key: 'responsible', name: '责任人', type: 'text' }, // 小行动责任人（默认家服主任）
      { key: 'due_at', name: '截止时间', type: 'datetime' },
      { key: 'status', name: '状态', type: 'text' },
      { key: 'assignee', name: '执行人', type: 'text' },
    ],
  },
  voucher: {
    key: 'voucher',
    label: '凭证表',
    fields: [
      { key: 'voucher_id', name: '凭证ID', type: 'text' },
      { key: 'task_id', name: '任务ID', type: 'text' },
      { key: 'type', name: '凭证类型', type: 'text' },
      { key: 'content', name: '凭证内容', type: 'text' },
      { key: 'attachment', name: '附件', type: 'text' },    // {filename,mime,dataUrl}
      { key: 'submitted_by', name: '提交人', type: 'text' },
      { key: 'review_status', name: '审核状态', type: 'text' },
      { key: 'review_note', name: '审核备注', type: 'text' },
    ],
  },
  school: {
    key: 'school',
    label: '学校档案表',
    fields: [
      { key: 'school_id', name: '学校ID', type: 'text' },
      { key: 'name', name: '学校名称', type: 'text' },
      { key: 'stages', name: '学段', type: 'text' },        // 逗号分隔 幼/小/初/高（可多选+新建）
      { key: 'nature', name: '学校性质', type: 'text' },    // 民办/公办/合作办学/集团直营
      { key: 'office_nature', name: '招办性质', type: 'text' }, // 自建招办/外包代理/集团派驻/校方兼管
      { key: 'profile_notes', name: '校情备注', type: 'text' },
      { key: 'knowledge', name: '知识种子', type: 'text' }, // 话术/标准种子
    ],
  },
};

// 生成带默认值的空记录
function emptyRecord(tableKey) {
  const def = SCHEMA[tableKey];
  const rec = {};
  for (const f of def.fields) {
    rec[f.key] = f.type === 'datetime' ? '' : '';
  }
  return rec;
}

module.exports = {
  ACTION_STATUS,
  ACTION_STATUS_FLOW,
  TASK_STATUS,
  VOUCHER_STATUS,
  STAGES,
  SCHOOL_NATURE,
  OFFICE_NATURE,
  VOUCHER_TYPE,
  DIFFICULTY,
  SCHEMA,
  emptyRecord,
};
