import {
  B_STOCK_BP_BY_C,
  A_BP_BY_ABILITY,
  G_STOCK_EXPECT_ADD_BP,
  NOISE_BP,
} from './tables.js';
import { businessNoiseH, noiseBpFromH } from './rng.js';

/**
 * @typedef {object} SettlementInput
 * @property {'stock'|'fut'} kind
 * @property {number} cMacro 宏观景气 0..4（股票用股市线，期货用大宗线）
 * @property {number} ability 1..10
 * @property {number} allocWan 调拨本金（万元）
 * @property {number} monthIndex
 * @property {number} orderIndexInMonth 当月第几笔新开单 0..
 * @property {number} gameSeed
 * @property {number} [stockGuideMode] 0..2，使用指导时
 * @property {boolean} [usedGuidance]
 * @property {string|null} [stockId]
 * @property {number} [betaExtraBp] 个券叠加（单券，兼容）
 * @property {number|null} [portfolioBetaBp] 组合加权 betaExtra（万分比加总）
 * @property {number} [portfolioSectorBp] 组合加权行业beta（万分比加总）
 * @property {number[]} [futBpByC] 期货品种 B_fut 按 c 的万分比行（长度 5）
 * @property {number} [leverage] 1|2|3，期货；未指导时强制 1
 */

function clampAbility(a) {
  return Math.max(1, Math.min(10, a | 0));
}

/** 组合权重 weightBp 之和须为 10000；返回加权 betaExtra（万分比） */
export function computePortfolioBetaExtraBp(portfolio, stocksList) {
  if (!portfolio || !portfolio.length || !stocksList?.length) return 0;
  let sum = 0;
  for (const leg of portfolio) {
    const st = stocksList.find((s) => s.id === leg.stockId);
    const w = leg.weightBp | 0;
    sum += w * (st?.betaExtraBp ?? 0);
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
 * 计算收益率 P（万分比，即 % × 100）
 * 股票：大环境因子 + 行业因子 + 个股因子 + 能力 + 指导 + 噪声
 * 期货：大环境因子 + 能力 + 噪声，再乘以杠杆
 */
export function computeReturnBp(input) {
  const a = clampAbility(input.ability);
  const aBp = A_BP_BY_ABILITY[a - 1];
  const H = businessNoiseH(input.gameSeed, input.monthIndex, input.orderIndexInMonth, input.kind);
  const noiseBp = noiseBpFromH(H, NOISE_BP);

  if (input.kind === 'stock') {
    const c = Math.max(0, Math.min(4, input.cMacro | 0));
    // 1. 大环境因子
    const macroBp = B_STOCK_BP_BY_C[c];
    // 2. 行业因子
    const sectorBp = input.portfolioSectorBp ?? 0;
    // 3. 个股因子
    const stockBp = input.portfolioBetaBp ?? (input.betaExtraBp ?? 0);
    // 4. 能力因子
    // 5. 指导风格因子
    const mode = Math.max(0, Math.min(2, input.stockGuideMode ?? 1));
    const guideBp = G_STOCK_EXPECT_ADD_BP[mode];
    
    // 总收益 = 大环境 + 行业 + 个股 + 能力 + 指导 + 噪声
    let P = macroBp + sectorBp + stockBp + aBp + guideBp + noiseBp;
    return P | 0;
  }

  // 期货计算保持不变
  const c = Math.max(0, Math.min(4, input.cMacro | 0));
  const row = input.futBpByC;
  const B = row && row.length === 5 ? row[c] | 0 : 0;
  let P0 = B + aBp + noiseBp;
  const L = Math.max(1, Math.min(3, input.leverage | 0));
  return (P0 * L) | 0;
}

/** profit_wan = round(alloc_wan * P / 10000) — alloc 可用整数或一位小数，与文档一致用四舍五入 */
export function profitWanFromP(allocWan, P) {
  const x = allocWan * P;
  return Math.round(x / 10000);
}

export function settleMonthlyOrder(input) {
  const P = computeReturnBp(input);
  const profit = profitWanFromP(input.allocWan, P);
  const success = profit > 0;
  return { P, profitWan: profit, success };
}
