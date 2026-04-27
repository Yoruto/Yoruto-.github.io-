import {
  B_STOCK_BP_BY_C,
  A_BP_BY_ABILITY,
  NOISE_BP,
} from './tables.js';
import { businessNoiseH, noiseBpFromH, mixUint32 } from './rng.js';
import { roundWan } from './state.js';
import { getMacroConfigSync } from './macro.js';

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
 * @property {string|null} [stockId]
 * @property {number} [betaExtraBp] 个券叠加（单券，兼容）
 * @property {number|null} [portfolioBetaBp] 组合加权 betaExtra（万分比加总）
 * @property {number} [portfolioSectorBp] 组合加权行业beta（万分比加总）
 * @property {number[]} [futBpByC] 期货品种 B_fut 按 c 的万分比行（长度 5）
 * @property {number} [leverage] 1|2|3，期货
 * @property {number} [stockSleeveWeightBp] 0..10000 股票侧总敞口（轻仓时如 2000=20%；默认 10000）
 * @property {number} [futMacroLinkageBp] v0.6：期货宏观联动附加（杠杆前）
 * @property {{id:string, matureYear:number, matureBetaExtraBp:number}[]} [stocksList] 股票列表（用于判断成长期/成熟期）
 * @property {{stockId:string, weightBp:number}[]} [stockPortfolio] 股票组合持仓
 * @property {object} [state] 游戏状态（用于获取完整宏观数据）
 * @property {object} [config] 股票/期货配置（sectors, stocks等）
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
 * 成长期：使用可复现随机生成 [-2500, +2500]（即 -25%~+25%，高波动）
 * 成熟期：使用配置的 matureBetaExtraBp（通常在 [-800, +800] 即 -8%~+8% 范围内）
 */
