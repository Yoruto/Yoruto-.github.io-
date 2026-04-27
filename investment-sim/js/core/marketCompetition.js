/**
 * 行业市场竞争 v0.6：规模、NPC 波动、份额守恒、业务组扩张与营收
 */
import { mixUint32, ymToMonthIndex } from './rng.js';
import { roundWan } from './state.js';
import { getMacroLineIdByIndustry, getMacroConfigSync, sentimentCToMacroFactor } from './macro.js';

function simpleStrHash(s) {
  let h = 2166136261;
  const t = String(s || '');
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

let _mktCfg = null;
let _loadPromise = null;

export const DEFAULT_MARKET_CONFIG = {
  schemaVersion: 1,
  industryIds: ['finance', 'realestate', 'tech', 'semiconductor', 'consumer', 'medical', 'energy', 'aerospace'],
  industries: {},
  globalParams: {
    maxNpcSharePerIndustry: 0.45,
    otherMinShare: 0.05,
    monthlyNpcVolatility: 0.04,
    maxNpcDeltaAbs: 0.03,
    playerNationalShareCap: 0.2,
    expandPointsPer10Wan: 1,
    expandConvertThresholdBase: 20,
  },
};

export async function loadMarketConfig() {
  if (_mktCfg) return _mktCfg;
  if (_loadPromise) return _loadPromise;
  _loadPromise = (async () => {
    const paths = ['/data/investment-sim/market-config.json', '../../../data/investment-sim/market-config.json'];
    for (const p of paths) {
      try {
        const r = await fetch(p);
        if (r.ok) {
          _mktCfg = await r.json();
          return _mktCfg;
        }
      } catch {
        /* */
      }
    }
    if (typeof process !== 'undefined' && process.versions?.node) {
      try {
        const { readFile } = await import('fs/promises');
        const { fileURLToPath } = await import('url');
        const { dirname, join } = await import('path');
        const here = dirname(fileURLToPath(import.meta.url));
        _mktCfg = JSON.parse(await readFile(join(here, '../../../data/investment-sim/market-config.json'), 'utf8'));
        return _mktCfg;
      } catch {
        /* fallthrough */
      }
    }
    _mktCfg = { ...DEFAULT_MARKET_CONFIG, industries: {} };
    return _mktCfg;
  })();
  return _loadPromise;
}

export function getMarketConfigSync() {
  return _mktCfg || null;
}

export function setMarketConfigForTests(cfg) {
  _mktCfg = cfg;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

/** 由配置创建 state.market 骨架 */
export function createEmptyMarketStateFromConfig(cfg) {
  const gp = cfg.globalParams || DEFAULT_MARKET_CONFIG.globalParams;
  const industries = {};
  for (const id of cfg.industryIds || Object.keys(cfg.industries || {})) {
    const row = cfg.industries[id] || cfg.industries?.[id];
    if (!row) continue;
    const npcs = { ...(row.initialNpcShares || {}) };
    let s = (row.initialPlayerShare || 0) + Object.values(npcs).reduce((a, b) => a + b, 0);
    let other = row.otherShare != null ? row.otherShare : 1 - s;
    if (other < (gp.otherMinShare || 0.05)) {
      const need = (gp.otherMinShare || 0.05) - other;
      const npcKeys = Object.keys(npcs);
      if (npcKeys.length) {
        const per = need / npcKeys.length;
        for (const k of npcKeys) npcs[k] = Math.max(0, npcs[k] - per);
      }
      other = 1 - (row.initialPlayerShare || 0) - Object.values(npcs).reduce((a, b) => a + b, 0);
    }
    industries[id] = {
      totalMarketSizeWan: row.totalMarketSizeWan || 1,
      playerShares: {},
      playerShareTotal: row.initialPlayerShare || 0,
      npcs,
      otherShare: clamp01(other),
      growthRateBaseYearly: row.growthRateBaseYearly || 0.04,
      variableCostRatio: row.variableCostRatio ?? 0.55,
      fixedCostWanMonthly: row.fixedCostWanMonthly ?? 60,
      lastGrowthYearMonth: null,
    };
  }
  return {
    schemaVersion: cfg.schemaVersion || 1,
    industries,
    regions: cfg.realEstate?.regions || {},
    lastUpdateMonthIndex: -1,
  };
}

export function ensureMarketState(state) {
  const cfg = getMarketConfigSync();
  if (!state) return;
  if (state.market && state.market.industries && Object.keys(state.market.industries).length) {
    return;
  }
  if (!cfg) return;
  state.market = createEmptyMarketStateFromConfig(cfg);
}

/** 从业务组同步各行业玩家总份额（多组同产业额加总，文档：players 为业务组 id） */
export function syncPlayerSharesFromGroups(state, groups) {
  ensureMarketState(state);
  if (!state.market || !Array.isArray(groups)) return;
  const cfg = getMarketConfigSync();
  if (!cfg) return;
  const byInd = Object.create(null);
  for (const g of groups) {
    const ind = g?.industry;
    if (!ind) continue;
    byInd[ind] = (byInd[ind] || 0) + (g?.metrics?.marketShare || 0);
  }
  for (const id of Object.keys(state.market.industries || {})) {
    const row = state.market.industries[id];
    row.playerShareTotal = clamp01(byInd[id] != null ? byInd[id] : row.playerShareTotal || 0);
  }
}

/**
 * 宏观加成的月度市场规模增长
 */
function applyMarketSizeGrowth(state, industryId, row) {
  const m = state.macro;
  const g = m?.gdpGrowth != null ? Number(m.gdpGrowth) : 0;
  const lineId = getMacroLineIdByIndustry(industryId, getMacroConfigSync());
  const c = m?.lines?.[lineId]?.c ?? 2;
  const macroFac = sentimentCToMacroFactor(c);
  const macroBonus = ((g - 2) * 0.5) / 100 + (macroFac - 1) * 0.3;
  const yearly = (row.growthRateBaseYearly || 0.04) * (1 + macroBonus);
  const monthly = yearly / 12;
  row.totalMarketSizeWan = (row.totalMarketSizeWan || 0) * (1 + monthly);
}

/**
 * NPC 波动 + 份额约束
 */
function tickNpcForIndustry(state, industryId, row) {
  const cfg = getMarketConfigSync();
  if (!cfg) return;
  const gp = cfg.globalParams || {};
  const maxNpc = gp.maxNpcSharePerIndustry != null ? gp.maxNpcSharePerIndustry : 0.45;
  const oMin = gp.otherMinShare != null ? gp.otherMinShare : 0.05;
  const vol = gp.monthlyNpcVolatility != null ? gp.monthlyNpcVolatility : 0.04;
  const maxD = gp.maxNpcDeltaAbs != null ? gp.maxNpcDeltaAbs : 0.03;
  const mi = ymToMonthIndex(state.year, state.month);
  const seed = state.gameSeed >>> 0;
  for (const npcId of Object.keys(row.npcs || {})) {
    const h = mixUint32(seed, [mi, 0x4e50, simpleStrHash(industryId), simpleStrHash(npcId)]);
    const u = (h % 20001) / 20000 - 0.5;
    const delta = u * 2 * vol;
    const d = Math.max(-maxD, Math.min(maxD, delta));
    row.npcs[npcId] = clamp01((row.npcs[npcId] || 0) * (1 + d));
  }
  let sumNpc = Object.values(row.npcs || {}).reduce((a, b) => a + b, 0);
  if (sumNpc > maxNpc) {
    const s = maxNpc / sumNpc;
    for (const k of Object.keys(row.npcs)) row.npcs[k] *= s;
    sumNpc = maxNpc;
  }
  const p = clamp01(row.playerShareTotal || 0);
  let other = 1 - p - sumNpc;
  if (other < oMin) {
    const need = oMin - other;
    const keys = Object.keys(row.npcs);
    if (keys.length) {
      const take = need / keys.length;
      for (const k of keys) row.npcs[k] = Math.max(0, (row.npcs[k] || 0) - take);
    }
    sumNpc = Object.values(row.npcs).reduce((a, b) => a + b, 0);
    other = 1 - p - sumNpc;
  }
  row.otherShare = clamp01(other);
  row.playerShareTotal = p;
}

/**
 * 业务组：扩张点每达阈值时从 other 转份额（每行业每月最多 1 次，文档 v0.6.4）
 */
export function tryConvertExpandPointsForAllGroups(state, groups, mcfg) {
  ensureMarketState(state);
  if (!Array.isArray(groups) || !state.market) return;
  const cfg = mcfg || getMarketConfigSync();
  if (!cfg) return;
  const gp = cfg.globalParams || {};
  const ptsPer = gp.expandPointsPer10Wan != null ? gp.expandPointsPer10Wan : 1;
  const baseT = gp.expandConvertThresholdBase != null ? gp.expandConvertThresholdBase : 20;
  const mi = ymToMonthIndex(state.year, state.month);

  for (const g of groups) {
    if (!g || g.stage === 'failed') continue;
    const ind = g.industry;
    if (!ind) continue;
    const row = state.market.industries[ind];
    if (!row) continue;
    g.expandPoints = Number(g.expandPoints) || 0;
    if ((g.lastExpandConvertMonthIndex | 0) === mi) continue;

    const pshare = g.metrics?.marketShare || 0;
    const threshold = baseT * (1 + pshare * 10);
    if (g.expandPoints < threshold) continue;
    if ((row.otherShare || 0) < 0.001) continue;

    const take = Math.min(0.005, row.otherShare * 0.1);
    row.otherShare = clamp01((row.otherShare || 0) - take);
    g.metrics = g.metrics || {};
    g.metrics.marketShare = clamp01((g.metrics.marketShare || 0) + take);
    g.expandPoints = Math.max(0, g.expandPoints - threshold);
    g.lastExpandConvertMonthIndex = mi;
  }
}

/**
 * 行业级营收/成本/净利（v0.6.4 写入业务组）
 */
export function applyIndustryFinancialsToGroups(state, groups, opts = {}) {
  if (!state?.market || !Array.isArray(groups)) return;
  const empSalary = Number(opts.employeeSalaryWan) || 5;
  for (const g of groups) {
    if (!g) continue;
    const ind = g.industry;
    const row = state.market?.industries?.[ind];
    if (!row) continue;
    const size = row.totalMarketSizeWan || 0;
    const p = g.metrics?.marketShare || 0;
    const lineId = getMacroLineIdByIndustry(ind, getMacroConfigSync());
    const c = state.macro?.lines?.[lineId]?.c ?? 2;
    const macroF = sentimentCToMacroFactor(c);
    const r0 = state.macro?.baseRate;
    const rateAdj = r0 == null || !Number.isFinite(r0) ? 0 : r0 < 4 ? 0.1 : r0 > 8 ? -0.15 : 0;
    const macroFactor = Math.max(0.2, macroF + rateAdj);
    const productM = 1 + (g.metrics?.productLevel || 0) * 0.05 + (g.metrics?.patentValueWan || 0) / Math.max(1, size);
    const rev = size * p * productM * macroFactor;
    const vc = rev * (row.variableCostRatio ?? 0.55);
    const fc = row.fixedCostWanMonthly || 60;
    const teamN = (g.teamIds && g.teamIds.length) || 0;
    const teamCost = teamN * empSalary;
    const net = rev - vc - fc - teamCost;
    const patentMult = c >= 3 ? 0.8 : 1;
    g.revenueWan = Math.round(rev);
    g.variableCostWan = Math.round(vc);
    g.fixedCostWan = Math.round(fc);
    g.netProfitWan = Math.round(net);
    g.fundingWan = roundWan((g.fundingWan || 0) + g.netProfitWan);
    g.metrics = g.metrics || {};
    g.metrics.monthlyRevenueWan = g.revenueWan;
    g.metrics.ttmRevenueWan = (g.metrics.ttmRevenueWan || 0) * (11 / 12) + g.revenueWan / 12;
    const mult = (opts.revenueMultiplier || 6);
    g.metrics.valuationWan = Math.round(mult * (g.metrics.ttmRevenueWan || 0) + (g.metrics.patentValueWan || 0) * patentMult);
    if (!Array.isArray(g.financialHistory)) g.financialHistory = [];
    g.financialHistory.push({
      year: state.year,
      month: state.month,
      revenueWan: g.revenueWan,
      netProfitWan: g.netProfitWan,
    });
    if (g.financialHistory.length > 36) g.financialHistory.shift();
  }
}

/**
 * 月结后调用：更新市场规模、NPC、扩张转化、财务
 * @param {object} state
 * @param {object[]|null} [businessGroups] main.js 业务组列表
 */
export function tickMarketCompetition(state, businessGroups) {
  ensureMarketState(state);
  if (!state.market) return;
  const mi = ymToMonthIndex(state.year, state.month);
  if (state.market.lastUpdateMonthIndex === mi) return;

  for (const id of Object.keys(state.market.industries || {})) {
    const row = state.market.industries[id];
    applyMarketSizeGrowth(state, id, row);
    tickNpcForIndustry(state, id, row);
  }

  if (Array.isArray(businessGroups) && businessGroups.length) {
    syncPlayerSharesFromGroups(state, businessGroups);
    tryConvertExpandPointsForAllGroups(state, businessGroups, getMarketConfigSync());
    syncPlayerSharesFromGroups(state, businessGroups);
    applyIndustryFinancialsToGroups(state, businessGroups, { employeeSalaryWan: 5, revenueMultiplier: 6 });
  }
  state.market.lastUpdateMonthIndex = mi;
}

/**
 * 份额守恒检查（调试用）
 */
export function assertShareConservation(state) {
  const out = [];
  if (!state?.market?.industries) return { ok: true, issues: out };
  for (const [id, row] of Object.entries(state.market.industries)) {
    const sumNpc = Object.values(row.npcs || {}).reduce((a, b) => a + b, 0);
    const t = (row.playerShareTotal || 0) + sumNpc + (row.otherShare || 0);
    if (Math.abs(t - 1) > 0.02) out.push({ id, total: t });
  }
  return { ok: out.length === 0, issues: out };
}
