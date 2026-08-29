'use strict';

/**
 * 内存存储：mock 模式下的 Base 四表 + 飞书消息/卡片记录。
 * 结构与真实多维表一致，便于 real 模式无缝切换。
 */
const { SCHEMA } = require('../data/schema');

class MemoryStore {
  constructor() {
    /** @type {Record<string, Array<object>>} */
    this.tables = {
      action: [],
      task: [],
      voucher: [],
      school: [],
    };
    /** @type {Array<object>} 飞书消息发送记录 */
    this.messages = [];
    /** @type {Array<object>} 飞书卡片（含交互）记录 */
    this.cards = [];
    this._seq = 0;
  }

  _id(prefix) {
    this._seq += 1;
    return `${prefix}_${Date.now().toString(36)}_${this._seq}`;
  }

  // ---- Base 四表 CRUD ----
  list(tableKey) {
    this._ensure(tableKey);
    return this.tables[tableKey].slice();
  }

  get(tableKey, id) {
    this._ensure(tableKey);
    return this.tables[tableKey].find((r) => r[`${tableKey}_id`] === id) || null;
  }

  insert(tableKey, record) {
    this._ensure(tableKey);
    const idKey = `${tableKey}_id`;
    if (!record[idKey]) record[idKey] = this._id(tableKey.slice(0, 3));
    this.tables[tableKey].push(record);
    return record;
  }

  update(tableKey, id, patch) {
    this._ensure(tableKey);
    const row = this.tables[tableKey].find((r) => r[`${tableKey}_id`] === id);
    if (!row) return null;
    Object.assign(row, patch);
    return row;
  }

  remove(tableKey, id) {
    this._ensure(tableKey);
    const i = this.tables[tableKey].findIndex((r) => r[`${tableKey}_id`] === id);
    if (i === -1) return false;
    this.tables[tableKey].splice(i, 1);
    return true;
  }

  _ensure(tableKey) {
    if (!this.tables[tableKey]) throw new Error(`未知表: ${tableKey}`);
  }

  // ---- 飞书消息/卡片 ----
  pushMessage(target, text) {
    const m = { id: this._id('msg'), target, text, at: new Date().toISOString() };
    this.messages.push(m);
    return m;
  }

  pushCard(target, card) {
    const c = { id: this._id('card'), target, card, at: new Date().toISOString() };
    this.cards.push(c);
    return c;
  }

  /** 预置 MVP 试点校档案（温州慧中公学），便于 demo 直接跑 */
  seedSchool(school) {
    const existing = this.tables.school.find((s) => s.school_id === school.school_id);
    if (!existing) this.insert('school', school);
  }
}

module.exports = { MemoryStore, SCHEMA };
