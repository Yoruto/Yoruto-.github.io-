/**
 * 公司股份、上市、增发、自交易、年报 (v0.4)
 */
import { appendLog, nextId, roundWan } from './state.js';
import { ymToMonthIndex } from './rng.js';

const PLAYER_STOCK_ID = 'STK0021';

export function calculateTotalAssetWan(state) {
  let total = Number(state.companyCashWan) || 0;
  if (Array.isArray(state.activeBusinesses)) {
    for (const b of state.activeBusinesses) {
      total += Number(b.aumWan || 0);
    }
  }
  return roundWan(total);
}

export function getCompanyValuationWan(state) {
  return roundWan(calculateTotalAssetWan(state) * 1.2);
}

export function createDefaultCompanyEquity() {
  return {
    companyName: '新锐投资',
    totalShares: 1_000_000,
    playerShares: 1_000_000,
    sharePriceWan: 0.0001,
    isListed: false,
    ipoSuccessFlag: false,
    zeroStakeFlag: false,
    sharePriceHistory: [],
    listingProgress: { stage: 'none', startMonth: null, startYear: null, monthsRemaining: 0 },
    equityFinancing: {
      lastIssuanceMonth: 0,
      pendingApproval: null,
      history: [],
    },
    investors: [],
    financials: {
      annualHistory: [],
      last12MonthProfit: 0,
      monthlyProfits: [],
    },
  };
}

export function ensureCompanyEquity(state) {
  if (!state.companyEquity) state.companyEquity = createDefaultCompanyEquity();
  const ce = state.companyEquity;
  if (ce.investors == null) ce.investors = [];
  if (!ce.financials) ce.financials = { annualHistory: [], last12MonthProfit: 0, monthlyProfits: [] };
  if (!Array.isArray(ce.financials.monthlyProfits)) ce.financials.monthlyProfits = [];
  if (!ce.listingProgress) ce.listingProgress = { stage: 'none', startMonth: null, startYear: null, monthsRemaining: 0 };
  if (!ce.equityFinancing) {
    ce.equityFinancing = { lastIssuanceMonth: 0, pendingApproval: null, history: [] };
  }
  if (ce.isListed == null) ce.isListed = false;
  if (ce.playerShares == null) ce.playerShares = ce.totalShares || 1_000_000;
  if (ce.totalShares == null) ce.totalShares = 1_000_000;
  if (ce.sharePriceWan == null) ce.sharePriceWan = 0.0001;
  return ce;
}

export function renameCompany(state, newName) {
  const ce = ensureCompanyEquity(state);
  if (ce.isListed) return { ok: false, error: '上市后不能修改公司名' };
  if (ce.listingProgress?.stage && ce.listingProgress.stage !== 'none' && ce.listingProgress.stage !== 'listed') {
    return { ok: false, error: '上市申请/准备期不能修改公司名' };
  }
  const trimmed = String(newName || '').trim();
  if (!/^[\u4e00-\u9fa5a-zA-Z0-9]{2,10}$/.test(trimmed)) {
    return { ok: false, error: '公司名需2-10个字符，仅限中文/英文/数字' };
  }
  ce.companyName = trimmed;
  appendLog(state, `【公司名】已更名为「${trimmed}」`);
  return { ok: true };
}

export function calculateLast12MonthProfit(state) {
  const ce = ensureCompanyEquity(state);
  const arr = ce.financials.monthlyProfits;
  if (!Array.isArray(arr) || arr.length < 12) return Number.NEGATIVE_INFINITY;
  return arr.slice(-12).reduce((s, x) => s + (Number(x) || 0), 0);
}

