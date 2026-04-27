/**
 * 宏观经济 v0.6：可复现月度指标、五条宏观线 base_bp → c、经济周期
 */
import { mixUint32, ymToMonthIndex, monthIndexToYm } from './rng.js';

let _cfgCache = null;
let _cfgLoadPromise = null;

/** 与 data/investment-sim/macro-config.json 保持一致的离线默认 */
export const DEFAULT_MACRO_CONFIG = {
  schemaVersion: 1,
  neutralBaseRatePercent: 6,
  lineIds: ['equity_composite', 'commodity_composite', 'real_estate', 'tech', 'overseas'],
  lineDisplayNames: {
    equity_composite: '股市综合',
    commodity_composite: '大宗商品',
    real_estate: '房地产',
    tech: '科技/互联网',
    overseas: '海外市场',
  },
  gdpGrowthBands: [
    { gMin: 8, gMax: 100, name: '过热', baseBp: { equity_composite: 1200, commodity_composite: 1500, real_estate: 800, tech: 1600, overseas: 1000 } },
    { gMin: 4, gMax: 8, name: '繁荣', baseBp: { equity_composite: 800, commodity_composite: 800, real_estate: 500, tech: 1000, overseas: 600 } },
    { gMin: 0, gMax: 4, name: '平稳', baseBp: { equity_composite: 200, commodity_composite: 0, real_estate: 200, tech: 300, overseas: 100 } },
    { gMin: -4, gMax: 0, name: '轻度衰退', baseBp: { equity_composite: -300, commodity_composite: -400, real_estate: -200, tech: -500, overseas: -300 } },
    { gMin: -100, gMax: -4, name: '深度衰退', baseBp: { equity_composite: -800, commodity_composite: -1000, real_estate: -600, tech: -1200, overseas: -800 } },
  ],
  rateEffectBpPer1Percent: {
    equity_composite: -100, commodity_composite: -50, real_estate: -200, tech: -50, overseas: 50,
  },
  sentimentEffectBpPer10Points: {
    equity_composite: 80, commodity_composite: 20, real_estate: 30, tech: 100, overseas: 50,
  },
  noiseBpHalfRange: 200,
  cyclePhaseDefinitions: {
    recovery: { label: '复苏', equityBpAdd: 200, sentimentMPerMonth: 2, realEstateBpAdd: 0 },
    boom: { label: '繁荣', equityBpAdd: 400, realEstateBpAdd: 200 },
    overheat: { label: '过热', equityBpAdd: 0, realEstateBpAdd: 0 },
    recession: { label: '衰退', equityBpAdd: -300, realEstateBpAdd: 0 },
    depression: { label: '萧条', equityBpAdd: -600, realEstateBpAdd: -400 },
    stagnation: { label: '温和', equityBpAdd: 0, realEstateBpAdd: 0 },
  },
  cycleMarkov: {
    phaseOrder: ['depression', 'recession', 'recovery', 'boom', 'overheat', 'stagnation'],
    baseTransitionProb: 0.12,
  },
  reStockBonusBpByC: { 0: 200, 1: 100, 2: 0, 3: -150, 4: -300 },
  baseRateByYear: {
    1990: 8.5, 1991: 8.0, 1992: 7.5, 1993: 7.0, 1994: 7.0, 1995: 6.5,
    1996: 6.0, 1997: 6.0, 1998: 6.5, 1999: 5.5, 2000: 5.0, 2001: 4.5, 2002: 4.0,
    2003: 3.5, 2004: 3.5, 2005: 4.0, 2006: 4.5, 2007: 5.0, 2008: 4.0, 2009: 3.0,
    2010: 3.0, 2011: 3.5, 2012: 3.5, 2013: 3.5, 2014: 3.5, 2015: 3.0, 2016: 2.5,
    2017: 2.5, 2018: 2.5, 2019: 2.0, 2020: 1.5,
  },
  industryIdToMacroLineId: {
    finance: 'equity_composite',
    realestate: 'real_estate',
    tech: 'tech',
    semiconductor: 'tech',
    consumer: 'equity_composite',
    medical: 'equity_composite',
    energy: 'commodity_composite',
    aerospace: 'equity_composite',
  },
};

