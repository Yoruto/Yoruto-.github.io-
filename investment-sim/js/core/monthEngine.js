import {
  ymToMonthIndex,
  rollMacroC,
  rollPredictedC,
  majorEventTriggerH,
  rollRecruitStats,
} from './rng.js';
import { settleMonthlyOrder, computePortfolioBetaExtraBp, computePortfolioSectorBp } from './settlement.js';
import { generateEmployeeStockPortfolio } from './rng.js';
import {
  appendLog,
  getMonthlyRentTotalWan,
  getPayrollTotalWan,
  getTotalCapacity,
  nextId,
  recruitCostForTier,
  recruitTierAllowed,
  severanceForEmployee,
  tierSalaryWan,
  trainingCostWan,
  canPromote,
  SCHEMA_VERSION,
} from './state.js';
import {
  OFFICE_GRADES,
  LEASE_DEPOSIT_RETURN_RATIO,
} from './tables.js';
import {
  pushDueMajorEvents,
  applyMajorStackToC,
  tickMajorStack,
  rollMinorEvent,
} from './events.js';

function round1(x) {
  return Math.round(x * 10) / 10;
}

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
        tax += round1(o.purchasePriceWan * (OFFICE_GRADES[o.gradeId]?.propertyTaxRate ?? 0));
      }
    }
  }

  const mustPay = round1(payroll + rent + tax);
  state.companyCashWan = round1(state.companyCashWan);
  if (state.companyCashWan < mustPay - 1e-9) {
    state.gameOver = true;
    state.gameOverReason = `现金不足以支付刚性支出（工资+租金+税 ${mustPay} 万）。`;
    appendLog(state, state.gameOverReason);
    state.phase = 'game_over';
    return;
  }

  state.companyCashWan = round1(state.companyCashWan - mustPay);
  appendLog(
    state,
    `【月初扣款】工资 ${round1(payroll)} 万，写字楼支出 ${round1(rent + tax)} 万（含物业税 ${round1(tax)} 万）。`,
  );

  const idx = ymToMonthIndex(state.year, state.month);
  const baseEq = rollMacroC(state.gameSeed, idx, 'equity');
  const baseCo = rollMacroC(state.gameSeed, idx, 'commodity');
  const applied = applyMajorStackToC(state, baseEq, baseCo);
  state.actualEquityC = applied.equityC;
  state.actualCommodityC = applied.commodityC;

  state.predictedEquityC = rollPredictedC(state.gameSeed, idx + 1, 'equity');
  state.predictedCommodityC = rollPredictedC(state.gameSeed, idx + 1, 'commodity');

  state.phase = 'market';
}

export function hasActiveBusiness(state, employeeId) {
  return state.activeBusinesses.some((b) => b.employeeId === employeeId);
}

export function employeeCanDeploy(state, emp) {
  if (emp.hiredThisMonth) return false;
  if (hasActiveBusiness(state, emp.id)) return false;
  return true;
}

/**
 * @param {'remit'|'reinvest'} profitPolicy — reinvest=滚存复利（利润并入 aumWan 参与下月结算）
 */
export function addActiveBusiness(state, orderDraft, config) {
  const emp = state.employees.find((e) => e.id === orderDraft.employeeId);
  if (!emp || !employeeCanDeploy(state, emp)) return { ok: false, error: '员工不可新开业务' };

  const alloc = Number(orderDraft.allocWan);
  if (!Number.isFinite(alloc) || alloc <= 0) return { ok: false, error: '金额无效' };

  if (orderDraft.kind === 'stock') {
    if (alloc < 1 || alloc > 100) return { ok: false, error: '股票调拨须在 1~100 万' };
  } else {
    if (alloc < 1 || alloc > 50) return { ok: false, error: '期货调拨须在 1~50 万' };
  }

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

  const stockList = config?.stocks?.length ? config.stocks : [];
  const stockPortfolio =
    orderDraft.kind === 'stock'
      ? generateEmployeeStockPortfolio(
          state.gameSeed,
          ymToMonthIndex(state.year, state.month),
          rngOrderSlot,
          emp.id,
          stockList,
        )
      : [];

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
    futuresVariantId,
    stockGuideMode,
    leverage,
    rngOrderSlot,
  });

  state.companyCashWan = round1(state.companyCashWan - alloc);

  const polLabel = profitPolicy === 'reinvest' ? '滚存复利' : '上交公司';
  const portHint =
    orderDraft.kind === 'stock' && stockPortfolio.length
      ? ` 组合：${stockPortfolio.map((p) => `${p.stockId}:${(p.weightBp / 100).toFixed(1)}%`).join(' ')}`
      : '';
  appendLog(
    state,
    `【开业】${emp.name} ${orderDraft.kind === 'stock' ? '股票' : '期货'} 本金 ${alloc} 万 · ${polLabel}${portHint}。`,
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
    if (Number.isFinite(d)) aumDelta = round1(d);
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
      const out = round1(-aumDelta);
      const nextAum = round1(b.aumWan - out);
      if (nextAum + 1e-9 < GUIDE_MIN_AUM_WAN) {
        return { ok: false, error: `减资后 AUM 须不少于 ${GUIDE_MIN_AUM_WAN} 万` };
      }
      if (b.profitPolicy === 'remit') {
        const nextInit = round1(b.initialWan - out);
        if (nextInit + 1e-9 < GUIDE_MIN_AUM_WAN) {
          return { ok: false, error: `减资后上交本金须不少于 ${GUIDE_MIN_AUM_WAN} 万` };
        }
      }
    }
    state.companyCashWan = round1(state.companyCashWan - aumDelta);
    b.aumWan = round1(b.aumWan + aumDelta);
    if (b.profitPolicy === 'remit') b.initialWan = round1(b.initialWan + aumDelta);
    changed = true;
    detailParts.push(aumDelta > 0 ? `增资${aumDelta}万` : `减资${round1(-aumDelta)}万`);
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
  const back = round1(b.aumWan);
  state.companyCashWan = round1(state.companyCashWan + back);
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