export function checkListingEligibility(state) {
  const ce = ensureCompanyEquity(state);
  const totalAsset = calculateTotalAssetWan(state);
  const last12 = calculateLast12MonthProfit(state);
  const hasSenior = state.employees?.some((e) => e.tier === 'senior');
  const noFund = !state.activeBusinesses?.some((b) => b.kind === 'fundraising');
  const conditions = {
    expansionReached: state.companyPhase?.current === 'expansion' || state.companyPhase?.current === 'mature',
    assetRequirement: totalAsset >= 10_000,
    profitRequirement: last12 > 0,
    reputationRequirement: (state.reputation || 0) >= 80,
    hasSeniorEmployee: hasSenior,
    noActiveFundraising: noFund,
    notAlreadyListed: !ce.isListed,
    canApply: ce.listingProgress?.stage === 'none' || !ce.listingProgress?.stage,
  };
  const eligible = Object.values(conditions).every(Boolean);
  return {
    eligible,
    conditions,
    failedChecks: Object.entries(conditions)
      .filter(([, v]) => !v)
      .map(([k]) => k),
  };
}

export const LISTING_APPLICATION_FEE_WAN = 10;
export const LISTING_PREPARATION_FEE_WAN = 5;

export function applyForListing(state) {
  const check = checkListingEligibility(state);
  if (!check.eligible) {
    return { ok: false, error: '不满足上市条件', details: check.failedChecks };
  }
  if (state.companyCashWan + 1e-9 < LISTING_APPLICATION_FEE_WAN) {
    return { ok: false, error: '现金不足（需要10万申请费）' };
  }
  state.companyCashWan = roundWan(state.companyCashWan - LISTING_APPLICATION_FEE_WAN);
  const ce = ensureCompanyEquity(state);
  ce.listingProgress = {
    stage: 'applying',
    startMonth: state.month,
    startYear: state.year,
    monthsRemaining: 1,
  };
  appendLog(state, '【上市申请】已提交上市申请，审核中（1个月）');
  return { ok: true };
}

export function cancelListingApplication(state) {
  const ce = ensureCompanyEquity(state);
  const st = ce.listingProgress?.stage;
  if (st !== 'applying' && st !== 'preparing') {
    return { ok: false, error: '当前不在申请或准备阶段' };
  }
  ce.listingProgress = { stage: 'none', startMonth: null, startYear: null, monthsRemaining: 0 };
  appendLog(state, '【上市取消】已取消上市申请，已支付费用不退还');
  return { ok: true };
}

function monthIndexY(state) {
  return ymToMonthIndex(state.year || 1990, state.month || 1);
}

/**
 * 月初：从 applying -> preparing，准备期扣费与倒数，或完成上市
 */
export function processListingOnMonthStart(state) {
  const ce = ensureCompanyEquity(state);
  const lp = ce.listingProgress;
  if (!lp) return;
  if (ce.isListed) return;

  if (lp.stage === 'applying') {
    const chk = checkListingEligibility(state);
    if (!chk.eligible) {
      appendLog(state, '【上市】审核未通过，条件已不满足。上市流程终止。');
      ce.listingProgress = { stage: 'none', startMonth: null, startYear: null, monthsRemaining: 0 };
      return;
    }
    lp.stage = 'preparing';
    lp.monthsRemaining = 3;
    appendLog(state, '【上市进度】审核通过，进入3个月上市准备期');
    return;
  }

  if (lp.stage === 'preparing') {
    state.companyCashWan = roundWan(
      Math.max(0, (state.companyCashWan || 0) - LISTING_PREPARATION_FEE_WAN),
    );
    lp.monthsRemaining = (lp.monthsRemaining || 0) - 1;
    if (lp.monthsRemaining <= 0) {
      completeListing(state);
    } else {
      appendLog(state, `【上市进度】准备期剩余 ${lp.monthsRemaining} 个月（已扣准备费 ${LISTING_PREPARATION_FEE_WAN} 万）`);
    }
  }
}

function calculateIPOPrice(state) {
  const ce = ensureCompanyEquity(state);
  const netAssets = calculateTotalAssetWan(state);
  const last12 = calculateLast12MonthProfit(state);
  const ts = Math.max(1, ce.totalShares);
  const peRatio = 10 + ((state.reputation || 50) / 100) * 5;
  const eps = last12 > Number.NEGATIVE_INFINITY ? last12 / ts : 0;
  let ipo = eps * peRatio;
  const book = netAssets / ts;
  if (!Number.isFinite(ipo) || ipo < book * 0.5) ipo = book * 0.5;
  return Math.max(0.0001, roundWan(ipo));
}