export async function loadMacroConfig() {
  if (_cfgCache) return _cfgCache;
  if (_cfgLoadPromise) return _cfgLoadPromise;
  _cfgLoadPromise = (async () => {
    const paths = [
      '/data/investment-sim/macro-config.json',
      '../../../data/investment-sim/macro-config.json',
    ];
    for (const p of paths) {
      try {
        const r = await fetch(p);
        if (r.ok) {
          const j = await r.json();
          _cfgCache = { ...DEFAULT_MACRO_CONFIG, ...j };
          return _cfgCache;
        }
      } catch {
        /* */
      }
    }
    if (typeof process !== 'undefined' && process.versions?.node) {
      const { readFile } = await import('fs/promises');
      const { fileURLToPath } = await import('url');
      const { dirname, join } = await import('path');
      const here = dirname(fileURLToPath(import.meta.url));
      const j = JSON.parse(await readFile(join(here, '../../../data/investment-sim/macro-config.json'), 'utf8'));
      _cfgCache = { ...DEFAULT_MACRO_CONFIG, ...j };
      return _cfgCache;
    }
    _cfgCache = { ...DEFAULT_MACRO_CONFIG };
    return _cfgCache;
  })();
  return _cfgLoadPromise;
}

export function getMacroConfigSync() {
  return _cfgCache || { ...DEFAULT_MACRO_CONFIG, baseRateByYear: { ...DEFAULT_MACRO_CONFIG.baseRateByYear } };
}

export function setMacroConfigForTests(cfg) {
  _cfgCache = cfg;
}

/** base_bp → 附录 A 景气档 c */
export function baseBpToSentimentC(baseBp) {
  const v = Number(baseBp) || 0;
  if (v >= 600) return 0;
  if (v >= 200) return 1;
  if (v >= -199) return 2;
  if (v >= -600) return 3;
  return 4;
}

