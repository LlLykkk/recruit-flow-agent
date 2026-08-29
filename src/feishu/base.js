'use strict';

/**
 * 多维表（Base）适配层。
 *  - mock 模式：直接用 MemoryStore，四表结构一致。
 *  - real 模式：经飞书 bitable OpenAPI（多维表格）读写；列名按 schema 中文名映射。
 * 对外暴露统一的 CRUD 接口，角色与编排器只依赖本层，不关心底层是 mock 还是真实。
 */
const config = require('../config');
const { MemoryStore } = require('./store');

class BaseAdapter {
  constructor(store) {
    this.mode = config.feishuMode;
    this.store = store || new MemoryStore();
    this.client = null; // real 模式下注入 lark bitable client
  }

  _requireReal() {
    if (this.mode !== 'real') return;
    if (!this.client) {
      // 真实模式在 adapter.js 初始化时注入 client；此处兜底提示
      throw new Error('real 模式未注入 bitable client，请在 feishu/adapter.js 初始化');
    }
  }

  list(tableKey) {
    if (this.mode === 'real') {
      this._requireReal();
      return this.client.listRecords(config.feishu.tables[tableKey]);
    }
    return this.store.list(tableKey);
  }

  get(tableKey, id) {
    if (this.mode === 'real') {
      this._requireReal();
      return this.client.getRecord(config.feishu.tables[tableKey], id);
    }
    return this.store.get(tableKey, id);
  }

  insert(tableKey, record) {
    if (this.mode === 'real') {
      this._requireReal();
      return this.client.createRecord(config.feishu.tables[tableKey], record);
    }
    return this.store.insert(tableKey, record);
  }

  update(tableKey, id, patch) {
    if (this.mode === 'real') {
      this._requireReal();
      return this.client.updateRecord(config.feishu.tables[tableKey], id, patch);
    }
    return this.store.update(tableKey, id, patch);
  }

  remove(tableKey, id) {
    if (this.mode === 'real') {
      this._requireReal();
      return this.client.deleteRecord(config.feishu.tables[tableKey], id);
    }
    return this.store.remove(tableKey, id);
  }
}

module.exports = { BaseAdapter };