function completeListing(state) {
  const ce = ensureCompanyEquity(state);
  const ipo = calculateIPOPrice(state);
  ce.isListed = true;
  state.ipoSuccess = true;
  state.ipoSuccessFlag = true;
  ce.ipoSuccessFlag = true;
  ce.sharePriceWan = ipo;
  ce.listingProgress = { stage: 'listed', startMonth: null, startYear: null, monthsRemaining: 0 };
  if (!ce.sharePriceHistory) ce.sharePriceHistory = [];
  ce.sharePriceHistory.push({ year: state.year, month: state.month, price: ce.sharePriceWan });
  while (ce.sharePriceHistory.length > 24) ce.sharePriceHistory.shift();
  const cap = roundWan(ipo * ce.totalShares);
  state.pendingListingSuccessModal = {
    companyName: ce.companyName,
    ipoPrice: ipo,
    totalShares: ce.totalShares,
    marketCapWan: cap,
  };
  appendLog(
    state,
    `【上市成功】${ce.companyName} 正式上市，IPO 价格 ${ipo} 万/股，市值约 ${cap} 万。`,
  );
}

export function updateListedSharePriceAfterSettlement(state) {
  const ce = ensureCompanyEquity(state);
  if (!ce.isListed) return;
  const current = ce.sharePriceWan || 0.0001;
  const netAssets = calculateTotalAssetWan(state);
  const last12 = calculateLast12MonthProfit(state);
  const ts = Math.max(1, ce.totalShares);
  const book = netAssets / ts;
  const peRatio = 10 + ((state.reputation || 50) / 100) * 5;
  const eps = last12 > Number.NEGATIVE_INFINITY && last12 > 0 ? last12 / ts : 0;
  let fundamental = last12 > 0 && last12 > Number.NEGATIVE_INFINITY ? eps * peRatio : book * 0.8;
  const sent = (state.actualEquityC - 2) * 0.1;
  const randomWalk = (Math.random() - 0.5) * 0.3;
  let target = fundamental * (1 + sent + randomWalk);
  target = Math.max(target, book * 0.4);
  target = Math.min(target, book * 30);
  const maxCh = current * 0.5;
  if (target > current + maxCh) target = current + maxCh;
  else if (target < current - maxCh) target = current - maxCh;
  ce.sharePriceWan = roundWan(Math.max(0.0001, target));
  if (!ce.sharePriceHistory) ce.sharePriceHistory = [];
  ce.sharePriceHistory.push({ year: state.year, month: state.month, price: ce.sharePriceWan });
  while (ce.sharePriceHistory.length > 24) ce.sharePriceHistory.shift();
}

export function appendMonthlyNetProfitChange(state) {
  const ce = ensureCompanyEquity(state);
  const end = calculateTotalAssetWan(state);
  const start = state._monthStartTotalAssetWan;
  if (start == null || !Number.isFinite(start)) {
    return;
  }
  const p = roundWan(end - start);
  if (!Array.isArray(ce.financials.monthlyProfits)) ce.financials.monthlyProfits = [];
  ce.financials.monthlyProfits.push(p);
  if (ce.financials.monthlyProfits.length > 48) {
    ce.financials.monthlyProfits = ce.financials.monthlyProfits.slice(-48);
  }
  const m = ce.financials.monthlyProfits;
  ce.financials.last12MonthProfit = m.length >= 12 ? m.slice(-12).reduce((s, x) => s + x, 0) : 0;
}

const ISSUANCE_COOLDOWN_MONTHS = 6;

