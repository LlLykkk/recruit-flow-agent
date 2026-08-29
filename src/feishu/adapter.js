'use strict';

/**
 * 飞书适配层（消息 + 事件 + 多维表）。mock/real 统一接口。
 *  - mock 模式：全部走 MemoryStore，无需任何凭证，本地 demo 完整可跑。
 *  - real 模式：用 @larksuiteoapi/node-sdk 做事件签名校验、消息发送、卡片回调、bitable 读写。
 *    （real 模式为部署到腾讯云后填入 FEISHU_APP_ID/SECRET 即启用；本仓库默认 mock。）
 */
const config = require('../config');
const { MemoryStore } = require('./store');
const { BaseAdapter } = require('./base');

class FeishuAdapter {
  constructor() {
    this.mode = config.feishuMode;
    this.store = new MemoryStore();
    this.base = new BaseAdapter(this.store);
    this.lark = null; // real 模式下的 lark client

    if (this.mode === 'real' && config.feishuEnabled) {
      this._initReal();
    }
  }

  _initReal() {
    try {
      // optionalDependency：未安装时不阻塞 mock 运行
      const { Client } = require('@larksuiteoapi/node-sdk');
      this.lark = new Client({
        appId: config.feishu.appId,
        appSecret: config.feishu.appSecret,
        disableTokenCache: false,
      });
      // 把 bitable client 注入 BaseAdapter（用同一 lark client 调 bitable 接口）
      this.base.client = {
        listRecords: async (tableId) => {
          const res = await this.lark.bitable.appTableRecord.list({
            path: { app_token: config.feishu.baseAppToken, table_id: tableId },
            params: { page_size: 100 },
          });
          return (res.data?.items || []).map(mapBitableToRecord);
        },
        getRecord: async (tableId, recordId) => {
          const res = await this.lark.bitable.appTableRecord.get({
            path: { app_token: config.feishu.baseAppToken, table_id: tableId, record_id: recordId },
          });
          return mapBitableToRecord(res.data);
        },
        createRecord: async (tableId, record) => {
          const res = await this.lark.bitable.appTableRecord.create({
            path: { app_token: config.feishu.baseAppToken, table_id: tableId },
            data: { fields: record },
          });
          return { ...record, record_id: res.data?.record_id };
        },
        updateRecord: async (tableId, recordId, patch) => {
          const res = await this.lark.bitable.appTableRecord.update({
            path: { app_token: config.feishu.baseAppToken, table_id: tableId, record_id: recordId },
            data: { fields: patch },
          });
          return res.data;
        },
        deleteRecord: async (tableId, recordId) => {
          await this.lark.bitable.appTableRecord.delete({
            path: { app_token: config.feishu.baseAppToken, table_id: tableId, record_id: recordId },
          });
          return true;
        },
      };
    } catch (e) {
      console.warn('[feishu] real 模式初始化失败，回退 mock：', e.message);
      this.mode = 'mock';
      this.base.mode = 'mock';
    }
  }

  // ---- 事件订阅：URL 验证 + 签名校验 ----
  async verifyChallenge(body) {
    // 飞书 URL 验证：返回 challenge
    if (body && body.type === 'url_verification') return { challenge: body.challenge };
    return null;
  }

  async verifySignature(req) {
    if (this.mode !== 'real') return true; // mock 不做校验
    // 真实模式应由 @larksuiteoapi 中间件校验；此处提供 token 校验兜底
    const token = req.body && req.body.token;
    if (config.feishu.verificationToken && token && token !== config.feishu.verificationToken) {
      return false;
    }
    return true;
  }

  // ---- 消息/卡片发送 ----
  async sendMessage(target, text) {
    if (this.mode === 'real' && this.lark) {
      await this.lark.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: target || config.feishu.notifyChatId, msg_type: 'text', content: JSON.stringify({ text }) },
      });
      return { id: 'real', target, text };
    }
    return this.store.pushMessage(target, text);
  }

  async sendCard(target, card) {
    if (this.mode === 'real' && this.lark) {
      await this.lark.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: target || config.feishu.notifyChatId, msg_type: 'interactive', content: JSON.stringify(card) },
      });
      return { id: 'real', target, card };
    }
    return this.store.pushCard(target, card);
  }

  // ---- 供 demo/调试查看 ----
  dump() {
    return {
      mode: this.mode,
      messages: this.store.messages,
      cards: this.store.cards,
      tables: this.store.tables,
    };
  }
}

// 飞书 bitable 记录：{ fields: {...} } -> 扁平 record
function mapBitableToRecord(item) {
  if (!item) return null;
  return { record_id: item.record_id, ...(item.fields || {}) };
}

module.exports = { FeishuAdapter };