function u01FromH(h) {
  return (h >>> 0) / 2 ** 32;
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function roundToQuarter(x) {
  return Math.round(x * 4) / 4;
}

/**
 * 由 g、π 粗分类周期阶段（多条件互斥，按优先级）
 */
export function classifyCyclePhase(g, pi) {
  const g1 = Number(g) || 0;
  const p1 = Number(pi) || 0;
  if (g1 < -4) return 'depression';
  if (g1 >= 8 && p1 >= 6) return 'overheat';
  if (g1 >= 4 && p1 >= 3 && p1 <= 6) return 'boom';
  if (g1 >= 0 && g1 < 4 && p1 < 3) return 'recovery';
  if (g1 >= -4 && g1 < 0 && p1 < 2) return 'recession';
  if (g1 >= 4) return 'boom';
  if (g1 < 0) return 'recession';
  return 'stagnation';
}

/**
 * 可复现马尔可夫式「相邻阶段」微扰：有概率在 phaseOrder 上 ±1
 */
function nudgePhaseWithMarkov(phase, gameSeed, monthIndex, cfg) {
  const order = cfg.cycleMarkov?.phaseOrder || ['depression', 'recession', 'recovery', 'boom', 'overheat', 'stagnation'];
  const p0 = Math.max(0, Math.min(1, Number(cfg.cycleMarkov?.baseTransitionProb) || 0.12));
  const h0 = mixUint32(gameSeed >>> 0, [monthIndex, 0x4d4b2, 0x01]);
  if (u01FromH(h0) > p0) return phase;
  const idx = order.indexOf(phase);
  if (idx < 0) return phase;
  const h1 = mixUint32(gameSeed >>> 0, [monthIndex, 0x4d4b2, 0x02]);
  const dir = (h1 & 1) ? 1 : -1;
  const nidx = clamp(idx + dir, 0, order.length - 1);
  return order[nidx];
}

function baseRateForYear(y, cfg) {
  const yk = String(y | 0);
  const t = (cfg.baseRateByYear && cfg.baseRateByYear[yk]) != null ? cfg.baseRateByYear[yk] : 5;
  return Number(t);
}

/**
 * 生成 g, π, m, r（%）及月线数值，完全由 seed+monthIndex 决定
 */
function generateCoreIndicators(state, monthIndex, cfg) {
  const seed = state.gameSeed >>> 0;
  const hG = mixUint32(seed, [monthIndex, 0x6d2f, 0x01]);
  const hP = mixUint32(seed, [monthIndex, 0x6d2f, 0x02]);
  const hM = mixUint32(seed, [monthIndex, 0x6d2f, 0x03]);
  const hRj = mixUint32(seed, [monthIndex, 0x6d2f, 0x04]);

  const gdpGrowth = -10 + u01FromH(hG) * 25; // -10..+15
  const cpi = -2 + u01FromH(hP) * 17; // -2..15
  const sentiment = Math.floor(u01FromH(hM) * 101); // 0..100
  const { year, month } = state;
  const r0 = baseRateForYear(year, cfg);
  const jitter = (u01FromH(hRj) - 0.5) * 0.5;
  const baseRate = roundToQuarter(clamp(r0 + jitter, 1, 15));
  return { gdpGrowth, cpi, sentiment, baseRate };
}

function gdpBandBaseBp(g, cfg) {
  const g1 = Number(g) || 0;
  const bands = cfg.gdpGrowthBands || DEFAULT_MACRO_CONFIG.gdpGrowthBands;
  for (const b of bands) {
    if (g1 >= b.gMin && g1 < b.gMax) {
      return { ...b.baseBp };
    }
  }
  const last = bands[bands.length - 1];
  return { ...last.baseBp };
}

function lineNoise(lineId, gameSeed, monthIndex, cfg) {
  const a = (lineId.charCodeAt(0) || 0) + (lineId.charCodeAt(lineId.length - 1) || 0);
  const h = mixUint32(gameSeed >>> 0, [monthIndex, lineId.length, a, 0x4e2f, 0x4e0a]);
  const r = (cfg.noiseBpHalfRange ?? 200) | 0;
  return (h % (2 * r + 1)) - r;
}

/**
 * 计算五线 base_bp 与 c
 */
export function computeMacroLinesFromCore(state, core, rawPhase, cfg) {
  const { gdpGrowth, cpi, sentiment, baseRate } = core;
  const neutral = Number(cfg.neutralBaseRatePercent) || 6;
  const dRate = baseRate - neutral;
  const lineIds = cfg.lineIds || DEFAULT_MACRO_CONFIG.lineIds;
  const baseFromG = gdpBandBaseBp(gdpGrowth, cfg);
  const rateE = cfg.rateEffectBpPer1Percent || DEFAULT_MACRO_CONFIG.rateEffectBpPer1Percent;
  const sentE = cfg.sentimentEffectBpPer10Points || DEFAULT_MACRO_CONFIG.sentimentEffectBpPer10Points;
  const phDef = cfg.cyclePhaseDefinitions?.[rawPhase] || {};
  const eqAdd = phDef?.equityBpAdd ?? 0;
  const reAdd = phDef?.realEstateBpAdd ?? 0;

  const nudged = nudgePhaseWithMarkov(rawPhase, state.gameSeed, ymToMonthIndex(state.year, state.month), cfg);
  const phaseForExtras = nudged;
  const phDef2 = cfg.cyclePhaseDefinitions?.[phaseForExtras] || phDef;
  const eqAdd2 = phDef2?.equityBpAdd ?? eqAdd;
  const reAdd2 = phDef2?.realEstateBpAdd ?? reAdd;

  const lines = {};
  for (const lineId of lineIds) {
    const gbp = baseFromG[lineId] ?? 0;
    const rateAdj = dRate * (rateE[lineId] ?? 0);
    const sentAdj = (sentiment / 10) * (sentE[lineId] ?? 0);
    let lineExtra = 0;
    if (lineId === 'equity_composite') lineExtra += eqAdd2;
    if (lineId === 'real_estate') lineExtra += reAdd2;
    const n = lineNoise(lineId, state.gameSeed, ymToMonthIndex(state.year, state.month), cfg);
    const baseBp = Math.round(gbp + rateAdj + sentAdj + lineExtra + n);
    const c = baseBpToSentimentC(baseBp);
    lines[lineId] = { lineId, baseBp, c, displayName: (cfg.lineDisplayNames && cfg.lineDisplayNames[lineId]) || lineId };
  }
  return { lines, effectivePhase: phaseForExtras, nudgedFrom: rawPhase };
}

/**
 * 写入 state.macro（当月），并保存 previous 环比
 */
export function applyMonthlyMacroState(state) {
  const cfg = getMacroConfigSync();
  if (!state) return;
  const monthIndex = ymToMonthIndex(state.year, state.month);
  if (state.macro && state.macro.monthIndex === monthIndex) {
    return; // 已生成本月
  }

  const earlier = state.macro;
  const prevForReport = earlier
    ? {
        baseRate: earlier.baseRate,
        cpi: earlier.cpi,
        gdpGrowth: earlier.gdpGrowth,
        sentiment: earlier.sentiment,
        lines: earlier.lines ? JSON.parse(JSON.stringify(earlier.lines)) : null,
        cyclePhase: earlier.cyclePhase,
      }
    : null;
  const prevPhase = earlier?.cyclePhase;

  const core = generateCoreIndicators(state, monthIndex, cfg);
  const rawPhase = classifyCyclePhase(core.gdpGrowth, core.cpi);
  let sentiment = core.sentiment;
  if (rawPhase === 'recovery') {
    const boost = Number(cfg.cyclePhaseDefinitions?.recovery?.sentimentMPerMonth) || 2;
    sentiment = Math.min(100, sentiment + boost);
  }
  const core2 = { ...core, sentiment };
  const { lines, effectivePhase } = computeMacroLinesFromCore(state, core2, rawPhase, cfg);

  const samePhase = prevPhase === effectivePhase;
  if (!state.macro) state.macro = {};
  state.macro.monthIndex = monthIndex;
  state.macro.year = state.year;
  state.macro.month = state.month;
  state.macro.baseRate = roundToQuarter(core2.baseRate);
  state.macro.cpi = core2.cpi;
  state.macro.gdpGrowth = core2.gdpGrowth;
  state.macro.sentiment = core2.sentiment;
  state.macro.cyclePhase = effectivePhase;
  state.macro.cyclePhaseLabel = (cfg.cyclePhaseDefinitions?.[effectivePhase]?.label) || effectivePhase;
  state.macro.monthsInPhase = samePhase && earlier?.monthsInPhase != null ? (earlier.monthsInPhase + 1) : 1;
  state.macro.lines = lines;
  state.macro.previous = prevForReport;

  const eq = lines.equity_composite;
  const co = lines.commodity_composite;
  if (eq) state._macroEquityCFromModel = eq.c;
  if (co) state._macroCommodityCFromModel = co.c;
}

/**
 * 大事件应用前的「模型」c（0..4）
 */
export function getModelSentimentCForLine(state, lineKey) {
  const lid = lineKey === 'equity' ? 'equity_composite' : lineKey === 'commodity' ? 'commodity_composite' : lineKey;
  const L = state.macro?.lines?.[lid];
  return L != null && L.c != null ? (L.c | 0) : 2;
}

/**
 * 下月预测 c（与结算不同种子，与 rollPredictedC 一致思路）
 */
export function predictNextMonthCForLine(state, lineId) {
  const cfg = getMacroConfigSync();
  const mi = ymToMonthIndex(state.year, state.month) + 1;
  const seed = state.gameSeed >>> 0;
  const ymd = monthIndexToYm(mi);
  const st = { gameSeed: seed, year: ymd.year, month: ymd.month };
  const core = generateCoreIndicators(st, mi, cfg);
  const hPhase = mixUint32(seed, [mi, 0x5052, (lineId && lineId.length) || 0, 0x20]);
  const gJ = core.gdpGrowth + (u01FromH(hPhase) - 0.5) * 0.2;
  const pJ = core.cpi + (u01FromH(mixUint32(seed, [mi, 0x5053])) - 0.5) * 0.1;
  const raw = classifyCyclePhase(gJ, pJ);
  const { lines } = computeMacroLinesFromCore(
    st,
    { ...core, gdpGrowth: gJ, cpi: pJ, sentiment: core.sentiment, baseRate: core.baseRate },
    raw,
    cfg,
  );
  return (lines[lineId] && lines[lineId].c) != null ? (lines[lineId].c | 0) : 2;
}

export function getMacroLineIdByIndustry(industryId, cfg = getMacroConfigSync()) {
  const m = cfg.industryIdToMacroLineId || DEFAULT_MACRO_CONFIG.industryIdToMacroLineId;
  return m[industryId] || 'equity_composite';
}

/**
 * 业务组/实体用：行业 c → 景气系数 1.2 / 1.1 / 1.0 / 0.9 / 0.8
 */
export function sentimentCToMacroFactor(c) {
  const t = [1.2, 1.1, 1.0, 0.9, 0.8];
  return t[Math.max(0, Math.min(4, c | 0))] ?? 1;
}

/**
 * 利率对实业乘子
 */
export function interestRateToBusinessFactor(rPercent) {
  const r = Number(rPercent) || 0;
  if (r < 4) return 0.1;
  if (r > 8) return -0.15;
  return 0;
}

/**
 * 地产 RE 线 c 对月租金收益率的附加（与 settlement 中表述一致，万分比加总时外部乘）
 */
export function realEstateLineRentBonusBp(cRe) {
  const c0 = cRe | 0;
  const map = { 0: 120, 1: 60, 2: 0, 3: -80, 4: -150 };
  return map[Math.max(0, Math.min(4, c0))] ?? 0;
}
