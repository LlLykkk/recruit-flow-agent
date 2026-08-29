'use strict';

/**
 * 配置中心：所有密钥/环境相关项仅从这里读取，绝不硬编码。
 * 本地运行复制 .env.example 为 .env 并填写；CloudBase 部署在控制台/CLI 配置环境变量或密钥。
 * 内置极简 .env 加载器（不引入 dotenv 依赖，保证离线/CloudBase 均可跑）。
 */
(function loadEnv() {
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    const text = fs.readFileSync(envPath, 'utf8');
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch (_) { /* 忽略 .env 读取错误，环境变量优先 */ }
})();

function bool(v, d = false) {
  if (v === undefined || v === null || v === '') return d;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

const { PILOT_SCHOOLS, DEFAULT_OPTIONS } = require('./data/seed');

const config = {
  // 服务
  port: parseInt(process.env.PORT || '9000', 10),
  env: process.env.NODE_ENV || 'development',

  // 预置选项集与试点校（前端下拉 + 启动时写入学校档案表）
  options: DEFAULT_OPTIONS,
  pilotSchools: PILOT_SCHOOLS,

  // 飞书对接开关：mock = 内存模拟（无凭证也能跑通全闭环）；real = 真实飞书开放平台
  feishuMode: (process.env.FEISHU_MODE || 'mock').toLowerCase(),

  // 飞书自建应用（real 模式需填）
  feishu: {
    appId: process.env.FEISHU_APP_ID || '',
    appSecret: process.env.FEISHU_APP_SECRET || '',
    verificationToken: process.env.FEISHU_VERIFICATION_TOKEN || '', // 事件订阅 verification token
    encryptKey: process.env.FEISHU_ENCRYPT_KEY || '',               // 事件订阅 Encrypt Key（可选）
    baseAppToken: process.env.FEISHU_BASE_APP_TOKEN || '',           // 《招生控流工作流》多维表 app_token
    // 四表 table_id（真实模式；mock 模式用内存表，结构一致）
    tables: {
      action: process.env.FEISHU_TABLE_ACTION || '',
      task: process.env.FEISHU_TABLE_TASK || '',
      voucher: process.env.FEISHU_TABLE_VOUCHER || '',
      school: process.env.FEISHU_TABLE_SCHOOL || '',
    },
    // 通知接收方（chat_id / open_id / user_id），真实模式使用
    notifyChatId: process.env.FEISHU_NOTIFY_CHAT_ID || '',
  },

  // 腾讯混元（大模型）。缺失时走规则化回退，保证本地 demo 可跑。
  hunyuan: {
    secretId: process.env.HUNYUAN_SECRET_ID || '',
    secretKey: process.env.HUNYUAN_SECRET_KEY || '',
    model: process.env.HUNYUAN_MODEL || 'hunyuan-lite', // 默认轻量模型，可换 hunyuan-standard / pro
    region: process.env.HUNYUAN_REGION || 'ap-guangzhou',
  },

  // 可插拔 LLM：若用 OpenAI 兼容接口（如 DeepSeek），设置 OPENAI_BASE_URL + OPENAI_API_KEY
  openai: {
    baseUrl: process.env.OPENAI_BASE_URL || '',
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'deepseek-chat',
  },

  // 腾讯云 CloudBase 环境 ID（部署用，代码运行不依赖）
  cloudbaseEnvId: process.env.CLOUDBASE_ENV_ID || '',

  // MVP 试点校（温州慧中公学）
  mvpSchoolId: process.env.MVP_SCHOOL_ID || 'wenzhou_huizhong',
};

config.feishuEnabled = config.feishuMode === 'real' &&
  !!config.feishu.appId && !!config.feishu.appSecret;

config.llmEnabled = !!(config.hunyuan.secretId && config.hunyuan.secretKey) ||
  !!(config.openai.baseUrl && config.openai.apiKey);

module.exports = config;
