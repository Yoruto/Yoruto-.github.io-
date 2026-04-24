import { mixUint32, ymToMonthIndex } from './rng.js';
import {
  nextId,
  recruitCostForTier,
  recruitTierAllowed,
  getTotalCapacity,
  appendLog,
  roundWan,
} from './state.js';
import { AI_STYLES } from './employeeAI.js';

const STYLE_IDS = [AI_STYLES.momentum.id, AI_STYLES.trend.id, AI_STYLES.dividend.id];

const FIRST_NAMES = ['陈', '林', '王', '张', '刘', '杨', '赵', '黄', '周', '吴', '徐', '孙'];
const GIVEN = ['伟', '芳', '娜', '强', '敏', '静', '磊', '军', '洋', '勇', '艳', '杰', '丽', '涛', '明'];

/**
 * 刷新人才库：3~5 人，可复现
 */
export function refreshTalentPool(state, refreshIndex) {
  const mi = ymToMonthIndex(state.year, state.month);
  const idx = refreshIndex | 0;
  const h0 = mixUint32(state.gameSeed, [mi, idx, 0x54414c, 0x00]);
  const n = 3 + (h0 % 3);
  const pool = [];
  for (let i = 0; i < n; i++) {
    const h = mixUint32(state.gameSeed, [mi, idx, i, 0x5450]);
    const h2 = h >>> 8;
    const h3 = h >>> 16;
    const fn = FIRST_NAMES[h % FIRST_NAMES.length];
    const gn = GIVEN[(h2 >>> 0) % GIVEN.length];
    const name = `${fn}${gn}`;

    const canSenior = state.year >= 2006;
    const canMid = state.year >= 1996;
    let rawTier;
    if (canSenior) rawTier = h2 % 3;
    else if (canMid) rawTier = h2 % 2;
    else rawTier = 0;
    const tier = rawTier === 0 ? 'junior' : rawTier === 1 ? 'mid' : 'senior';

    const ability = 1 + (h3 % 10);
    const loyalty = 1 + ((h2 >>> 4) % 10);
    const styleId = STYLE_IDS[((h >>> 4) + i) % STYLE_IDS.length];

    pool.push({
      id: `t${h.toString(36)}i${i}`,
      name: name.length > 8 ? name.slice(0, 8) : name,
      tier,
      ability: Math.max(1, Math.min(10, ability)),
      loyalty: Math.max(1, Math.min(10, loyalty)),
      aiStyle: styleId,
    });
  }
  state.talentPool = pool;
  return { ok: true, count: n };
}

export const TALENT_REFRESH_COST_WAN = 2;

/**
 * 支付刷新费并刷新
 */
export function runRefreshTalentPool(state) {
  const cost = TALENT_REFRESH_COST_WAN;
  if (state.companyCashWan + 1e-9 < cost) {
    return { ok: false, error: '现金不足' };
  }
  state.companyCashWan = roundWan(state.companyCashWan - cost);
  const nextIdx = (state.talentPoolRefreshIndex | 0) + 1;
  state.talentPoolRefreshIndex = nextIdx;
  refreshTalentPool(state, nextIdx);
  appendLog(state, `【人才库】支付 ${cost} 万刷新，当前 ${(state.talentPool || []).length} 人。`);
  return { ok: true };
}

/**
 * 从人才库招聘
 */
export function runHireFromTalent(state, talentId) {
  const t = (state.talentPool || []).find((x) => x.id === talentId);
  if (!t) return { ok: false, error: '人才不存在' };
  if (!recruitTierAllowed(state.year, t.tier)) {
    return { ok: false, error: '该职级此年代不可招聘' };
  }
  const cap = getTotalCapacity(state);
  if (state.employees.length >= cap) {
    return { ok: false, error: '容量已满' };
  }
  const cost = recruitCostForTier(t.tier);
  if (state.companyCashWan + 1e-9 < cost) {
    return { ok: false, error: '现金不足' };
  }

  state.companyCashWan = roundWan(state.companyCashWan - cost);
  // 迁移/生成 v0.3 员工结构（将旧 ability 拆分为三维并初始化行业技术）
  const baseAbility = t.ability || 5;
  const leadership = Math.max(1, Math.min(10, Math.floor(baseAbility / 3) + 2));
  const innovation = Math.max(1, Math.min(10, Math.floor(baseAbility / 3) + 1));
  const execution = Math.max(1, Math.min(10, Math.floor(baseAbility / 3) + 1));
  const industryTech = {
    finance: Math.floor(Math.random() * 10) + 5,
    realestate: Math.floor(Math.random() * 10) + 5,
    tech: Math.floor(Math.random() * 10) + 5,
    semiconductor: Math.floor(Math.random() * 10) + 5,
    consumer: Math.floor(Math.random() * 10) + 5,
    medical: Math.floor(Math.random() * 10) + 5,
    energy: Math.floor(Math.random() * 10) + 5,
    aerospace: Math.floor(Math.random() * 10) + 5,
  };
  const emp = {
    id: nextId(state, 'e'),
    name: t.name,
    tier: t.tier,
    ability: t.ability,
    leadership,
    innovation,
    execution,
    industryTech,
    loyalty: t.loyalty,
    experienceMonths: 0,
    hiredYearMonth: { year: state.year, month: state.month },
    hiredThisMonth: true,
    trainingScheduled: false,
    idleStreakMonths: 0,
    aiStyle: t.aiStyle,
    lastRebalanceMonth: null,
  };
  state.employees.push(emp);
  state.talentPool = (state.talentPool || []).filter((x) => x.id !== talentId);
  const stLabel = AI_STYLES[t.aiStyle]?.name || t.aiStyle;
  appendLog(
    state,
    `【招聘·人才库】${t.name}（${t.tier}，${stLabel}）能力${t.ability} 忠诚${t.loyalty}，费用 ${cost} 万。`,
  );
  return { ok: true, employeeId: emp.id };
}
