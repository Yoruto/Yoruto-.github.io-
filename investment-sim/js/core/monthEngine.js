import {
  ymToMonthIndex,
  rollMacroC,
  rollPredictedC,
  majorEventTriggerH,
} from './rng.js';
import {
  settleMonthlyOrder,
  computePortfolioBetaExtraBp,
  computePortfolioSectorBp,
  doesStockPayDividend,
  getStockBetaExtraBp,
  calculateConsultingRevenue,
} from './settlement.js';
import { generateRandomPartialStockPortfolio, STOCK_PARTIAL_SLEEVE_BP } from './rng.js';
import {
  appendLog,
  getMonthlyRentTotalWan,
  getPayrollTotalWan,
  getTotalCapacity,
  nextId,
  severanceForEmployee,
  roundWan,
  trainingCostWan,
  canPromote,
  SCHEMA_VERSION,
  computeBusinessAbility,
  hasActiveBusiness,
  employeeCanDeploy,
} from './state.js';
import {
  OFFICE_GRADES,
  LEASE_DEPOSIT_RETURN_RATIO,
  getEmployeeMaxAumWan,
} from './tables.js';
import { buildMonthReportData } from './monthReport.js';
import { buildAiStockPortfolio, REBALANCE_INTERVAL_MONTHS } from './employeeAI.js';
import { checkPhaseTransition } from './phase.js';
import {
  pushDueMajorEvents,
  applyMajorStackToC,
  tickMajorStack,
  rollMinorEvent,
} from './events.js';
import {
  calculateTotalAssetWan,
  getCompanyValuationWan,
  ensureCompanyEquity,
  processListingOnMonthStart,
  processEquityIssuanceOnMonthStart,
  updateListedSharePriceAfterSettlement,
  appendMonthlyNetProfitChange,
  applyDilutionOnFundraisingSuccess,
  maybeGenerateAnnualReport,
} from './companyEquity.js';
import { processRealEstateMonthly } from './realEstate.js';
import { tryNpcInvestment, expireNpcIfNeeded } from './npcInvestors.js';
import { processStartupMonthly } from './startupInvest.js';

function compareYm(a, y, m) {
  if (a.year !== y) return a.year - y;
  return a.month - m;
}

export function listingOk(listingYm, year, month) {
  if (!listingYm) return true;
  const [yy, mm] = listingYm.split('-').map(Number);
  return compareYm({ year: yy, month: mm }, year, month) <= 0;
}