export function getStockBetaExtraBp(stock, currentYear, gameSeed, monthIndex) {
  if (!stock) return 0;
  const isGrowth = isStockInGrowthPhase(stock, currentYear);
  if (isGrowth) {
    // 成长期：高波动 [-2500, +2500]，使用可复现随机
    const h = mixUint32(gameSeed >>> 0, [monthIndex, stock.id.charCodeAt(0), stock.id.charCodeAt(stock.id.length - 1), 0x47524f57]);
    // 生成 -2500 到 +2500 的随机值
    const randomBp = (h % 5001) - 2500; // 0..5000 -> -2500..+2500
    return randomBp;
  }
  // 成熟期：使用配置的低波动值（建议配置范围±800）
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
 * 计算情绪驱动的波动率调整系数
 * 情绪>80（狂热）或<20（恐慌）时波动放大
 */
function computeVolatilityMultiplier(sentiment) {
  const m = Number(sentiment) || 50;
  // 极端情绪放大波动
  if (m > 85 || m < 15) return 1.4;
  if (m > 70 || m < 30) return 1.2;
  return 1.0;
}

/**
 * 计算周期阶段对板块的加成（考虑防御板块逆周期特性）
 */
export function computeCycleBonusBp(sector, phase, mcfg) {
  if (!sector || !phase) return 0;
  const cycleBonus = sector.cycleBonusBpByPhase || {};
  const bonus = cycleBonus[phase] ?? 0;
  // 防御板块（公用事业）在衰退/萧条期有额外保护
  if (sector.defensive && (phase === 'recession' || phase === 'depression')) {
    return Math.abs(bonus) * 0.5; // 转为正向保护
  }
  return bonus;
}

/**
 * 计算利率对板块的影响
 */
export function computeRateEffectBp(sector, baseRate, neutralRate = 6) {
  if (!sector) return 0;
  const dRate = (Number(baseRate) || 6) - neutralRate;
  const sens = sector.rateSensitivityBpPer1Pct ?? -50;
  return Math.round(dRate * sens);
}

/**
 * 计算板块对特定宏观线的敏感度加成
 */
export function computeLineSensitivityBp(sector, lines, mcfg) {
  if (!sector || !lines) return 0;
  const sens = sector.lineSensitivityBp || {};
  let sum = 0;
  for (const [lineId, bpPerC] of Object.entries(sens)) {
    const c = lines[lineId]?.c ?? 2;
    // c从0-4，中心点是2，偏离中心点时产生正负加成
    const deviation = 2 - c; // c=0(繁荣)→+2, c=4(冰点)→-2
    sum += deviation * (bpPerC / 2);
  }
  return Math.round(sum);
}

/**
 * 计算收益率 P（万分比，即 % × 100）—— 不含能力乘数；能力在 settleMonthlyOrder 中作用于净利。
 * 股票：大环境因子 + 行业因子 + 个股因子 + 周期加成 + 利率影响 + 板块宏观联动 + 情绪调整噪声
 * 期货：大环境因子 + 噪声，再乘以杠杆
 */
export function computeReturnBp(input) {
  const state = input.state;
  const config = input.config;
  const H = businessNoiseH(input.gameSeed, input.monthIndex, input.orderIndexInMonth, input.kind);
  
  // 获取宏观数据
  const mcfg = getMacroConfigSync();
  const macro = state?.macro;
  const lines = macro?.lines || {};
  const phase = macro?.cyclePhase;
  const sentiment = macro?.sentiment ?? 50;
  const baseRate = macro?.baseRate ?? 6;

  if (input.kind === 'stock') {
    const c = Math.max(0, Math.min(4, input.cMacro | 0));
    
    // 1. 大环境因子（股市综合线）
    const macroBp = B_STOCK_BP_BY_C[c];
    
    // 2. 行业因子（固定beta）
    const sectorBp = input.portfolioSectorBp ?? 0;
    
    // 3. 个股因子（传入的 portfolioBetaBp 已包含成长股/成熟股的处理）
    const stockBp = input.portfolioBetaBp ?? (input.betaExtraBp ?? 0);
    
    // 4. 计算组合层面的宏观联动加成
    let macroExtraBp = 0;
    const port = input.stockPortfolio;
    if (port?.length && config?.stocks && config?.sectors) {
      for (const leg of port) {
        const st = config.stocks.find((s) => s.id === leg.stockId);
        if (!st) continue;
        const sec = config.sectors.find((s) => s.id === st.sectorId);
        if (!sec) continue;
        const w = (leg.weightBp | 0) / 10000;
        
        // a) 周期阶段加成
        const cycleBp = computeCycleBonusBp(sec, phase, mcfg);
        // b) 利率影响
        const rateBp = computeRateEffectBp(sec, baseRate, mcfg.neutralBaseRatePercent ?? 6);
        // c) 板块对特定宏观线的敏感度
        const lineBp = computeLineSensitivityBp(sec, lines, mcfg);
        // d) 个股macroBetaBp（如果配置）
        const stockMacroBp = st.macroBetaBp || 0;
        
        macroExtraBp += w * (cycleBp + rateBp + lineBp + stockMacroBp);
      }
      macroExtraBp = Math.round(macroExtraBp);
    }
    
    // 5. 情绪调整后的噪声（噪声表范围±250，放大3.2倍到±800，即±8%）
    const volMult = computeVolatilityMultiplier(sentiment);
    const baseNoise = noiseBpFromH(H, NOISE_BP);
    const noiseBp = Math.round(baseNoise * 3.2 * volMult);
    
    // 总收益 = 大环境 + 行业 + 个股 + 宏观联动 + 情绪调整噪声；轻仓时整段 P 按股票侧敞口比例缩放
    let P = (macroBp + sectorBp + stockBp + macroExtraBp + noiseBp) | 0;
    const sleeve = Math.max(0, Math.min(10000, input.stockSleeveWeightBp ?? 10000));
    if (sleeve < 10000) {
      P = Math.round((P * sleeve) / 10000) | 0;
    }
    return P;
  }

  // 期货计算（噪声同步放大）
  const c = Math.max(0, Math.min(4, input.cMacro | 0));
  const row = input.futBpByC;
  const B = row && row.length === 5 ? row[c] | 0 : 0;
  const link = input.futMacroLinkageBp | 0;
  const futNoise = Math.round(noiseBpFromH(H, NOISE_BP) * 3.2);
  const P0 = B + futNoise + link;
  const L = Math.max(1, Math.min(3, input.leverage | 0));
  return (P0 * L) | 0;
}

/**
 * 股票组合：地产线 c 对 re 板块、与个股 macroBetaBp（万分比加总算至组合层）
 */
export function computeStockMacroExtraBp(state, config, order) {
  if (!state?.macro?.lines || order.kind !== 'stock') return 0;
  const reC = state.macro.lines.real_estate?.c ?? 2;
  const mcfg = getMacroConfigSync();
  const reByC = mcfg.reStockBonusBpByC || { 0: 200, 1: 100, 2: 0, 3: -150, 4: -300 };
  const reExtra = reByC[String(reC)] ?? reByC[reC] ?? 0;
  const port = order.stockPortfolio;
  if (!port || !port.length || !config?.stocks) return 0;
  let sum = 0;
  for (const leg of port) {
    const st = config.stocks.find((s) => s.id === leg.stockId);
    if (!st) continue;
    const w = (leg.weightBp | 0) / 10000;
    const sectorS = (config.sectors || []).find((s) => s.id === st.sectorId);
    const sBeta = (sectorS?.macroSectorBetaBp != null ? sectorS.macroSectorBetaBp : sectorS?.macroBetaBp) || 0;
    let legExtra = w * sBeta;
    if (st.sectorId === 're') legExtra += w * reExtra;
    legExtra += w * (st.macroBetaBp | 0);
    sum += legExtra;
  }
  return Math.round(sum) | 0;
}

/**
 * 期货品种宏观联动（bp，加在 B_fut+noise 之后、乘杠杆前）
 */
export function computeFuturesMacroLinkageBp(futuresVariantId, variant, state) {
  if (!state?.macro) return 0;
  const r = Number(state.macro.baseRate);
  const pi = Number(state.macro.cpi);
  const realRate = r - pi;
  const lines = state.macro.lines || {};
  const cComm = lines.commodity_composite?.c ?? 2;
  const cTech = lines.tech?.c ?? 2;
  const cOver = lines.overseas?.c ?? 2;
  if (!variant) return 0;
  const sens = variant.macroSensitivity || {};
  let bp = 0;
  if (futuresVariantId === 'gold' && realRate < 0) {
    bp += sens.goldNegativeRealRateBp != null ? sens.goldNegativeRealRateBp : 200;
  }
  if (futuresVariantId === 'silver') {
    bp += Math.round((cComm * 2 - cTech) * 15);
  }
  if (futuresVariantId === 'copper' || futuresVariantId === 'metal') {
    const cRe = lines.real_estate?.c ?? 2;
    bp += (4 - cRe) * 25;
  }
  if (futuresVariantId === 'energy' && cOver <= 1) {
    bp += 80;
  }
  return Math.round(bp) | 0;
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

/**
 * 计算咨询服务（市场分析报告）收益，单位：万
 * 公式（基于设计文档）：
 * 基础 30k，领导力每点 +3k，行业技术每点 +0.1k。上限 230k。
 * 将千元单位转换为万元：除以 10。
 */
export function calculateConsultingRevenue(employee, industry) {
  const techLevel = (employee.industryTech && employee.industryTech[industry]) || 0;
  const baseThousand = 30; // 30k
  const leadershipThousand = (employee.leadership || 0) * 3; // per point 3k
  const techThousand = techLevel * 0.1; // per point 0.1k
  let totalThousand = baseThousand + leadershipThousand + techThousand;
  if (totalThousand > 230) totalThousand = 230;
  // 转换为万元并四舍五入到 0.0001 万
  const totalWan = roundWan(totalThousand / 10);
  return totalWan;
}
