'use strict';

/**
 * 角色共享工具：步骤日志 + 演示轨迹收集（便于 demo 逐步骤打印）。
 */
const trace = [];

function logStep(role, action, detail) {
  const entry = { role, action, detail, at: new Date().toISOString() };
  trace.push(entry);
  const tag = `[${role}] ${action}`;
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  console.log(`\x1b[36m${tag}\x1b[0m ${d}`);
  return entry;
}

function getTrace() {
  return trace;
}

function resetTrace() {
  trace.length = 0;
}

/** 统一构造飞书交互卡片（人审闸）：通过 / 驳回 */
function reviewCard(title, actionId, onPassLabel = '通过终审', onRejectLabel = '驳回') {
  return {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: false },
      header: { title: { tag: 'plain_text', content: title }, template: 'blue' },
      elements: [
        {
          tag: 'button',
          text: { tag: 'plain_text', content: onPassLabel },
          type: 'primary',
          value: { action: 'approve', action_id: actionId },
        },
        {
          tag: 'button',
          text: { tag: 'plain_text', content: onRejectLabel },
          type: 'danger',
          value: { action: 'reject', action_id: actionId },
        },
      ],
    },
  };
}

module.exports = { logStep, getTrace, resetTrace, reviewCard };
