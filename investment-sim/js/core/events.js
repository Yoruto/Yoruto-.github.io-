/**
 * 大事件日程（演示）与小事件池（声誉分池占位，可扩展）。
 */

import { mixUint32, majorEventTriggerH, ymToMonthIndex } from './rng.js';
import { roundWan } from './state.js';

/** 随机大事件：首月 5%，当月未触发则下月概率 +5%（上限 100%），触发后重置为 5% */
const RANDOM_MAJOR_BASE_P = 5;
const RANDOM_MAJOR_P_STEP = 5;

/**
 * 随机大事件池（可重复抽取）；c ∈ 0..4 与 rollMacroC 一致；数值越低，该线越偏景气温和/有利基线。
 * @type {{ id:string, title:string, equityC:number, commodityC:number, repDelta:number, months:number }[]}
 */
const RANDOM_MAJOR_POOL = [
  {
    id: 'randRegPolicy',
    title: '监管新政（证券/期货）：不确定性升温',
    equityC: 4,
    commodityC: 3,
    repDelta: -2,
    months: 4,
  },
  {
    id: 'randRateCut',
    title: '境内降息周期预期',
    equityC: 1,
    commodityC: 2,
    repDelta: 2,
    months: 5,
  },
  {
    id: 'randCommoditySuper',
    title: '大宗商品「超级周期」传闻',
    equityC: 2,
    commodityC: 0,
    repDelta: 1,
    months: 6,
  },
  {
    id: 'randGeoOil',
    title: '地缘冲突外溢，油价与风险资产波动',
    equityC: 3,
    commodityC: 1,
    repDelta: -2,
    months: 4,
  },
  {
    id: 'randSectorStorm',
    title: '行业政策整顿风暴（全市场情绪受挫）',
    equityC: 4,
    commodityC: 2,
    repDelta: -3,
    months: 3,
  },
];

/** @type {{ year:number, month:number, id:string, title:string, equityC?:number, commodityC?:number, repDelta?:number, months:number }[]} */
export const MAJOR_SCHEDULE = [
  {
    year: 1997,
    month: 7,
    id: 'asia97',
    title: '亚洲金融风波（演示）：股市景气承压',
    equityC: 4,
    commodityC: 3,
    repDelta: -5,
    months: 2,
  },
  {
    year: 2008,
    month: 9,
    id: 'crisis08',
    title: '全球金融危机（演示）',
    equityC: 4,
    commodityC: 4,
    repDelta: -8,
    months: 3,
  },
];

function tryPushRandomMajorEvents(state) {
  const monthIndex = ymToMonthIndex(state.year, state.month);
  if (typeof state.randomMajorP !== 'number' || !Number.isFinite(state.randomMajorP)) {
    state.randomMajorP = RANDOM_MAJOR_BASE_P;
  }
  const p = Math.min(100, Math.max(0, state.randomMajorP));
  const h = majorEventTriggerH(state.gameSeed, monthIndex, 0x524d01);
  if ((h % 100) >= p) {
    state.randomMajorP = Math.min(100, p + RANDOM_MAJOR_P_STEP);
    return;
  }

  state.randomMajorP = RANDOM_MAJOR_BASE_P;

  const hPick = majorEventTriggerH(state.gameSeed, monthIndex, 0x524d02);
  const ev = RANDOM_MAJOR_POOL[(hPick >>> 8) % RANDOM_MAJOR_POOL.length];
  state.majorEffectStack.push({
    id: ev.id,
    title: ev.title,
    equityC: ev.equityC,
    commodityC: ev.commodityC,
    repDelta: ev.repDelta ?? 0,
    monthsLeft: ev.months,
  });
  if (ev.repDelta) {
    state.reputation = Math.max(0, Math.min(100, state.reputation + ev.repDelta));
  }
  appendMajorNote(state, `【大事件·随机】${ev.title}（持续 ${ev.months} 个月）`);
}

