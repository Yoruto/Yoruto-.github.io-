/**
 * NPC 投资机构（红杉/橡树/量子）v0.4
 */
import { mixUint32 } from './rng.js';
import { ymToMonthIndex } from './rng.js';
import { appendLog, roundWan } from './state.js';
import { calculateTotalAssetWan, ensureCompanyEquity } from './companyEquity.js';

export const NPC_INVESTORS = [
  {
    id: 'sequoia',
    name: '红杉资本',
    displayName: '红杉资本(VC)',
    type: 'vc',
    description: '专注早期高成长企业的风险投资',
    activeYears: [1990, 2020],
    triggerConditions: {
      minReputation: 60,
      minAssetWan: 500,
      maxPerYear: 2,
    },
    investmentParams: {
      minAmountWan: 50,
      maxAmountWan: 200,
      targetEquityRange: [0.1, 0.2],
      valuationDiscount: 0.7,
    },
  },
  {
    id: 'oaktree',
    name: '橡树资本',
    displayName: '橡树资本(PE)',
    type: 'pe',
    description: '专注成熟期企业的私募股权投资',
    activeYears: [1995, 2020],
    triggerConditions: {
      minReputation: 70,
      minAssetWan: 1000,
      maxPerYear: 1,
    },
    investmentParams: {
      minAmountWan: 100,
      maxAmountWan: 500,
      targetEquityRange: [0.2, 0.35],
      valuationDiscount: 0.8,
    },
  },
  {
    id: 'quantum',
    name: '量子对冲基金',
    displayName: '量子对冲基金',
    type: 'hedge',
    description: '高频交易驱动的对冲基金',
    activeYears: [2000, 2020],
    triggerConditions: {
      minReputation: 50,
      minAssetWan: 300,
      maxPerYear: 3,
    },
    investmentParams: {
      minAmountWan: 20,
      maxAmountWan: 100,
      targetEquityRange: [0.05, 0.15],
      valuationDiscount: 0.85,
    },
  },
];

function countNpcInvestmentsThisYear(state, npcId) {
  const y = state.year | 0;
  const ce = ensureCompanyEquity(state);
  const key = `npc_${npcId}_${y}`;
  return (ce._npcYearCounts && ce._npcYearCounts[key]) || 0;
}

function incNpcCount(state, npcId) {
  const ce = ensureCompanyEquity(state);
  if (!ce._npcYearCounts) ce._npcYearCounts = {};
  const y = state.year | 0;
  const key = `npc_${npcId}_${y}`;
  ce._npcYearCounts[key] = (ce._npcYearCounts[key] || 0) + 1;
}

function randomBetween(state, min, max) {
  const mi = ymToMonthIndex(state.year, state.month);
  const h = mixUint32(state.gameSeed >>> 0, [mi, 0x4e5043, 0x11, Math.floor(min * 100), Math.floor(max * 100)]);
  if (max <= min) return min;
  const span = max - min;
  return min + (h % (Math.floor(span * 100) + 1)) / 100;
}

/**
 * 月初尝试生成一条 NPC 投资意向（每月最多一次，未接受前不重复）
 */
export function tryNpcInvestment(state) {
  const ce = ensureCompanyEquity(state);
  if (ce.isListed) return null;
  if (state.pendingNpcInvestment) return null;

  const y = state.year | 0;
  const available = NPC_INVESTORS.filter((npc) => {
    if (y < npc.activeYears[0] || y > npc.activeYears[1]) return false;
    if ((state.reputation || 0) < npc.triggerConditions.minReputation) return false;
    if (calculateTotalAssetWan(state) < npc.triggerConditions.minAssetWan) return false;
    if (countNpcInvestmentsThisYear(state, npc.id) >= npc.triggerConditions.maxPerYear) return false;
    return true;
  });
  if (!available.length) return null;

  const h2 = mixUint32(state.gameSeed >>> 0, [ymToMonthIndex(state.year, state.month), 0x4e5043, 0x22]);
  const npc = available[h2 % available.length];
  const assetWan = calculateTotalAssetWan(state);
  const discount = npc.investmentParams.valuationDiscount;
  const baseValuation = roundWan(assetWan / discount);
  const minA = npc.investmentParams.minAmountWan;
  const maxA = Math.min(
    npc.investmentParams.maxAmountWan,
    roundWan(baseValuation * 0.3),
  );
  const investmentWan = roundWan(randomBetween(state, minA, maxA));
  const equityPercent = baseValuation > 1e-9 ? round2((investmentWan / baseValuation) * 100) : 0;

  const start = ymToMonthIndex(state.year, state.month);
  const lastValid = start + 2;
  const expY = Math.floor(lastValid / 12) + 1990;
  const expM = (lastValid % 12) + 1;

  const offer = {
    npcId: npc.id,
    npcName: npc.name,
    npcDisplayName: npc.displayName,
    npcType: npc.type,
    npcDescription: npc.description,
    investmentWan,
    equityPercent,
    valuationWan: baseValuation,
    expiresYear: expY,
    expiresMonth: expM,
    lastValidIndex: lastValid,
  };
  state.pendingNpcInvestment = offer;
  appendLog(state, `【NPC】${npc.displayName} 发出投资意向：约 ${investmentWan} 万，约 ${equityPercent}% 股份。`);
  return offer;
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

export function acceptNpcInvestment(state) {
  const offer = state.pendingNpcInvestment;
  if (!offer) return { ok: false, error: '无待处理意向' };
  const ce = ensureCompanyEquity(state);
  const shares = Math.max(0, Math.floor((ce.totalShares * offer.equityPercent) / 100));
  if (shares < 1) {
    state.pendingNpcInvestment = null;
    return { ok: false, error: '股份计算为0' };
  }
  ce.playerShares = Math.max(0, (ce.playerShares | 0) - shares);
  state.companyCashWan = roundWan((state.companyCashWan || 0) + offer.investmentWan);
  ce.investors.push({
    id: offer.npcId,
    name: offer.npcName,
    type: 'npc',
    shares,
    investedWan: offer.investmentWan,
    date: { year: state.year, month: state.month },
  });
  incNpcCount(state, offer.npcId);
  appendLog(
    state,
    `【NPC投资】${offer.npcName} 投资 ${offer.investmentWan} 万，获得约 ${offer.equityPercent}%（${shares} 股）`,
  );
  state.pendingNpcInvestment = null;
  return { ok: true };
}

export function rejectNpcInvestment(state) {
  state.pendingNpcInvestment = null;
  return { ok: true };
}

export function expireNpcIfNeeded(state) {
  const o = state.pendingNpcInvestment;
  if (!o) return;
  const cur = ymToMonthIndex(state.year, state.month);
  if (o.lastValidIndex != null && cur > o.lastValidIndex) {
    state.pendingNpcInvestment = null;
    appendLog(state, '【NPC】投资意向已过期。');
  }
}
