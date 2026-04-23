import {
  B_STOCK_BP_BY_C,
  G_STOCK_EXPECT_ADD_BP,
  NOISE_BP,
} from './tables.js';
import { businessNoiseH, noiseBpFromH, mixUint32 } from './rng.js';
import { roundWan } from './state.js';

/**
 * @typedef {object} SettlementInput
 * @property {'stock'|'fut'} kind
 * @property {number} cMacro 宏观景气 0..4（股票用股市线，期货用大宗线）
 * @property {number} ability 1..10
 * @property {number} allocWan 调拨本金（万元）
 * @property {number} monthIndex
 * @property {number} orderIndexInMonth 当月第几笔新开单 0..
 * @property {number} gameSeed
 * @property {number} year 当前年份（用于判断股票成长期/成熟期）
 * @property {number} [stockGuideMode] 0..2，使用指导时
 * @property {boolean} [usedGuidance]
 * @property {string|null} [stockId]
 * @property {number} [betaExtraBp] 个券叠加（单券，兼容）
 * @property {number|null} [portfolioBetaBp] 组合加权 betaExtra（万分比加总）
 * @property {number} [portfolioSectorBp] 组合加权行业beta（万分比加总）
 * @property {number[]} [futBpByC] 期货品种 B_fut 按 c 的万分比行（长度 5）
 * @property {number} [leverage] 1|2|3，期货；未指导时强制 1
 * @property {number} [stockSleeveWeightBp] 0..10000 股票侧总敞口（轻仓时如 2000=20%；默认 10000）
 * @property {{id:string, matureYear:number, matureBetaExtraBp:number}[]} [stocksList] 股票列表（用于判断成长期/成熟期）
 * @property {{stockId:string, weightBp:number}[]} [stockPortfolio] 股票组合持仓
 */

function clampAbility(a) {
  return Math.max(1, Math.min(10, a | 0));
}

/**
 * 能力对净利：盈利放大 1+能力%，亏损按 1-能力% 减轻（在表驱动 P 之后作用）。
 * @param {number} profitWan
 * @param {number} ability
 */
export function applyAbilityToProfitWan(profitWan, ability) {
  const a = clampAbility(ability);
  const k = a * 0.01;
  if (profitWan > 0) return roundWan(profitWan * (1 + k));
  if (profitWan < 0) return roundWan(profitWan * (1 - k));
  return profitWan;
}

/** 判断股票当前是否处于成长期（当前年份 < matureYear） */
export function isStockInGrowthPhase(stock, currentYear) {
  return currentYear < (stock?.matureYear ?? 2100);
}

/**
 * 获取股票当前的 betaExtraBp（万分比）
 * 成长期：使用可复现随机生成 [-1000, +1000]（即 -10%~+10%）
 * 成熟期：使用配置的 matureBetaExtraBp（通常在 [-300, +300] 即 -3%~+3% 范围内）
 */
export function getStockBetaExtraBp(stock, currentYear, gameSeed, monthIndex) {
  if (!stock) return 0;
  const isGrowth = isStockInGrowthPhase(stock, currentYear);
  if (isGrowth) {
    // 成长期：高波动 [-1000, +1000]，使用可复现随机
    const h = mixUint32(gameSeed >>> 0, [monthIndex, stock.id.charCodeAt(0), stock.id.charCodeAt(stock.id.length - 1), 0x47524f57]);
    // 生成 -1000 到 +1000 的随机值
    const randomBp = (h % 2001) - 1000; // 0..2000 -> -1000..1000
    return randomBp;
  }
  // 成熟期：使用配置的低波动值
  return stock.matureBetaExtraBp ?? 0;
}

/** 判断股票当前是否派息（仅成熟期派息） */
export function doesStockPayDividend(stock, currentYear) {
  if (!stock) return false;
  return !isStockInGrowthPhase(stock, currentYear);
}