export function pushDueMajorEvents(state) {
  state.majorEventNote = '';
  const { year, month } = state;
  if (!Array.isArray(state.majorFiredKeys)) state.majorFiredKeys = [];
  for (const ev of MAJOR_SCHEDULE) {
    if (ev.year === year && ev.month === month) {
      const key = `${ev.id}-${ev.year}-${ev.month}`;
      if (state.majorFiredKeys.includes(key)) continue;
      state.majorFiredKeys.push(key);
      state.majorEffectStack.push({
        id: ev.id,
        title: ev.title,
        equityC: ev.equityC,
        commodityC: ev.commodityC,
        repDelta: ev.repDelta ?? 0,
        monthsLeft: ev.months,
      });
      if (ev.repDelta) {
        state.reputation = Math.max(0, Math.min(100, state.reputation + ev.repDelta));
      }
      appendMajorNote(state, `【大事件】${ev.title}（持续 ${ev.months} 个月）`);
    }
  }
  tryPushRandomMajorEvents(state);
}

function appendMajorNote(state, text) {
  state.majorEventNote = state.majorEventNote ? `${state.majorEventNote}\n${text}` : text;
}

/** 应用栈顶叠加：若有活跃大效应，覆盖当月宏观 c（演示：取栈中最后一项） */
export function applyMajorStackToC(state, baseEquity, baseCommodity) {
  let eq = baseEquity;
  let com = baseCommodity;
  if (state.majorEffectStack.length > 0) {
    const top = state.majorEffectStack[state.majorEffectStack.length - 1];
    if (top.equityC != null) eq = top.equityC;
    if (top.commodityC != null) com = top.commodityC;
  }
  return { equityC: eq, commodityC: com };
}

export function tickMajorStack(state) {
  for (const e of state.majorEffectStack) {
    e.monthsLeft -= 1;
  }
  state.majorEffectStack = state.majorEffectStack.filter((e) => e.monthsLeft > 0);
}

/** 高声誉池 */
const MINOR_HIGH = [
  { id: 'h1', text: '媒体报道正面，声誉小幅提升。', rep: 2, cash: 0 },
  { id: 'h2', text: '客户推荐带来小额咨询收入。', rep: 1, cash: 3 },
  { id: 'h3', text: '行业协会邀请演讲（无现金影响）。', rep: 3, cash: 0 },
];

/** 低声誉池 */
const MINOR_LOW = [
  { id: 'l1', text: '负面舆论发酵，声誉承压。', rep: -3, cash: 0 },
  { id: 'l2', text: '小额索赔与和解支出。', rep: -1, cash: -5 },
  { id: 'l3', text: '员工士气受扰（无现金影响）。', rep: -2, cash: 0 },
];

/** 中性 */
const MINOR_NEUTRAL = [
  { id: 'n1', text: '平淡一月，无特别新闻。', rep: 0, cash: 0 },
  { id: 'n2', text: '办公室小事一桩，略耗行政精力。', rep: 0, cash: -0.5 },
];

/**
 * 每月最多 1 次小事件；大事件月仍允许（PRD 默认允许）。
 * @param {boolean} allowMinorThisMonth
 */
export function rollMinorEvent(state, monthIndex, allowMinorThisMonth) {
  state.minorEventNote = '';
  if (!allowMinorThisMonth) return;

  const h = mixUint32(state.gameSeed, [monthIndex, 0x4d4e52, 0x01]);
  const trigger = (h % 100) < 35;
  if (!trigger) {
    state.minorEventNote = '【小事件】本月无事。';
    return;
  }

  const poolPick = (h >>> 8) % 100;
  let pool = MINOR_NEUTRAL;
  if (state.reputation >= 60) pool = MINOR_HIGH;
  else if (state.reputation <= 40) pool = MINOR_LOW;
  else if (poolPick < 40) pool = MINOR_HIGH;
  else if (poolPick < 80) pool = MINOR_LOW;

  const ev = pool[(h >>> 16) % pool.length];
  state.reputation = Math.max(0, Math.min(100, state.reputation + ev.rep));
  state.companyCashWan = roundWan(state.companyCashWan + ev.cash);
  state.minorEventNote = `【小事件】${ev.text}${ev.cash ? `（现金 ${ev.cash >= 0 ? '+' : ''}${ev.cash} 万）` : ''}`;
}
