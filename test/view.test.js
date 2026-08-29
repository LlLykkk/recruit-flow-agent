'use strict';

/**
 * 页面可见性测试（静态校验交互页 HTML）：
 *  1) 全员可看全部步骤：不再有「无权操作本步骤」大横幅 / 「无权推进」文字提示
 *  2) 只读禁点：页面含 locked-view（只读块）与「只读」标记、disabled 按钮逻辑
 *  3) 运行轨迹对所有角色可见（不再按 isAdmin 隐藏）
 */
const assert = require('assert');
const { app } = require('../src/index');

function getHtml() {
  return new Promise((resolve) => {
    const server = app.listen(0, async () => {
      const port = server.address().port;
      const r = await fetch(`http://127.0.0.1:${port}/`);
      const html = await r.text();
      server.close(() => resolve(html));
    });
  });
}

(async () => {
  const html = await getHtml();

  // 1) 全员可看：移除旧横幅/旧文字提示
  assert.ok(!html.includes('无权操作本步骤'), '不应再有「无权操作本步骤」横幅（改为可看全部）');
  assert.ok(!html.includes('无权推进'), '不应再有「无权推进」文字提示（改用禁用按钮）');
  assert.ok(!html.includes('无权审核'), '不应再有「无权审核」文案');

  // 2) 只读禁点：locked-view 只读块 + 「只读」标记 + disabled 按钮逻辑存在
  assert.ok(html.includes('locked-view'), '页面应含只读块类名 locked-view');
  assert.ok(html.includes('只读'), '页面应含「只读」标记（步骤条/表单/闸门提示）');
  assert.ok(html.includes('disabled'), '页面应含按钮禁用逻辑（disabled）');
  assert.ok(html.includes('pointer-events:none'), '只读块应整体禁点（pointer-events:none）');

  // 3) 运行轨迹对所有人可见
  assert.ok(html.includes('traceBox'), '运行轨迹容器应存在且不再按管理员隐藏');

  console.log('✓ 页面可见性测试通过（全员可看全部步骤 / 只读禁点 / 轨迹可见）');
})().catch((e) => {
  console.error('✗ 页面可见性测试失败:', e.message);
  process.exit(1);
});