export function runSettlement(state, config) {
  const monthIndex = ymToMonthIndex(state.year, state.month);
  state.lastSettlementResults = [];
  state.pendingMargin = [];

  const lines = [...state.activeBusinesses].sort((a, b) => a.rngOrderSlot - b.rngOrderSlot);

  for (const ord of lines) {
    const emp = state.employees.find((e) => e.id === ord.employeeId);
    if (!emp) continue;

    const allocForSettle =
      ord.profitPolicy === 'remit' ? ord.initialWan : round1(ord.aumWan);
    if (allocForSettle <= 0) continue;

    let portfolioBetaBp = 0;
    let portfolioSectorBp = 0;
    if (ord.kind === 'stock') {
      portfolioBetaBp = computePortfolioBetaExtraBp(ord.stockPortfolio, config.stocks);
      portfolioSectorBp = computePortfolioSectorBp(ord.stockPortfolio, config.stocks, config.sectors);
      if ((!ord.stockPortfolio || ord.stockPortfolio.length === 0) && ord.stockId) {
        const st = config.stocks.find((s) => s.id === ord.stockId);
        portfolioBetaBp = st?.betaExtraBp ?? 0;
        const sec = config.sectors?.find((s) => s.id === st?.sectorId);
        portfolioSectorBp = sec?.sectorBetaBp ?? 0;
      }
    }

    const futRow =
      ord.kind === 'fut'
        ? config.futures.variants[ord.futuresVariantId].B_fut_bp_by_c
        : null;

    const cMacro = ord.kind === 'stock' ? state.actualEquityC : state.actualCommodityC;

    const { P, profitWan, success } = settleMonthlyOrder({
      kind: ord.kind,
      cMacro,
      ability: emp.ability,
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
    });

    const postVal = round1(allocForSettle + profitWan);
    const polLabel = ord.profitPolicy === 'reinvest' ? '滚存复利' : '上交公司';

    state.lastSettlementResults.push({
      businessId: ord.id,
      employeeId: emp.id,
      employeeName: emp.name,
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

    if (ord.profitPolicy === 'reinvest') {
      ord.aumWan = postVal;
      appendLog(
        state,
        `【月结·复利】${emp.name} ${ord.kind === 'stock' ? '股票' : '期货'} P=${(P / 100).toFixed(2)}% 净利 ${profitWan} 万 → AUM ${ord.aumWan} 万。`,
      );
    } else {
      state.companyCashWan = round1(state.companyCashWan + profitWan);
      ord.aumWan = round1(ord.initialWan);
      appendLog(
        state,
        `【月结·上交】${emp.name} ${ord.kind === 'stock' ? '股票' : '期货'} P=${(P / 100).toFixed(2)}% 净利 ${profitWan} 万 → 划入公司；业务本金维持 ${ord.initialWan} 万。`,
      );
    }

    if (success) {
      emp.experienceMonths += 3;
      appendLog(state, `【经验】${emp.name} 业务成功，经验 +3。`);
    }
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

  checkResignations(state);
  tickMajorStack(state);
  rollMinorEvent(state, ymToMonthIndex(state.year, state.month), state.allowMinorEventThisMonth !== false);
  if (state.minorEventNote) appendLog(state, state.minorEventNote);

  advanceCalendar(state);
  if (state.victory) return;

  state.guidanceRemaining = 1;
  state.monthOrders = [];
  state.recruitCountThisMonth = 0;
  state.trainedThisMonth = false;
  state.trainedEmployeeId = null;
  state.majorEventNote = '';
  for (const e of state.employees) {
    e.hiredThisMonth = false;
  }
  runMonthOpening(state);
}

/** 点击「下月」：先月结，无透支则翻月并自动月初 */
export function endTurn(state, config) {
  if (state.gameOver || state.victory) return { ok: false, error: '游戏已结束' };
  if (state.pendingMargin.length) return { ok: false, error: '请先处理业务透支' };

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
    const need = round1(-m.balance);
    const pay = Math.max(need, Number(extraPayWan) || need);
    if (state.companyCashWan + 1e-9 < pay) return { ok: false, error: '现金不足' };
    state.companyCashWan = round1(state.companyCashWan - pay);
    const newAum = round1(m.balance + pay);
    if (biz) biz.aumWan = Math.max(0, newAum);
    appendLog(state, `【续资】为 ${m.employeeName} 补足 ${pay} 万透支${biz ? `，业务 AUM=${biz.aumWan} 万` : ''}。`);
  } else {
    state.companyCashWan = round1(state.companyCashWan + m.balance);
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

export function runRecruit(state, tier) {
  if (!recruitTierAllowed(state.year, tier)) return { ok: false, error: '该职级此年代不可招聘' };
  const cap = getTotalCapacity(state);
  if (state.employees.length >= cap) return { ok: false, error: '容量已满' };
  const cost = recruitCostForTier(tier);
  if (state.companyCashWan + 1e-9 < cost) return { ok: false, error: '现金不足' };

  const slot = state.recruitCountThisMonth;
  const stats = rollRecruitStats(state.gameSeed, ymToMonthIndex(state.year, state.month), slot);

  state.companyCashWan = round1(state.companyCashWan - cost);
  state.recruitCountThisMonth += 1;

  const tierKey = tier === 'junior' ? 'junior' : tier === 'mid' ? 'mid' : 'senior';
  const name = `新人${state.recruitCountThisMonth}`;
  state.employees.push({
    id: nextId(state, 'e'),
    name,
    tier: tierKey,
    ability: stats.ability,
    loyalty: stats.loyalty,
    experienceMonths: 0,
    hiredYearMonth: { year: state.year, month: state.month },
    hiredThisMonth: true,
    trainingScheduled: false,
    idleStreakMonths: 0,
  });
  appendLog(state, `【招聘】${name}（${tierKey}）能力${stats.ability} 忠诚${stats.loyalty}，费用 ${cost} 万。`);
  return { ok: true };
}

export function runTrain(state, employeeId) {
  if (state.trainedThisMonth) return { ok: false, error: '本月培训名额已用' };
  const emp = state.employees.find((e) => e.id === employeeId);
  if (!emp) return { ok: false, error: '员工不存在' };
  if (emp.ability >= 10) return { ok: false, error: '能力已满' };
  if (hasActiveBusiness(state, emp.id)) return { ok: false, error: '该员工负责在营业务，不能培训' };

  const nextAb = emp.ability + 1;
  const cost = trainingCostWan(nextAb);
  if (state.companyCashWan + 1e-9 < cost) return { ok: false, error: '现金不足' };

  state.companyCashWan = round1(state.companyCashWan - cost);
  emp.ability = nextAb;
  state.trainedThisMonth = true;
  state.trainedEmployeeId = emp.id;
  appendLog(state, `【培训】${emp.name} 能力提升至 ${emp.ability}，花费 ${cost} 万。`);
  return { ok: true };
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
  state.companyCashWan = round1(state.companyCashWan - sev);
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
  const refund = round1(g.monthlyRentWan * LEASE_DEPOSIT_RETURN_RATIO);
  state.companyCashWan = round1(state.companyCashWan + refund);

  state.offices.splice(officeIndex, 1);
  const cap = getTotalCapacity(state);
  while (state.employees.length > cap) {
    const victim = state.employees[state.employees.length - 1];
    const sev = severanceForEmployee(victim);
    state.companyCashWan = round1(state.companyCashWan - sev);
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

  state.companyCashWan = round1(state.companyCashWan - price);
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
  const price = round1((o.purchasePriceWan || g.purchasePriceWan) * dep);
  state.companyCashWan = round1(state.companyCashWan + price);
  state.offices.splice(officeIndex, 1);

  const cap = getTotalCapacity(state);
  while (state.employees.length > cap) {
    const victim = state.employees[state.employees.length - 1];
    const sev = severanceForEmployee(victim);
    state.companyCashWan = round1(state.companyCashWan - sev);
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