/** 月初：扣款 + 大事件入栈 + 宏观（文档第十一节 1~3 合并为一步） */
export function runMonthOpening(state) {
  // #region agent log - Hypothesis C: runMonthOpening called
  fetch('http://127.0.0.1:7560/ingest/77a3c25e-7bb2-4bbf-97cc-1f5ddf8c78b0',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'04fd4d'},body:JSON.stringify({sessionId:'04fd4d',location:'monthEngine.js:opening-start',message:'runMonthOpening called',data:{phase:state?.phase,gameOver:state?.gameOver,victory:state?.victory,year:state?.year,month:state?.month,cash:state?.companyCashWan},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  if (state.gameOver || state.victory) return;

  pushDueMajorEvents(state);
  if (state.majorEventNote) {
    appendLog(state, state.majorEventNote);
    state.majorEventNote = '';
  }

  const payroll = getPayrollTotalWan(state);
  const rent = getMonthlyRentTotalWan(state);
  let tax = 0;
  if (state.month === 1) {
    for (const o of state.offices) {
      if (o.kind === 'owned' && o.purchasePriceWan) {
        tax += roundWan(o.purchasePriceWan * (OFFICE_GRADES[o.gradeId]?.propertyTaxRate ?? 0));
      }
    }
  }

  const mustPay = roundWan(payroll + rent + tax);
  state.companyCashWan = roundWan(state.companyCashWan);
  if (state.companyCashWan < mustPay - 1e-9) {
    state.gameOver = true;
    state.gameOverReason = `现金不足以支付刚性支出（工资+租金+税 ${mustPay} 万）。`;
    appendLog(state, state.gameOverReason);
    state.phase = 'game_over';
    return;
  }

  // 记录月初现金（扣款前，用于月度报告计算）
  state._monthStartCashWan = roundWan(state.companyCashWan);
  /** 扣款前总资产，用于滚动月度净利润（v0.4 上市条件 / 股价） */
  state._monthStartTotalAssetWan = calculateTotalAssetWan(state);

  state.companyCashWan = roundWan(state.companyCashWan - mustPay);
  appendLog(
    state,
    `【月初扣款】工资 ${roundWan(payroll)} 万，写字楼支出 ${roundWan(rent + tax)} 万（含物业税 ${roundWan(tax)} 万）。`,
  );

  const idx = ymToMonthIndex(state.year, state.month);
  const baseEq = rollMacroC(state.gameSeed, idx, 'equity');
  const baseCo = rollMacroC(state.gameSeed, idx, 'commodity');
  const applied = applyMajorStackToC(state, baseEq, baseCo);
  state.actualEquityC = applied.equityC;
  state.actualCommodityC = applied.commodityC;

  state.predictedEquityC = rollPredictedC(state.gameSeed, idx + 1, 'equity');
  state.predictedCommodityC = rollPredictedC(state.gameSeed, idx + 1, 'commodity');

  // 在进入 market 阶段前，检查公司发展阶段（初创/扩张/成熟）是否发生变更
  try {
    checkPhaseTransition(state);
  } catch (e) {
    // 若阶段检测出现错误，不阻塞月度流程
    console.error('checkPhaseTransition error', e);
  }

  // v0.4：股份、上市准备、增发、NPC、年报
  try {
    ensureCompanyEquity(state);
    processEquityIssuanceOnMonthStart(state);
    processListingOnMonthStart(state);
    expireNpcIfNeeded(state);
    if ((state.month | 0) === 1) {
      maybeGenerateAnnualReport(state);
    }
    tryNpcInvestment(state);
  } catch (e) {
    console.error('v0.4 month opening hooks', e);
  }

  state.phase = 'market';
}

/**
 * @param {'remit'|'reinvest'} profitPolicy — reinvest=滚存复利（利润并入 aumWan 参与下月结算）
 */
export function addActiveBusiness(state, orderDraft, config) {
  const emp = state.employees.find((e) => e.id === orderDraft.employeeId);
  if (!emp || !employeeCanDeploy(state, emp)) return { ok: false, error: '员工不可新开业务' };

  // 支持当月结的咨询服务（无需资金调拨）
  if (orderDraft.kind === 'consulting') {
    const id = nextId(state, 'b');
    if (typeof state.businessRngSlotSeq !== 'number') state.businessRngSlotSeq = 0;
    const rngOrderSlot = state.businessRngSlotSeq++;
    state.activeBusinesses.push({
      id,
      employeeId: emp.id,
      kind: 'consulting',
      initialWan: 0,
      aumWan: 0,
      profitPolicy: 'remit',
      industry: orderDraft.industry || 'finance',
      rngOrderSlot,
      oneOff: true,
    });
    appendLog(state, `【开业】${emp.name} 开展 咨询服务（${orderDraft.industry || '未知行业'}）。`);
    return { ok: true };
  }

  // 支持多月的拉投资（fundraising）——基于员工领导力决定周期并设定目标募集金额
  if (orderDraft.kind === 'fundraising') {
    const ce = ensureCompanyEquity(state);
    if (ce.isListed) {
      return { ok: false, error: '已上市，请使用增发股票筹资（或回购）；不再开展拉投资' };
    }
    const stg = ce.listingProgress?.stage;
    if (stg === 'applying' || stg === 'preparing') {
      return { ok: false, error: '上市申请或准备期内不可开展拉投资' };
    }
    if (state.pendingFundraisingConfirmation) {
      return { ok: false, error: '请先处理待确认的拉投资弹窗' };
    }
    const leadership = emp.leadership || 0;
    const totalMonths = Math.max(1, 7 - leadership);
    const randAdd = Math.round(Math.random() * 20);
    const expectedFundWan = roundWan(10 + leadership * 5 + (state.reputation || 0) * 0.5 + randAdd);

    const EQUITY_THRESHOLD = 50;
    if (expectedFundWan + 1e-9 >= EQUITY_THRESHOLD) {
      const valuationWan = getCompanyValuationWan(state);
      const denom = valuationWan * 1.5;
      const base = denom > 1e-9 ? (expectedFundWan / denom) * 100 : 0;
      const equityPercent = Math.round(Math.max(0, base) * 100) / 100;
      state.pendingFundraisingConfirmation = {
        employeeId: emp.id,
        employeeName: emp.name,
        leadership,
        totalMonths,
        expectedFundWan,
        equityPercent,
        valuationWan,
      };
      return { ok: false, needsConfirmation: true };
    }

    const id = nextId(state, 'b');
    if (typeof state.businessRngSlotSeq !== 'number') state.businessRngSlotSeq = 0;
    const rngOrderSlot = state.businessRngSlotSeq++;
    state.activeBusinesses.push({
      id,
      employeeId: emp.id,
      kind: 'fundraising',
      initialWan: 0,
      aumWan: 0,
      profitPolicy: 'remit',
      totalMonths,
      elapsedMonths: 0,
      expectedFundWan,
      rngOrderSlot,
    });
    appendLog(state, `【开业】${emp.name} 开展 拉投资（目标 ${expectedFundWan} 万，周期 ${totalMonths} 个月）。`);
    return { ok: true };
  }

  const alloc = Number(orderDraft.allocWan);
  if (!Number.isFinite(alloc) || alloc < 1) return { ok: false, error: '金额无效（至少 1 万）' };

  if (state.companyCashWan + 1e-9 < alloc) return { ok: false, error: '公司现金不足' };

  const profitPolicy = orderDraft.profitPolicy === 'remit' ? 'remit' : 'reinvest';

  const stockGuideMode = Math.max(0, Math.min(2, Number(orderDraft.stockGuideMode ?? 1) | 0));
  const leverage = Math.max(1, Math.min(3, Number(orderDraft.leverage ?? 1) | 0));

  let futuresVariantId = 'composite';
  if (orderDraft.kind === 'fut') {
    futuresVariantId = orderDraft.futuresVariantId || config?.futures?.defaultVariantId || 'composite';
    const v = config?.futures?.variants?.[futuresVariantId];
    if (!v) return { ok: false, error: '期货品种无效' };
  }

  if (typeof state.businessRngSlotSeq !== 'number') state.businessRngSlotSeq = 0;
  const rngOrderSlot = state.businessRngSlotSeq;
  state.businessRngSlotSeq += 1;

  const stockList = (config?.stocks || []).filter((s) => listingOk(s.listingYearMonth, state.year, state.month));
  const listForRandom = stockList.length ? stockList : config?.stocks || [];
  const miOpen = ymToMonthIndex(state.year, state.month);
  const SLEEVE_FULL = 10000;
  let stockPortfolio = [];
  /** 10000=组合代表 100% AUM；轻仓 2000=仅 20% 参与股票收益与持仓 */
  let stockSleeveBp = SLEEVE_FULL;
  if (orderDraft.kind === 'stock') {
    const hasAi = emp.aiStyle && ['momentum', 'trend', 'dividend'].includes(emp.aiStyle);
    if (hasAi) {
      const aiPort = buildAiStockPortfolio(
        state.gameSeed,
        state.year,
        state.month,
        emp.aiStyle,
        stockList.length ? stockList : config.stocks,
        config.sectors || [],
      );
      if (aiPort.length) {
        stockPortfolio = aiPort;
        stockSleeveBp = SLEEVE_FULL;
      } else {
        stockPortfolio = generateRandomPartialStockPortfolio(
          state.gameSeed,
          miOpen,
          rngOrderSlot,
          emp.id,
          listForRandom,
        );
        stockSleeveBp = STOCK_PARTIAL_SLEEVE_BP;
      }
    } else {
      stockPortfolio = generateRandomPartialStockPortfolio(
        state.gameSeed,
        miOpen,
        rngOrderSlot,
        emp.id,
        listForRandom,
      );
      stockSleeveBp = STOCK_PARTIAL_SLEEVE_BP;
    }
  }
  if (orderDraft.kind === 'stock' && !stockPortfolio.length) {
    stockSleeveBp = 0;
  }

  const id = nextId(state, 'b');
  state.activeBusinesses.push({
    id,
    employeeId: emp.id,
    kind: orderDraft.kind,
    initialWan: alloc,
    aumWan: alloc,
    profitPolicy,
    stockId: null,
    stockPortfolio,
    stockSleeveBp,
    futuresVariantId,
    stockGuideMode,
    leverage,
    rngOrderSlot,
  });

  state.companyCashWan = roundWan(state.companyCashWan - alloc);

  const polLabel = profitPolicy === 'reinvest' ? '滚存复利' : '上交公司';
  const sleeveHint =
    orderDraft.kind === 'stock' && (stockSleeveBp ?? SLEEVE_FULL) < SLEEVE_FULL
      ? ` 股票仓 ${((stockSleeveBp ?? SLEEVE_FULL) / 100).toFixed(0)}%`
      : '';
  const portHint =
    orderDraft.kind === 'stock' && stockPortfolio.length
      ? ` 组合：${stockPortfolio.map((p) => `${p.stockId}:${(p.weightBp / 100).toFixed(1)}%`).join(' ')}${sleeveHint}`
      : '';
  appendLog(
    state,
    `【开业】${emp.name} ${orderDraft.kind === 'stock' ? '股票' : '期货'} 本金 ${alloc} 万 · ${polLabel}${portHint}。`,
  );
  if (orderDraft.kind === 'stock' && stockPortfolio.length) {
    emp.lastRebalanceMonth = miOpen;
  }
  return { ok: true };
}

/**
 * 拉投资 ≥50 万需确认；确认后开展业务，稀释仅在募集成功时应用（见 settlement）
 */
export function confirmFundraisingWithEquity(state, accept) {
  const pending = state.pendingFundraisingConfirmation;
  if (!pending) return { ok: false, error: '无待确认的拉投资' };
  if (!accept) {
    state.pendingFundraisingConfirmation = null;
    return { ok: false, cancelled: true };
  }
  const emp2 = state.employees.find((e) => e.id === pending.employeeId);
  if (!emp2 || !employeeCanDeploy(state, emp2)) {
    state.pendingFundraisingConfirmation = null;
    return { ok: false, error: '员工不可新开业务' };
  }
  const id = nextId(state, 'b');
  if (typeof state.businessRngSlotSeq !== 'number') state.businessRngSlotSeq = 0;
  const rngOrderSlot = state.businessRngSlotSeq++;
  const pct = Number(pending.equityPercent) || 0;
  state.activeBusinesses.push({
    id,
    employeeId: pending.employeeId,
    kind: 'fundraising',
    initialWan: 0,
    aumWan: 0,
    profitPolicy: 'remit',
    totalMonths: pending.totalMonths,
    elapsedMonths: 0,
    expectedFundWan: pending.expectedFundWan,
    rngOrderSlot,
    equityOnSuccess: { percent: pct, name: '跟投方' },
  });
  state.pendingFundraisingConfirmation = null;
  appendLog(
    state,
    `【开业】${emp2.name} 开展 拉投资（目标 ${pending.expectedFundWan} 万，周期 ${pending.totalMonths} 个月，成功时约出让 ${pct}% 股份）。`,
  );
  return { ok: true };
}

/**
 * 每月 1 次：股票风格/组合、期货杠杆、业务资金增减可合并为一次操作。
 * @param {object} patch — { stockGuideMode?, leverage?, stockPortfolio?, aumDeltaWan? }
 */
function portfolioKey(arr) {
  const rows = (arr || [])
    .map((x) => ({ stockId: x.stockId, weightBp: x.weightBp | 0 }))
    .sort((a, b) => a.stockId.localeCompare(b.stockId));
  return JSON.stringify(rows);
}

const GUIDE_MIN_AUM_WAN = 1;

export function applyGuidance(state, businessId, patch, config) {
  if (state.guidanceRemaining <= 0) return { ok: false, error: '本月指导次数已用尽' };
  const b = state.activeBusinesses.find((x) => x.id === businessId);
  if (!b) return { ok: false, error: '业务不存在' };

  let aumDelta = 0;
  if (patch.aumDeltaWan != null && patch.aumDeltaWan !== '') {
    const d = Number(patch.aumDeltaWan);
    if (Number.isFinite(d)) aumDelta = roundWan(d);
  }
  const hasAum = Math.abs(aumDelta) > 1e-9;

  let changed = false;
  const detailParts = [];

  if (b.kind === 'stock') {
    const hasMode = patch.stockGuideMode != null && patch.stockGuideMode !== '';
    const hasPort = patch.stockPortfolio && patch.stockPortfolio.length;
    if (!hasMode && !hasPort && !hasAum) {
      return { ok: false, error: '请至少调整风格、组合权重和/或资金调拨（万元，正=增资，负=减资）' };
    }
    if (hasMode) {
      const nm = Math.max(0, Math.min(2, Number(patch.stockGuideMode) | 0));
      if (nm !== b.stockGuideMode) {
        b.stockGuideMode = nm;
        changed = true;
        detailParts.push(`风格${nm}`);
      }
    }
    if (hasPort) {
      const sum = patch.stockPortfolio.reduce((s, x) => s + (x.weightBp | 0), 0);
      if (sum !== 10000) return { ok: false, error: '组合权重须合计 10000（=100%）' };
      for (const leg of patch.stockPortfolio) {
        if (!config.stocks.find((s) => s.id === leg.stockId)) return { ok: false, error: `无效股票 ${leg.stockId}` };
      }
      const next = patch.stockPortfolio.map((x) => ({ stockId: x.stockId, weightBp: x.weightBp | 0 }));
      if (portfolioKey(next) !== portfolioKey(b.stockPortfolio)) {
        b.stockPortfolio = next;
        changed = true;
        detailParts.push('组合');
      }
    }
  } else if (b.kind === 'fut') {
    const hasLev = patch.leverage != null && patch.leverage !== '';
    if (!hasLev && !hasAum) return { ok: false, error: '请选择杠杆和/或填写资金调拨' };
    if (hasLev) {
      const L = Math.max(1, Math.min(3, Number(patch.leverage) | 0));
      if (L !== b.leverage) {
        b.leverage = L;
        changed = true;
        detailParts.push(`${L}x`);
      }
    }
  }

  if (hasAum) {
    if (aumDelta > 0) {
      if (state.companyCashWan + 1e-9 < aumDelta) return { ok: false, error: '公司现金不足，无法增资' };
    } else {
      const out = roundWan(-aumDelta);
      const nextAum = roundWan(b.aumWan - out);
      if (nextAum + 1e-9 < GUIDE_MIN_AUM_WAN) {
        return { ok: false, error: `减资后 AUM 须不少于 ${GUIDE_MIN_AUM_WAN} 万` };
      }
      if (b.profitPolicy === 'remit') {
        const nextInit = roundWan(b.initialWan - out);
        if (nextInit + 1e-9 < GUIDE_MIN_AUM_WAN) {
          return { ok: false, error: `减资后上交本金须不少于 ${GUIDE_MIN_AUM_WAN} 万` };
        }
      }
    }
    state.companyCashWan = roundWan(state.companyCashWan - aumDelta);
    b.aumWan = roundWan(b.aumWan + aumDelta);
    if (b.profitPolicy === 'remit') b.initialWan = roundWan(b.initialWan + aumDelta);
    changed = true;
    detailParts.push(aumDelta > 0 ? `增资${aumDelta}万` : `减资${roundWan(-aumDelta)}万`);
  }

  if (!changed) return { ok: false, error: '与当前设置相同，未消耗指导' };

  state.guidanceRemaining -= 1;
  const emp = state.employees.find((e) => e.id === b.employeeId);
  const kindLabel = b.kind === 'stock' ? '股票' : '期货';
  appendLog(
    state,
    `【指导·${kindLabel}】${emp?.name || ''} ${detailParts.join('、')}（本月剩余 ${state.guidanceRemaining} 次）。`,
  );
  return { ok: true };
}

/** 结束业务：当前规模划回公司 */
export function closeActiveBusiness(state, businessId) {
  const i = state.activeBusinesses.findIndex((b) => b.id === businessId);
  if (i < 0) return { ok: false, error: '业务不存在' };
  const b = state.activeBusinesses[i];
  const emp = state.employees.find((e) => e.id === b.employeeId);
  const name = emp?.name || '';
  if (b.kind === 'realestate' || b.kind === 'startup_invest') {
    state.activeBusinesses.splice(i, 1);
    const kindLabel = b.kind === 'realestate' ? '房地产' : '初创投资';
    appendLog(state, `【结业】${name} 的${kindLabel}项目「${b.name || '—'}」已终止（本类型无 AUM 划回公司）。`);
    return { ok: true };
  }
  const back = roundWan(b.aumWan);
  state.companyCashWan = roundWan(state.companyCashWan + back);
  state.activeBusinesses.splice(i, 1);
  appendLog(state, `【结业】${name} 业务结束，收回 ${back} 万。`);
  return { ok: true };
}

export function setBusinessProfitPolicy(state, businessId, policy) {
  const b = state.activeBusinesses.find((x) => x.id === businessId);
  if (!b) return { ok: false, error: '业务不存在' };
  const p = policy === 'remit' ? 'remit' : 'reinvest';
  b.profitPolicy = p;
  const emp = state.employees.find((e) => e.id === b.employeeId);
  appendLog(
    state,
    `【策略】${emp?.name || ''} 利润分配改为 ${p === 'reinvest' ? '滚存复利' : '上交公司'}。`,
  );
  return { ok: true };
}

/** @deprecated 兼容旧调用名 */
export function addMonthOrder(state, orderDraft, config) {
  return addActiveBusiness(state, orderDraft, config);
}

export function removeMonthOrder(state, orderId) {
  void orderId;
  return { ok: false, error: '请使用结业关闭持久业务' };
}

/**
 * 月结后、经验结算前：**月分红**（年股息率 ÷ 12，按持仓月计提，仅成熟期派息）
 * 成长期不派；复利策略下分红滚入 AUM，上交策略下进公司现金。
 */
function settleDividends(state, config) {
  let total = 0;
  const currentYear = state.year;
  /** @type {{ businessId: string, employeeName: string, amountWan: number }[]} */
  const breakdown = [];
  for (const ord of state.activeBusinesses) {
    if (ord.kind !== 'stock' || !ord.stockPortfolio?.length) continue;
    let forOrd = 0;
    for (const leg of ord.stockPortfolio) {
      const st = (config.stocks || []).find((s) => s.id === leg.stockId);
      if (!st) continue;
      if (!doesStockPayDividend(st, currentYear)) continue;
      const annual = Number(st.dividendRateAnnual) || 0;
      if (annual <= 0) continue;
      const monRate = annual / 12;
      const sleeve = Math.max(0, Math.min(10000, ord.stockSleeveBp ?? 10000));
      const w = (sleeve / 10000) * ((leg.weightBp | 0) / 10000);
      const pos = roundWan(ord.aumWan * w);
      const cash = roundWan(pos * monRate);
      if (cash <= 0) continue;
      forOrd = roundWan(forOrd + cash);
      total = roundWan(total + cash);
      if (ord.profitPolicy === 'reinvest') {
        ord.aumWan = roundWan(ord.aumWan + cash);
      } else {
        state.companyCashWan = roundWan(state.companyCashWan + cash);
      }
    }
    if (forOrd > 0) {
      const emp = state.employees.find((e) => e.id === ord.employeeId);
      breakdown.push({ businessId: ord.id, employeeName: emp?.name || '—', amountWan: forOrd });
    }
  }
  if (total > 0) {
    appendLog(state, `【月分红】本月股票持仓月分红（年息÷12 计提）合计 ${roundWan(total)} 万。`);
  }
  state._lastDividendTotalWan = roundWan(total);
  state._lastDividendBreakdown = breakdown;
}

/**
 * 季度调仓：有 aiStyle 的负责人员工，满足间隔后重建组合
 */
function runEmployeeAiRebalance(state, config) {
  if (!config?.stocks?.length) return;
  const mi = ymToMonthIndex(state.year, state.month);
  for (const b of state.activeBusinesses) {
    if (b.kind !== 'stock') continue;
    const emp = state.employees.find((e) => e.id === b.employeeId);
    if (!emp || !['momentum', 'trend', 'dividend'].includes(emp.aiStyle)) continue;
    const last = emp.lastRebalanceMonth;
    if (last == null) {
      emp.lastRebalanceMonth = mi;
      continue;
    }
    if (mi - last < REBALANCE_INTERVAL_MONTHS) continue;
    const port = buildAiStockPortfolio(
      state.gameSeed,
      state.year,
      state.month,
      emp.aiStyle,
      config.stocks,
      config.sectors || [],
    );
    if (port.length) {
      b.stockPortfolio = port;
      b.stockSleeveBp = 10000;
      emp.lastRebalanceMonth = mi;
      appendLog(state, `【AI 调仓】${emp.name} 已按「${emp.aiStyle}」更新组合。`);
    }
  }
}

export function runSettlement(state, config) {
  const monthIndex = ymToMonthIndex(state.year, state.month);
  state.lastSettlementResults = [];
  state.pendingMargin = [];

  const lines = [...state.activeBusinesses].sort((a, b) => a.rngOrderSlot - b.rngOrderSlot);

  for (const ord of lines) {
    const emp = state.employees.find((e) => e.id === ord.employeeId);
    if (!emp) continue;

    // 处理当月结的咨询服务（短期业务）
    if (ord.kind === 'consulting') {
      try {
        const rev = calculateConsultingRevenue(emp, ord.industry || 'finance');
        state.companyCashWan = roundWan(state.companyCashWan + rev);
        appendLog(state, `【咨询】${emp.name} 完成 ${ord.industry || '行业'} 报告，获得 ${rev} 万。`);
        // 能力成长：行业技术 +1；领导力 10% 概率 +1
        if (!emp.industryTech) emp.industryTech = {};
        emp.industryTech[ord.industry] = Math.min(100, (emp.industryTech[ord.industry] || 0) + 1);
        if (Math.random() < 0.1) {
          emp.leadership = Math.min(10, (emp.leadership || 0) + 1);
          appendLog(state, `【成长】${emp.name} 的领导力小幅提升至 ${emp.leadership}。`);
        }
        emp.experienceMonths += 1;
      } catch (e) {
        console.error('consulting settle error', e);
      }
      // 移除一次性业务
      const idx = state.activeBusinesses.findIndex((b) => b.id === ord.id);
      if (idx >= 0) state.activeBusinesses.splice(idx, 1);
      continue;
    }

    // 处理多月的拉投资业务（推进周期并在完成时判定）
    if (ord.kind === 'fundraising') {
      try {
        ord.elapsedMonths = (ord.elapsedMonths || 0) + 1;
        appendLog(state, `【拉投·进度】${emp.name} 的拉投资进展：${ord.elapsedMonths}/${ord.totalMonths} 月。`);
        if (ord.elapsedMonths >= (ord.totalMonths || 1)) {
          // 成功概率：基础 30% + 5% * leadership + 1% * reputation（上限 95%）
          const leadership = emp.leadership || 0;
          let successChance = 0.3 + 0.05 * leadership + 0.01 * (state.reputation || 0);
          successChance = Math.min(0.95, successChance);
          const ok = Math.random() < successChance;
          if (ok) {
            state.companyCashWan = roundWan(state.companyCashWan + (ord.expectedFundWan || 0));
            applyDilutionOnFundraisingSuccess(state, ord);
            appendLog(state, `【拉投·成功】${emp.name} 完成拉投资，募集到 ${ord.expectedFundWan || 0} 万。`);
            emp.experienceMonths += 3;
            emp.leadership = Math.min(10, (emp.leadership || 0) + 1);
          } else {
            appendLog(state, `【拉投·失败】${emp.name} 的拉投资未达成目标，声誉 -1。`);
            state.reputation = Math.max(0, (state.reputation || 0) - 1);
          }
          const idx2 = state.activeBusinesses.findIndex((b) => b.id === ord.id);
          if (idx2 >= 0) state.activeBusinesses.splice(idx2, 1);
        }
      } catch (e) {
        console.error('fundraising settle error', e);
      }
      continue;
    }

    // 处理房地产项目（v0.5.1）
    if (ord.kind === 'realestate') {
      try {
        const handled = processRealEstateMonthly(state, ord);
        if (handled === true) {
          // real estate handler managed logging and state changes; continue to next ord
          continue;
        }
        // if handler returns false/undefined fall through to generic settlement
      } catch (e) {
        console.error('processRealEstateMonthly error', e);
        // fall through
      }
    }
    if (ord.kind === 'startup_invest') {
      try {
        const h2 = processStartupMonthly(state, ord);
        if (h2 === true) continue;
      } catch (e) {
        console.error('processStartupMonthly error', e);
      }
    }

    const allocForSettle =
      ord.profitPolicy === 'remit' ? ord.initialWan : roundWan(ord.aumWan);
    if (allocForSettle <= 0) continue;

    let portfolioBetaBp = 0;
    let portfolioSectorBp = 0;
    if (ord.kind === 'stock') {
      // 传入当前年份、gameSeed、monthIndex 以支持成长股/成熟股的动态 beta
      portfolioBetaBp = computePortfolioBetaExtraBp(
        ord.stockPortfolio,
        config.stocks,
        state.year,
        state.gameSeed,
        monthIndex,
      );
      portfolioSectorBp = computePortfolioSectorBp(ord.stockPortfolio, config.stocks, config.sectors);
      if ((!ord.stockPortfolio || ord.stockPortfolio.length === 0) && ord.stockId) {
        const st = config.stocks.find((s) => s.id === ord.stockId);
        // 使用 getStockBetaExtraBp 来获取当前年份的 beta（成长期/成熟期）
        portfolioBetaBp = getStockBetaExtraBp(st, state.year, state.gameSeed, monthIndex);
        const sec = config.sectors?.find((s) => s.id === st?.sectorId);
        portfolioSectorBp = sec?.sectorBetaBp ?? 0;
      }
    }

    const futRow =
      ord.kind === 'fut'
        ? config.futures.variants[ord.futuresVariantId].B_fut_bp_by_c
        : null;

    const cMacro = ord.kind === 'stock' ? state.actualEquityC : state.actualCommodityC;

    const abilityForBusiness = computeBusinessAbility(emp, ord.kind);
    let { P, profitWan, success } = settleMonthlyOrder({
      kind: ord.kind,
      cMacro,
      ability: abilityForBusiness,
      allocWan: allocForSettle,
      monthIndex,
      orderIndexInMonth: ord.rngOrderSlot,
      gameSeed: state.gameSeed,
      stockGuideMode: ord.stockGuideMode,
      portfolioBetaBp: ord.kind === 'stock' ? portfolioBetaBp : undefined,
      portfolioSectorBp: ord.kind === 'stock' ? portfolioSectorBp : undefined,
      stockId: null,
      betaExtraBp: 0,
      futBpByC: futRow,
      leverage: ord.leverage,
      stockSleeveWeightBp: ord.kind === 'stock' ? (ord.stockSleeveBp ?? 10000) : undefined,
    });

    // 管理上限超额惩罚：如果当前 AUM 超过员工管理上限，收益减半
    const maxAumWan = getEmployeeMaxAumWan(emp);
    let exceededLimit = false;
    if (ord.aumWan > maxAumWan) {
      exceededLimit = true;
      if (profitWan > 0) {
        profitWan = roundWan(profitWan * 0.5);
        // 重新计算 P（基于新的 profitWan）
        P = allocForSettle > 1e-9 ? Math.round((profitWan / allocForSettle) * 10000) : P;
        success = profitWan > 0;
      }
    }

    const postVal = roundWan(allocForSettle + profitWan);
    const polLabel = ord.profitPolicy === 'reinvest' ? '滚存复利' : '上交公司';

    state.lastSettlementResults.push({
      businessId: ord.id,
      employeeId: emp.id,
      employeeName: emp.name,
      kind: ord.kind,
      P,
      profitWan,
      success,
      balance: postVal,
      profitPolicy: ord.profitPolicy,
    });

    if (postVal < 0) {
      state.pendingMargin.push({
        businessId: ord.id,
        employeeId: emp.id,
        employeeName: emp.name,
        balance: postVal,
        kind: ord.kind,
      });
      appendLog(
        state,
        `【警告】${emp.name}（${polLabel}）账户透支 ${postVal} 万，需续资或清算。`,
      );
      continue;
    }

    // 超额惩罚标记
    const exceededMark = exceededLimit ? '[超限收益减半] ' : '';

    if (ord.profitPolicy === 'reinvest') {
      ord.aumWan = postVal;
      appendLog(
        state,
        `【月结·复利】${emp.name} ${ord.kind === 'stock' ? '股票' : '期货'} ${exceededMark}P=${(P / 100).toFixed(2)}% 净利 ${profitWan} 万 → AUM ${ord.aumWan} 万。`,
      );
    } else {
      state.companyCashWan = roundWan(state.companyCashWan + profitWan);
      ord.aumWan = roundWan(ord.initialWan);
      appendLog(
        state,
        `【月结·上交】${emp.name} ${ord.kind === 'stock' ? '股票' : '期货'} ${exceededMark}P=${(P / 100).toFixed(2)}% 净利 ${profitWan} 万 → 划入公司；业务本金维持 ${ord.initialWan} 万。`,
      );
    }

    if (success) {
      emp.experienceMonths += 3;
      appendLog(state, `【经验】${emp.name} 业务成功，经验 +3。`);
    }
  }

  settleDividends(state, config);
  runEmployeeAiRebalance(state, config);

  try {
    updateListedSharePriceAfterSettlement(state);
  } catch (e) {
    console.error('updateListedSharePriceAfterSettlement', e);
  }

  try {
    appendMonthlyNetProfitChange(state);
  } catch (e) {
    console.error('appendMonthlyNetProfitChange', e);
  }

  for (const emp of state.employees) {
    emp.experienceMonths += 1;
  }

  for (const emp of state.employees) {
    const assigned = hasActiveBusiness(state, emp.id);
    if (!assigned) emp.idleStreakMonths += 1;
    else emp.idleStreakMonths = 0;
  }

  state.monthOrders = [];
  state.phase = state.pendingMargin.length ? 'margin' : 'market';
}

/** 月结后推进：离职/大事件 tick/小事件/翻月/月初扣款 */
export function closeMonthAndAdvance(state) {
  if (state.gameOver || state.victory) return;

  const closedY = state.year;
  const closedM = state.month;
  const majorSnap = JSON.parse(JSON.stringify(state.majorEffectStack || []));
  const divTotal = state._lastDividendTotalWan ?? 0;
  const divBreakSnap = JSON.parse(JSON.stringify(state._lastDividendBreakdown || []));
  const settleSnap = (state.lastSettlementResults || []).map((r) => ({ ...r }));

  // 记录公司财务数据（用于月度报告）
  const payrollTotal = getPayrollTotalWan(state);
  const rentTotal = getMonthlyRentTotalWan(state);
  const cashStart = state._monthStartCashWan ?? state.companyCashWan;
  const cashEnd = state.companyCashWan;

  checkResignations(state);
  tickMajorStack(state);
  rollMinorEvent(state, ymToMonthIndex(state.year, state.month), state.allowMinorEventThisMonth !== false);
  if (state.minorEventNote) appendLog(state, state.minorEventNote);

  state.monthReportData = buildMonthReportData({
    closedYear: closedY,
    closedMonth: closedM,
    majorStackSnapshot: majorSnap,
    minorEventNote: state.minorEventNote,
    settlementResults: settleSnap,
    dividendTotalWan: divTotal,
    dividendBreakdown: divBreakSnap,
    payrollTotalWan: payrollTotal,
    rentTotalWan: rentTotal,
    companyCashStartWan: cashStart,
    companyCashEndWan: cashEnd,
    activeBusinessesSnapshot: JSON.parse(JSON.stringify(state.activeBusinesses || [])),
  });
  state.showMonthReport = true;

  advanceCalendar(state);
  if (state.victory) {
    state.showMonthReport = false;
    state.monthReportData = null;
    return;
  }

  state.guidanceRemaining = 1;
  state.monthOrders = [];
  state.trainedThisMonth = false;
  state.trainedEmployeeId = null;
  state.majorEventNote = '';
  for (const e of state.employees) {
    e.hiredThisMonth = false;
  }
  runMonthOpening(state);
}

/** 点击「下月」：先月结，无透支则翻月并自动月初 */
export function dismissMonthReport(state) {
  if (state) {
    state.showMonthReport = false;
  }
}

export function endTurn(state, config) {
  if (state.gameOver || state.victory) return { ok: false, error: '游戏已结束' };
  if (state.pendingMargin.length) return { ok: false, error: '请先处理业务透支' };
  if (state.showMonthReport) return { ok: false, error: '请先阅毕月度报告' };

  runSettlement(state, config);
  if (state.pendingMargin.length) {
    state.phase = 'margin';
    return { ok: true, needMargin: true };
  }
  closeMonthAndAdvance(state);
  return { ok: true };
}

export function resolveMargin(state, businessId, action, extraPayWan) {
  const ix = state.pendingMargin.findIndex((m) => m.businessId === businessId);
  if (ix < 0) return { ok: false };
  const m = state.pendingMargin[ix];
  const biz = state.activeBusinesses.find((b) => b.id === businessId);

  if (action === 'topup') {
    const need = roundWan(-m.balance);
    const pay = Math.max(need, Number(extraPayWan) || need);
    if (state.companyCashWan + 1e-9 < pay) return { ok: false, error: '现金不足' };
    state.companyCashWan = roundWan(state.companyCashWan - pay);
    const newAum = roundWan(m.balance + pay);
    if (biz) biz.aumWan = Math.max(0, newAum);
    appendLog(state, `【续资】为 ${m.employeeName} 补足 ${pay} 万透支${biz ? `，业务 AUM=${biz.aumWan} 万` : ''}。`);
  } else {
    state.companyCashWan = roundWan(state.companyCashWan + m.balance);
    state.reputation = Math.max(0, state.reputation - 3);
    if (biz) {
      const bi = state.activeBusinesses.findIndex((b) => b.id === businessId);
      if (bi >= 0) state.activeBusinesses.splice(bi, 1);
    }
    appendLog(
      state,
      `【清算】终止 ${m.employeeName} 业务，损失计入公司，声誉 -3。`,
    );
  }
  state.pendingMargin.splice(ix, 1);
  if (!state.pendingMargin.length && !state.gameOver && !state.victory) {
    closeMonthAndAdvance(state);
  }
  return { ok: true };
}

/**
 * 培训接口（支持两种类型）
 * @param {object} state
 * @param {string} employeeId
 * @param {'general'|'industry'} type
 * @param {string} targetKey - 对于 general: 'leadership'|'innovation'|'execution'；对于 industry: industry id
 */
export function runTrain(state, employeeId, type = 'general', targetKey = 'leadership') {
  if (state.trainedThisMonth) return { ok: false, error: '本月培训名额已用' };
  const emp = state.employees.find((e) => e.id === employeeId);
  if (!emp) return { ok: false, error: '员工不存在' };
  if (hasActiveBusiness(state, emp.id)) return { ok: false, error: '该员工负责在营业务，不能培训' };

  if (type === 'general') {
    // 通用能力：单次 +1，费用 1 万（或可按目标值计算）
    const dim = targetKey;
    if (!['leadership', 'innovation', 'execution'].includes(dim)) return { ok: false, error: '无效的通用能力维度' };
    if ((emp[dim] || 0) >= 10) return { ok: false, error: `${dim} 已达上限` };
    const cost = 1; // 1 万元提高 1 点
    if (state.companyCashWan + 1e-9 < cost) return { ok: false, error: '现金不足' };
    state.companyCashWan = roundWan(state.companyCashWan - cost);
    emp[dim] = Math.min(10, (emp[dim] || 0) + 1);
    state.trainedThisMonth = true;
    state.trainedEmployeeId = emp.id;
    appendLog(state, `【培训】${emp.name} 的 ${dim} 提升至 ${emp[dim]}，花费 ${cost} 万。`);
    return { ok: true };
  }

  if (type === 'industry') {
    // 行业技术培训：单次 +5，费用 0.2 万/点 -> 5 点 = 1 万
    const ind = targetKey;
    if (!ind || !emp.industryTech) return { ok: false, error: '无效的行业' };
    if (typeof emp.industryTech[ind] !== 'number') return { ok: false, error: '该员工无该行业技术字段' };
    const delta = 5;
    const cost = roundWan(delta * 0.2);
    if (state.companyCashWan + 1e-9 < cost) return { ok: false, error: '现金不足' };
    state.companyCashWan = roundWan(state.companyCashWan - cost);
    emp.industryTech[ind] = Math.min(100, (emp.industryTech[ind] || 0) + delta);
    state.trainedThisMonth = true;
    state.trainedEmployeeId = emp.id;
    appendLog(state, `【培训】${emp.name} 的 ${ind} 行业技术提升 ${delta} 点 → ${emp.industryTech[ind]}，花费 ${cost} 万。`);
    return { ok: true };
  }

  return { ok: false, error: '未知培训类型' };
}

export function runPromote(state, employeeId) {
  const emp = state.employees.find((e) => e.id === employeeId);
  if (!emp || !canPromote(emp)) return { ok: false, error: '不满足晋升条件' };
  if (emp.tier === 'junior') emp.tier = 'mid';
  else if (emp.tier === 'mid') emp.tier = 'senior';
  appendLog(state, `【晋升】${emp.name} → ${emp.tier}。`);
  return { ok: true };
}

/** 修改员工名字 */
export function runRenameEmployee(state, employeeId, newName) {
  const emp = state.employees.find((e) => e.id === employeeId);
  if (!emp) return { ok: false, error: '员工不存在' };

  // 验证名字不为空且长度合理
  const trimmed = newName?.trim();
  if (!trimmed || trimmed.length === 0) return { ok: false, error: '名字不能为空' };
  if (trimmed.length > 20) return { ok: false, error: '名字过长（最多20字）' };

  const oldName = emp.name;
  emp.name = trimmed;
  appendLog(state, `【改名】${oldName} → ${trimmed}。`);
  return { ok: true };
}

/** 开除员工：支付遣散费，如果有在营业务需先结业 */
export function runFireEmployee(state, employeeId, config) {
  const empIndex = state.employees.findIndex((e) => e.id === employeeId);
  if (empIndex < 0) return { ok: false, error: '员工不存在' };
  const emp = state.employees[empIndex];

  // 检查是否有在营业务
  const biz = state.activeBusinesses.find((b) => b.employeeId === employeeId);
  if (biz) {
    return { ok: false, error: '该员工负责在营业务，请先结业其业务后再开除' };
  }

  // 计算遣散费
  const sev = severanceForEmployee(emp);
  if (state.companyCashWan + 1e-9 < sev) {
    return { ok: false, error: `现金不足支付遣散费 ${sev} 万` };
  }

  // 执行开除
  state.companyCashWan = roundWan(state.companyCashWan - sev);
  state.employees.splice(empIndex, 1);
  appendLog(state, `【开除】${emp.name}（${emp.tier}·能力${emp.ability}）遣散费 ${sev} 万。`);
  return { ok: true };
}

export function runLeaseOffice(state, gradeId) {
  const g = OFFICE_GRADES[gradeId];
  if (!g || !g.monthlyRentWan) return { ok: false, error: '无效等级' };
  if (state.year < g.unlockYear) return { ok: false, error: '尚未解锁该写字楼' };
  if (gradeId === 'small') return { ok: false, error: '已拥有小型办公室基准档位' };

  state.offices.push({
    kind: 'lease',
    gradeId,
    sinceYear: state.year,
    sinceMonth: state.month,
  });
  appendLog(state, `【租赁】${g.name}（+${g.capacity} 人），月租 ${g.monthlyRentWan} 万。`);
  return { ok: true };
}

export function runReleaseLease(state, officeIndex) {
  const o = state.offices[officeIndex];
  if (!o || o.kind !== 'lease') return { ok: false, error: '不可退租' };
  if (o.gradeId === 'small' && state.offices.filter((x) => x.kind === 'lease' && x.gradeId === 'small').length <= 1) {
    /* allow? initial small - doc says can 退租 - if only one small, might need to keep - simplify: forbid退租唯一小型 */
    return { ok: false, error: '保留至少一间基础办公空间' };
  }
  const g = OFFICE_GRADES[o.gradeId];
  const refund = roundWan(g.monthlyRentWan * LEASE_DEPOSIT_RETURN_RATIO);
  state.companyCashWan = roundWan(state.companyCashWan + refund);

  state.offices.splice(officeIndex, 1);
  const cap = getTotalCapacity(state);
  while (state.employees.length > cap) {
    const victim = state.employees[state.employees.length - 1];
    const sev = severanceForEmployee(victim);
    state.companyCashWan = roundWan(state.companyCashWan - sev);
    appendLog(state, `【裁员】${victim.name} 遣散费 ${sev} 万。`);
    state.employees.pop();
  }
  appendLog(state, `【退租】${g.name}，返还押金约 ${refund} 万。`);
  return { ok: true };
}

export function runPurchaseOffice(state, gradeId) {
  const g = OFFICE_GRADES[gradeId];
  if (!g || !g.purchasePriceWan) return { ok: false, error: '不可购买' };
  if (state.year < 2010) return { ok: false, error: '2010 年后可购楼' };
  if (state.year < g.unlockYear) return { ok: false, error: '该等级尚未解锁' };
  const price = g.purchasePriceWan;
  if (state.companyCashWan + 1e-9 < price) return { ok: false, error: '现金不足' };

  state.companyCashWan = roundWan(state.companyCashWan - price);
  state.offices.push({
    kind: 'owned',
    gradeId,
    sinceYear: state.year,
    sinceMonth: state.month,
    purchasePriceWan: price,
  });
  appendLog(state, `【购楼】${g.name}，一次性支付 ${price} 万，免月租，每年 1 月按购价 1% 物业税。`);
  return { ok: true };
}

export function runSellOwnedOffice(state, officeIndex) {
  const o = state.offices[officeIndex];
  if (!o || o.kind !== 'owned') return { ok: false, error: '非自有物业' };
  const g = OFFICE_GRADES[o.gradeId];
  const heldMonths =
    (state.year - o.sinceYear) * 12 + (state.month - o.sinceMonth);
  const dep = Math.max(0.5, 1 - heldMonths * 0.002);
  const price = roundWan((o.purchasePriceWan || g.purchasePriceWan) * dep);
  state.companyCashWan = roundWan(state.companyCashWan + price);
  state.offices.splice(officeIndex, 1);

  const cap = getTotalCapacity(state);
  while (state.employees.length > cap) {
    const victim = state.employees[state.employees.length - 1];
    const sev = severanceForEmployee(victim);
    state.companyCashWan = roundWan(state.companyCashWan - sev);
    appendLog(state, `【裁员】${victim.name} 遣散费 ${sev} 万。`);
    state.employees.pop();
  }
  appendLog(state, `【售楼】${g.name} 折旧回收约 ${price} 万。`);
  return { ok: true };
}

export function checkResignations(state) {
  const monthIndex = ymToMonthIndex(state.year, state.month);
  const toRemove = [];
  for (const emp of state.employees) {
    if (emp.loyalty >= 3) continue;
    if (emp.idleStreakMonths < 2) continue;
    const h = majorEventTriggerH(state.gameSeed, monthIndex, emp.id.length + emp.id.charCodeAt(1));
    if ((h % 100) < 5) toRemove.push(emp);
  }
  for (const emp of toRemove) {
    const hasOrder = hasActiveBusiness(state, emp.id);
    if (hasOrder) {
      appendLog(state, `【离职】${emp.name} 尝试离职但因负责业务未果（演示：强制清算由玩家处理）。`);
      continue;
    }
    appendLog(state, `【离职】${emp.name}（忠诚过低且长期闲置）离开公司。`);
    state.employees = state.employees.filter((e) => e.id !== emp.id);
  }
}

export function advanceCalendar(state) {
  if (state.year === 2020 && state.month === 12) {
    state.victory = true;
    state.phase = 'victory';
    appendLog(state, `【终局】2020 年 12 月已结算，最终现金 ${state.companyCashWan} 万。`);
    return;
  }
  if (state.month === 12) {
    state.year += 1;
    state.month = 1;
  } else {
    state.month += 1;
  }
}

/** @deprecated 使用 endTurn */
export function finalizeMonth(state, config) {
  return endTurn(state, config);
}

export function serializeState(state) {
  return JSON.stringify({
    ...state,
  });
}

export function deserializeState(json) {
  const o = JSON.parse(json);
  if (o.schemaVersion !== SCHEMA_VERSION) throw new Error('存档版本不兼容');
  return o;
}
