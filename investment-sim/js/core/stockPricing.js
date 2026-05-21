/**
 * 个股月度收益（万分比）与复权累计、大盘综指月涨跌（与 UI/月结复利用途一致）
 */
import { B_STOCK_BP_BY_C, NOISE_BP } from './tables.js';
import {
  getStockBetaExtraBp,
  computeCycleBonusBp,
  computeRateEffectBp,
  computeLineSensitivityBp,
} from './settlement.js';
import { getMacroConfigSync } from './macro.js';
import { businessNoiseH, noiseBpFromH, ymToMonthIndex } from './rng.js';
import { listedStocksForMonth } from './employeeAI.js';

function compareYm(yy, mm, y, m) {
  if (yy !== y) return yy - y;
  return mm - m;
}

export function listingOk(listingYm, year, month) {
  if (!listingYm) return true;
  const [y0, m0] = listingYm.split('-').map(Number);
  return compareYm(y0, m0, year, month) <= 0;
}

function computeVolatilityMultiplier(sentiment) {
  const m = Number(sentiment) || 50;
  if (m > 85 || m < 15) return 1.4;
  if (m > 70 || m < 30) return 1.2;
  return 1.0;
}

/**
 * 与主界面 getStockFactors 同源的月度总收益（万分比）及分解项
 */
export function getStockFactorParts(state, config, stock, cMacro, orderIndex = 0) {
  const sec = config.sectors?.find((x) => x.id === stock.sectorId);
  const mcfg = getMacroConfigSync();
  const macro = state?.macro;
  const lines = macro?.lines || {};
  const phase = macro?.cyclePhase;
  const sentiment = macro?.sentiment ?? 50;
  const baseRate = macro?.baseRate ?? 6;
  const monthIndex = ymToMonthIndex(state.year, state.month);

  const c = Math.max(0, Math.min(4, cMacro | 0));
  const macroFactor = B_STOCK_BP_BY_C[c] || 0;
  const sectorFactor = sec?.sectorBetaBp || 0;
  const stockFactor = getStockBetaExtraBp(stock, state.year, state.gameSeed, monthIndex);

  let macroExtraBp = 0;
  let cycleBp = 0;
  let rateBp = 0;
  let lineBp = 0;
  if (sec) {
    cycleBp = computeCycleBonusBp(sec, phase, mcfg);
    rateBp = computeRateEffectBp(sec, baseRate, mcfg?.neutralBaseRatePercent ?? 6);
    lineBp = computeLineSensitivityBp(sec, lines, mcfg);
    macroExtraBp = cycleBp + rateBp + lineBp + (stock.macroBetaBp || 0);
  }

  const H = businessNoiseH(state.gameSeed, monthIndex, orderIndex, 'stock');
  const volMult = computeVolatilityMultiplier(sentiment);
  const baseNoise = noiseBpFromH(H, NOISE_BP);
  const noiseFactor = Math.round(baseNoise * 3.2 * volMult);

  const totalReturnBp = macroFactor + sectorFactor + stockFactor + macroExtraBp + noiseFactor;
  return {
    macroFactor,
    sectorFactor,
    stockFactor,
    macroExtraBp,
    noiseFactor,
    cycleBp,
    rateBp,
    lineBp,
    stockMacroBp: stock.macroBetaBp || 0,
    isMature: state.year >= (stock.matureYear || 2100),
    totalReturnBp,
  };
}

/** 上月末止的复权乘数（不含本月）；无记录视为 1 */
export function getStockSpotMultPrior(state, stockId) {
  const v = state.stockSpotMult?.[stockId];
  return v != null && Number.isFinite(v) ? v : 1;
}

/**
 * 本月展示价 = basePrice × 上月末复权乘数 × (1 + 本月总收益)
 */
export function computeSpotDisplayPrice(state, config, stock, cMacro, orderIndex = 0) {
  const base = Number(stock.basePrice) || 100;
  const mult = getStockSpotMultPrior(state, stock.id);
  const bp = getStockFactorParts(state, config, stock, cMacro, orderIndex).totalReturnBp;
  return base * mult * (1 + bp / 10000);
}

function stockIndexMarketCap(stock, priceNum) {
  const p = Number(priceNum);
  const scale = Math.max(1e-9, Number(stock.basePrice) || 100);
  if (!Number.isFinite(p)) return 0;
  return p * scale;
}