export function applyForEquityIssuance(state, sharesToIssue, issuePriceWan) {
  const ce = ensureCompanyEquity(state);
  if (!ce.isListed) return { ok: false, error: '未上市，不能增发股票' };
  const mi = monthIndexY(state);
  if (ce.equityFinancing.lastIssuanceMonth > 0 && mi - ce.equityFinancing.lastIssuanceMonth < ISSUANCE_COOLDOWN_MONTHS) {
    return {
      ok: false,
      error: `增发冷却中，需再等 ${ISSUANCE_COOLDOWN_MONTHS - (mi - ce.equityFinancing.lastIssuanceMonth)} 个月`,
    };
  }
  if (ce.equityFinancing.pendingApproval) return { ok: false, error: '已有增发申请待审批' };
  const n = Math.floor(Number(sharesToIssue));
  const pr = roundWan(Number(issuePriceWan));
  if (!Number.isFinite(n) || n < 10_000) return { ok: false, error: '最少增发1万股' };
  if (!Number.isFinite(pr) || pr <= 0) return { ok: false, error: '增发价格无效' };
  if (pr > (ce.sharePriceWan || 0.0001) * 1.1 + 1e-9) {
    return { ok: false, error: '增发价格不能超过当前股价的110%' };
  }
  const proceeds = roundWan(n * pr);
  ce.equityFinancing.pendingApproval = {
    sharesToIssue: n,
    issuePriceWan: pr,
    totalProceeds: proceeds,
    applyMonth: mi,
    approvalMonth: mi + 1,
    status: 'pending',
  };
  appendLog(
    state,
    `【增发申请】${n} 股，价格 ${pr} 万/股，预计募集 ${proceeds} 万，次月生效`,
  );
  return { ok: true };
}

export function processEquityIssuanceOnMonthStart(state) {
  const ce = ensureCompanyEquity(state);
  const p = ce.equityFinancing?.pendingApproval;
  if (!p || p.status !== 'pending') return;
  const mi = monthIndexY(state);
  if (mi < (p.approvalMonth | 0)) return;
  const proceeds = roundWan(p.sharesToIssue * p.issuePriceWan);
  ce.totalShares = (ce.totalShares | 0) + p.sharesToIssue;
  state.companyCashWan = roundWan((state.companyCashWan || 0) + proceeds);
  if (!ce.equityFinancing.history) ce.equityFinancing.history = [];
  ce.equityFinancing.history.push({
    year: state.year,
    month: state.month,
    sharesIssued: p.sharesToIssue,
    priceWan: p.issuePriceWan,
    proceedsWan: proceeds,
  });
  ce.equityFinancing.lastIssuanceMonth = mi;
  ce.equityFinancing.pendingApproval = null;
  state.pendingIssuanceSuccess = {
    sharesIssued: p.sharesToIssue,
    priceWan: p.issuePriceWan,
    proceedsWan: proceeds,
    newTotalShares: ce.totalShares,
  };
  appendLog(state, `【增发完成】增发 ${p.sharesToIssue} 股，募集资金 ${proceeds} 万`);
}

export function buyOwnCompanyShares(state, amountWan) {
  const ce = ensureCompanyEquity(state);
  if (!ce.isListed) return { ok: false, error: '未上市' };
  const pr = ce.sharePriceWan || 0.0001;
  const am = roundWan(Number(amountWan));
  if (am <= 0) return { ok: false, error: '金额须大于0' };
  const maxShares = Math.floor(am / pr);
  if (maxShares < 1) return { ok: false, error: '金额不足以买1股' };
  const cost = roundWan(maxShares * pr);
  if (state.companyCashWan + 1e-9 < cost) return { ok: false, error: '现金不足' };
  state.companyCashWan = roundWan(state.companyCashWan - cost);
  ce.playerShares = (ce.playerShares | 0) + maxShares;
  appendLog(state, `【回购】买入自家股 ${maxShares} 股，花费 ${cost} 万（系统资金池 v0.4）`);
  return { ok: true, shares: maxShares, cost };
}

