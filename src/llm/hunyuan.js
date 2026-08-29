'use strict';

/**
 * 大模型客户端（可插拔，对齐方案第 4 章 / 待补 F2 提示词）。
 * 通道优先级：腾讯混元 -> OpenAI 兼容 -> 规则化回退（无密钥也能跑 demo）。
 *
 * 对外：
 *   chat(messages, opts)        -> { content, role, model }
 *   chatJSON(messages, fallback)-> 解析出的对象（失败返回 fallback）
 */
const config = require('../config');

let _hunyuanClient = null;
function hunyuanClient() {
  if (_hunyuanClient) return _hunyuanClient;
  try {
    const tencentcloud = require('tencentcloud-sdk-nodejs');
    const HunyuanClient = tencentcloud.hunyuan.v20230901.Client;
    _hunyuanClient = new HunyuanClient({
      credential: { secretId: config.hunyuan.secretId, secretKey: config.hunyuan.secretKey },
      region: config.hunyuan.region,
      profile: { httpProfile: { endpoint: 'hunyuan.tencentcloudapi.com', reqTimeout: 30 } },
    });
  } catch (e) {
    console.warn('[llm] 混元 SDK 加载失败，走回退：', e.message);
    _hunyuanClient = null;
  }
  return _hunyuanClient;
}

async function chatHunyuan(messages) {
  const client = hunyuanClient();
  if (!client) return null;
  const resp = await client.ChatCompletions({
    Model: config.hunyuan.model,
    Stream: false,
    Messages: messages.map((m) => ({ Role: m.role, Content: m.content })),
  });
  const content = resp?.Choices?.[0]?.Message?.Content || '';
  return { content, model: config.hunyuan.model, role: 'assistant' };
}

async function chatOpenAI(messages) {
  if (!config.openai.baseUrl || !config.openai.apiKey) return null;
  const res = await fetch(`${config.openai.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openai.apiKey}`,
    },
    body: JSON.stringify({ model: config.openai.model, messages, stream: false }),
  });
  if (!res.ok) throw new Error(`openai http ${res.status}`);
  const data = await res.json();
  return {
    content: data?.choices?.[0]?.message?.content || '',
    model: config.openai.model,
    role: 'assistant',
  };
}

/** 规则化回退：在无密钥时提供结构化默认输出，保证 demo 可跑 */
function fallbackReply(messages) {
  const last = messages[messages.length - 1]?.content || '';
  return {
    content: `[规则回退] ${last.slice(0, 60)}…（未配置大模型密钥，已用默认结构化产出）`,
    model: 'rule-fallback',
    role: 'assistant',
  };
}

async function chat(messages) {
  try {
    if (config.hunyuan.secretId && config.hunyuan.secretKey) {
      const r = await chatHunyuan(messages);
      if (r) return r;
    }
  } catch (e) {
    console.warn('[llm] 混元调用失败：', e.message);
  }
  try {
    const r = await chatOpenAI(messages);
    if (r) return r;
  } catch (e) {
    console.warn('[llm] openai 调用失败：', e.message);
  }
  return fallbackReply(messages);
}

/** 从模型输出中提取 JSON（容错：去掉代码块、截取首个 {…}） */
function extractJSON(text) {
  if (text == null) return null;
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

async function chatJSON(messages, fallback) {
  const r = await chat(messages);
  const obj = extractJSON(r.content);
  return obj || fallback;
}

module.exports = { chat, chatJSON, extractJSON, fallbackReply, _channel: () => (config.llmEnabled ? (config.hunyuan.secretId ? 'hunyuan' : 'openai') : 'fallback') };