/** 组合权重 weightBp 之和须为 10000；返回加权 betaExtra（万分比） */
export function computePortfolioBetaExtraBp(portfolio, stocksList, currentYear, gameSeed, monthIndex) {
  if (!portfolio || !portfolio.length || !stocksList?.length) return 0;
  let sum = 0;
  for (const leg of portfolio) {
    const st = stocksList.find((s) => s.id === leg.stockId);
    const w = leg.weightBp | 0;
    const beta = getStockBetaExtraBp(st, currentYear, gameSeed, monthIndex);
    sum += w * beta;
  }
  return Math.round(sum / 10000);
}

/** 计算组合的行业因子加权平均值（万分比） */
export function computePortfolioSectorBp(portfolio, stocksList, sectorsList) {
  if (!portfolio || !portfolio.length || !stocksList?.length) return 0;
  let sum = 0;
  for (const leg of portfolio) {
    const st = stocksList.find((s) => s.id === leg.stockId);
    if (!st) continue;
    const sec = sectorsList?.find((s) => s.id === st.sectorId);
    const w = leg.weightBp | 0;
    sum += w * (sec?.sectorBetaBp ?? 0);
  }
  return Math.round(sum / 10000);
}

/**
 * 计算收益率 P（万分比，即 % × 100）—— 不含能力乘数；能力在 settleMonthlyOrder 中作用于净利。
 * 股票：大环境因子 + 行业因子 + 个股因子 + 指导 + 噪声
 * 期货：大环境因子 + 噪声，再乘以杠杆
 */
export function computeReturnBp(input) {
  const H = businessNoiseH(input.gameSeed, input.monthIndex, input.orderIndexInMonth, input.kind);
  const noiseBp = noiseBpFromH(H, NOISE_BP);

  if (input.kind === 'stock') {
    const c = Math.max(0, Math.min(4, input.cMacro | 0));
    // 1. 大环境因子
    const macroBp = B_STOCK_BP_BY_C[c];
    // 2. 行业因子
    const sectorBp = input.portfolioSectorBp ?? 0;
    // 3. 个股因子（传入的 portfolioBetaBp 已包含成长股/成熟股的处理）
    const stockBp = input.portfolioBetaBp ?? (input.betaExtraBp ?? 0);
    // 4. 指导风格因子
    const mode = Math.max(0, Math.min(2, input.stockGuideMode ?? 1));
    const guideBp = G_STOCK_EXPECT_ADD_BP[mode];

    // 总收益 = 大环境 + 行业 + 个股 + 指导 + 噪声；轻仓时整段 P 按股票侧敞口比例缩放
    let P = (macroBp + sectorBp + stockBp + guideBp + noiseBp) | 0;
    const sleeve = Math.max(0, Math.min(10000, input.stockSleeveWeightBp ?? 10000));
    if (sleeve < 10000) {
      P = Math.round((P * sleeve) / 10000) | 0;
    }
    return P;
  }

  const c = Math.max(0, Math.min(4, input.cMacro | 0));
  const row = input.futBpByC;
  const B = row && row.length === 5 ? row[c] | 0 : 0;
  const P0 = B + noiseBp;
  const L = Math.max(1, Math.min(3, input.leverage | 0));
  return (P0 * L) | 0;
}

/** 净利（万）：P 为万分比，结果四舍五入到 0.0001 万 */
export function profitWanFromP(allocWan, P) {
  return roundWan((Number(allocWan) * Number(P)) / 10000);
}

export function settleMonthlyOrder(input) {
  const P0 = computeReturnBp(input);
  let profitWan = profitWanFromP(input.allocWan, P0);
  profitWan = applyAbilityToProfitWan(profitWan, input.ability);
  const allocN = Number(input.allocWan);
  const P = allocN > 1e-9 ? Math.round((profitWan / allocN) * 10000) : P0;
  const success = profitWan > 0;
  return { P, profitWan, success };
}