function listedNonPlayerStocksInReturnOrder(cfg, year, month) {
  return listedStocksForMonth(cfg.stocks || [], year, month)
    .filter((s) => !s.isPlayerCompany)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function stockReturnOrderIndexById(cfg, year, month) {
  const m = new Map();
  listedNonPlayerStocksInReturnOrder(cfg, year, month).forEach((s, i) => {
    m.set(s.id, i);
  });
  return m;
}

export function rebalanceAnnualBroadIndexWeights(state, cfg, cMacro) {
  const universe = listedNonPlayerStocksInReturnOrder(cfg, state.year, 1);
  const weights = Object.create(null);
  if (!universe.length) {
    state.broadIndexWeights = { forYear: state.year, weights: {} };
    return;
  }
  const rows = universe.map((s, i) => {
    const price = computeSpotDisplayPrice(state, cfg, s, cMacro, i);
    return { s, cap: stockIndexMarketCap(s, price) };
  });
  const totalCap = rows.reduce((a, r) => a + r.cap, 0);
  if (totalCap <= 0) {
    const eq = 1 / rows.length;
    rows.forEach((r) => {
      weights[r.s.id] = eq;
    });
  } else {
    rows.forEach((r) => {
      weights[r.s.id] = r.cap / totalCap;
    });
  }
  state.broadIndexWeights = { forYear: state.year, weights: weights };
}

export function ensureAnnualBroadIndexWeights(state, cfg, cMacro) {
  if (state.broadIndexWeights?.forYear === state.year) return;
  rebalanceAnnualBroadIndexWeights(state, cfg, cMacro);
}

/** 大盘综指本月涨跌幅（百分比数值，如 1.25 表示 +1.25%），与个股展示/月结使用同一收益槽位 */
export function computeBroadIndexMonthlyReturnPct(state, cfg, cMacro) {
  ensureAnnualBroadIndexWeights(state, cfg, cMacro);
  const wObj = state.broadIndexWeights?.weights || {};
  const ids = Object.keys(wObj).filter((id) => (Number(wObj[id]) || 0) > 0);
  if (!ids.length) return 0;
  const orderIndexById = stockReturnOrderIndexById(cfg, state.year, state.month);
  let idxRet = 0;
  for (const id of ids) {
    const w = Number(wObj[id]) || 0;
    const stk = (cfg.stocks || []).find((x) => x.id === id);
    if (!stk) continue;
    const orderIndex = orderIndexById.get(id);
    if (orderIndex == null) continue;
    const bp = getStockFactorParts(state, cfg, stk, cMacro, orderIndex).totalReturnBp;
    idxRet += w * (bp / 100);
  }
  return idxRet;
}

export function computeBroadMarketIndexReturnForUI(state, cfg, cMacro) {
  const pct = computeBroadIndexMonthlyReturnPct(state, cfg, cMacro);
  const wObj = state.broadIndexWeights?.weights || {};
  const ids = Object.keys(wObj).filter((id) => (Number(wObj[id]) || 0) > 0);
  const weightsById = new Map();
  for (const id of ids) {
    weightsById.set(id, Number(wObj[id]) || 0);
  }
  return {
    indexReturnPct: pct.toFixed(2),
    weightsById,
    indexCount: ids.length,
  };
}

/**
 * 月结后调用：把本月收益乘入复权因子；并把大盘点位乘入 (1+综指本月涨跌)
 * 此时 state.year/month 仍为「刚结清」的月份
 */
export function applyStockSpotAndIndexAccumulators(state, config) {
  if (!state.stockSpotMult) state.stockSpotMult = Object.create(null);
  const stocks = listedNonPlayerStocksInReturnOrder(config, state.year, state.month);
  for (let oi = 0; oi < stocks.length; oi++) {
    const stock = stocks[oi];
    const bp = getStockFactorParts(state, config, stock, state.actualEquityC, oi).totalReturnBp;
    const prev = state.stockSpotMult[stock.id];
    state.stockSpotMult[stock.id] = (prev != null ? prev : 1) * (1 + bp / 10000);
  }

  if (state.broadIndexLevel == null || !Number.isFinite(state.broadIndexLevel)) {
    state.broadIndexLevel = 2000;
  }
  const idxPct = computeBroadIndexMonthlyReturnPct(state, config, state.actualEquityC);
  state.broadIndexLevel *= (1 + idxPct / 100);
}
