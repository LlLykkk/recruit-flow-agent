'use strict';

/**
 * 预置数据：3 个试点校档案 + 默认选项集。
 * 试点校档案写入《学校档案表》（mock 内存 / 真实多维表一致）。
 * 默认选项集供前端下拉使用，且前端支持运行时「＋新建选项」扩展。
 */

const PILOT_SCHOOLS = [
  {
    school_id: 'huizhou_dayawan',
    name: '惠州大亚湾外语实验学校',
    stages: '幼/小/初/高',
    nature: '民办',
    office_nature: '自建招办',
    profile_notes: '首年合作校，校情待沉淀；外语特色明显，生源以外来务工随迁子女为主。',
    knowledge: '',
  },
  {
    school_id: 'wenzhou_huizhong',
    name: '温州慧中公学',
    stages: '小/初',
    nature: '民办',
    office_nature: '集团派驻',
    profile_notes: '第二年合作校，校情较熟；初中部为重点生源段，家长对升学预期高。',
    knowledge: '话术库种子：家长开放日邀约话术、生源转介绍激励说明。',
  },
  {
    school_id: 'hengyang_boya',
    name: '衡阳博雅学校',
    stages: '小/初/高',
    nature: '民办',
    office_nature: '校方兼管',
    profile_notes: '第二年合作校；博雅品牌，注重素质培养与升学平衡，校方自有招办兼管。',
    knowledge: '',
  },
];

// 默认选项集（前端可运行时新建追加，本会话内共享）
const DEFAULT_OPTIONS = {
  schoolNature: ['民办', '公办', '合作办学', '集团直营'],
  officeNature: ['自建招办', '外包代理', '集团派驻', '校方兼管'],
  voucherType: ['活动照片', '触达名单', '家长反馈', '会议纪要'],
  difficulty: ['低', '中', '高'],
  stages: ['幼', '小', '初', '高'],
};

module.exports = { PILOT_SCHOOLS, DEFAULT_OPTIONS };