export function sellOwnCompanyShares(state, shareCount) {
  const ce = ensureCompanyEquity(state);
  if (!ce.isListed) return { ok: false, error: '未上市' };
  const n = Math.floor(Number(shareCount));
  if (n < 1) return { ok: false, error: '股数无效' };
  if ((ce.playerShares | 0) < n) return { ok: false, error: '持股不足' };
  const pr = ce.sharePriceWan || 0.0001;
  const proceeds = roundWan(n * pr);
  ce.playerShares = (ce.playerShares | 0) - n;
  state.companyCashWan = roundWan((state.companyCashWan || 0) + proceeds);
  const ratio = n / (ce.totalShares | 1);
  if (ratio > 0.01) {
    const impact = ratio * 0.5;
    ce.sharePriceWan = roundWan((ce.sharePriceWan || 0.0001) * (1 - impact));
  }
  if (ce.playerShares <= 0) {
    ce.playerShares = 0;
    ce.zeroStakeFlag = true;
    appendLog(state, '【提示】您已减持至 0 股，游戏可继续。');
  }
  appendLog(state, `【减持】卖出 ${n} 股，获得 ${proceeds} 万（系统资金池 v0.4）`);
  return { ok: true, proceeds };
}

function generateShareholdingReport(state) {
  const ce = ensureCompanyEquity(state);
  const ts = Math.max(1, ce.totalShares | 0);
  const out = [
    { name: '玩家', shares: ce.playerShares | 0, percent: round2(((ce.playerShares | 0) / ts) * 100) },
  ];
  for (const inv of ce.investors || []) {
    out.push({
      name: inv.name,
      shares: inv.shares | 0,
      percent: round2(((inv.shares | 0) / ts) * 100),
    });
  }
  return out.sort((a, b) => b.shares - a.shares);
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

/**
 * 每年 1 月：生成上一自然年财报
 */
export function maybeGenerateAnnualReport(state) {
  if ((state.month | 0) !== 1) return null;
  const ce = ensureCompanyEquity(state);
  const reportYear = (state.year | 0) - 1;
  if (reportYear < 1990) return null;
  const m = ce.financials?.monthlyProfits || [];
  const annualProfit = m.length >= 12 ? m.slice(-12).reduce((s, x) => s + (Number(x) || 0), 0) : 0;
  const assets = calculateTotalAssetWan(state);
  const roe = assets > 1e-9 ? (annualProfit / assets) * 100 : 0;
  const report = {
    year: reportYear,
    generatedAt: { year: state.year, month: 1 },
    companyName: ce.companyName,
    isListed: ce.isListed,
    totalAssetsWan: assets,
    annualProfitWan: roundWan(annualProfit),
    roe: round2(roe / 100),
    sharePrice: ce.isListed ? ce.sharePriceWan : null,
    marketCapWan: ce.isListed ? roundWan(ce.sharePriceWan * ce.totalShares) : null,
    shareholding: generateShareholdingReport(state),
    sharePriceHistory: (ce.sharePriceHistory || []).slice(-12),
  };
  if (!ce.financials.annualHistory) ce.financials.annualHistory = [];
  ce.financials.annualHistory.push(report);
  if (ce.financials.annualHistory.length > 30) ce.financials.annualHistory.shift();
  state.pendingAnnualReport = report;
  return report;
}

export function applyDilutionOnFundraisingSuccess(state, ord) {
  const ce = ensureCompanyEquity(state);
  if (!ord || !ord.equityOnSuccess) return;
  const { percent, name } = ord.equityOnSuccess;
  const shares = Math.max(0, Math.floor((ce.totalShares * percent) / 100));
  if (shares < 1) return;
  ce.playerShares = Math.max(0, (ce.playerShares | 0) - shares);
  ce.investors.push({
    id: nextId(state, 'inv'),
    name: name || '跟投方',
    type: 'round',
    shares,
    investedWan: ord.expectedFundWan || 0,
    date: { year: state.year, month: state.month },
  });
}

export { PLAYER_STOCK_ID };

export function getPlayerCompanyStockDef(state) {
  const ce = ensureCompanyEquity(state);
  if (!ce.isListed) return null;
  const macroSentimentBp = (state.actualEquityC - 2) * 100;
  return {
    id: PLAYER_STOCK_ID,
    name: ce.companyName,
    shortName: '自司',
    sectorId: 'fin',
    listingYearMonth: `${state.year}-${String(state.month).padStart(2, '0')}`,
    matureYear: 1990,
    matureBetaExtraBp: Math.max(-300, Math.min(300, macroSentimentBp)),
    dividendRateAnnual: 0,
    isFictional: true,
    isPlayerCompany: true,
  };
}
