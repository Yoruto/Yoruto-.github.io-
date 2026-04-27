/**
 * startupInvest - v0.5.2 基础骨架
 * - 加载配置与项目名池
 * - 生成随机 BP（商业计划书）用于前端展示
 */
import { nextId, appendLog, roundWan } from './state.js';
import { mixUint32, ymToMonthIndex } from './rng.js';
import { getMacroConfigSync, getMacroLineIdByIndustry } from './macro.js';

let _cfg = null;
let _names = null;

async function loadCfg() {
  if (_cfg) return _cfg;
  const tryPaths = [
    '../../../data/investment-sim/startup-invest.json',
    '/data/investment-sim/startup-invest.json',
  ];
  for (const path of tryPaths) {
    try {
      const res = await fetch(path);
      if (res.ok) {
        _cfg = await res.json();
        return _cfg;
      }
    } catch (e) {
      // try next path
    }
  }
  // Node.js environment fallback: read file via fs
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    const { promises: fs } = await import('fs');
    const p = new URL('../../../data/investment-sim/startup-invest.json', import.meta.url);
    const txt = await fs.readFile(p, 'utf8');
    _cfg = JSON.parse(txt);
    return _cfg;
  }
  throw new Error('无法加载 startup-invest 数据');
}

async function loadNames() {
  if (_names) return _names;
  const tryPaths = [
    '../../../data/investment-sim/startup-projects.json',
    '/data/investment-sim/startup-projects.json',
  ];
  for (const path of tryPaths) {
    try {
      const res = await fetch(path);
      if (res.ok) {
        _names = await res.json();
        return _names;
      }
    } catch (e) {
      // try next path
    }
  }
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    const { promises: fs } = await import('fs');
    const p = new URL('../../../data/investment-sim/startup-projects.json', import.meta.url);
    const txt = await fs.readFile(p, 'utf8');
    _names = JSON.parse(txt);
    return _names;
  }
  throw new Error('无法加载 startup-projects 数据');
}

function choice(arr, idx) {
  if (!arr || !arr.length) return null;
  return arr[idx % arr.length];
}

export async function generateBPs(count = 3, year = 2000, seed = 0) {
  const cfg = await loadCfg();
  const n = await loadNames();
  const industries = Object.keys(n.projectsByIndustry || {});
  const out = [];
  for (let i = 0; i < count; i++) {
    const ind = industries[(seed + i) % industries.length];
    const names = n.projectsByIndustry[ind];
    const projectName = choice(names, seed + i) || `项目${i}`;
    // choose a round available by year (simplified)
    const rounds = cfg.investmentRounds.filter((r) => (year || 2000) >= (r.unlockYear || 1990));
    const round = rounds[(seed + i) % rounds.length] || rounds[0];
    const valuation = Math.round((round.minValuationWan + round.maxValuationWan) / 2);
    const raise = Math.round(((round.typicalRaiseWan && round.typicalRaiseWan[0]) || 100) * 1);
    out.push({ id: `bp-${seed}-${i}`, name: projectName, industry: ind, round: round.round, valuationWan: valuation, raiseWan: raise });
  }
  return out;
}

export async function loadStartupConfig() {
  const cfg = await loadCfg();
  await loadNames();
  return cfg;
}

/**
 * 配置与项目名表已预加载时同步生成 BP（主界面新开业务用）
 */
export function generateBPsSync(count = 5, year = 2000, seed = 0) {
  if (!_cfg || !_names) return [];
  const cfg = _cfg;
  const n = _names;
  const industries = Object.keys(n.projectsByIndustry || {});
  const out = [];
  for (let i = 0; i < count; i++) {
    const ind = industries[(seed + i) % industries.length];
    const names = n.projectsByIndustry[ind];
    const projectName = choice(names, seed + i) || `项目${i}`;
    const rounds = (cfg.investmentRounds || []).filter((r) => (year || 2000) >= (r.unlockYear || 1990));
    const round = rounds[(seed + i) % rounds.length] || rounds[0];
    if (!round) continue;
    const valuation = Math.round((round.minValuationWan + round.maxValuationWan) / 2);
    const raise = Math.round(((round.typicalRaiseWan && round.typicalRaiseWan[0]) || 100) * 1);
    out.push({ id: `bp-${seed}-${i}`, name: projectName, industry: ind, round: round.round, valuationWan: valuation, raiseWan: raise });
  }
  return out;
}

export function clearCache() {
  _cfg = null;
  _names = null;
}


/** Start an investment into a startup (创建 BP 并投入资金) */
export async function startStartupInvestment(state, employeeId, bpDraft) {
  const emp = state.employees.find((e) => e.id === employeeId);
  if (!emp) return { ok: false, error: '员工不存在' };
  // lightweight local check to avoid circular import with monthEngine
  if (emp.hiredThisMonth) return { ok: false, error: '员工不可新开业务（本月刚入职）' };
  if (state.activeBusinesses && state.activeBusinesses.some((b) => b.employeeId === emp.id)) return { ok: false, error: '员工不可新开业务（已有在营业务）' };
  const cfg = await loadCfg();
  const roundCfg = (cfg.investmentRounds || []).find((r) => r.round === bpDraft.round);
  if (!roundCfg) return { ok: false, error: '无效轮次' };
  const investWan = Number(bpDraft.investWan) || Math.round((roundCfg.typicalRaiseWan?.[0] || 100));
  const ddCost = roundWan(investWan * 0.02);
  if (state.companyCashWan + 1e-9 < ddCost + investWan) return { ok: false, error: '公司现金不足（需含尽调费和投资金额）' };
  // 扣除尽调费和投资款
  state.companyCashWan = roundWan(state.companyCashWan - ddCost - investWan);
  const id = nextId(state, 'b');
  const rngOrderSlot = (state.businessRngSlotSeq = (state.businessRngSlotSeq || 0) + 1) - 1;
  const valuation = Number(bpDraft.valuationWan) || Math.round((roundCfg.minValuationWan + roundCfg.maxValuationWan) / 2);
  const ord = {
    id,
    employeeId: emp.id,
    kind: 'startup_invest',
    name: bpDraft.name || `BP-${id}`,
    industry: bpDraft.industry || 'tech',
    round: roundCfg.round,
    investedWan: investWan,
    valuationWan: valuation,
    equityPercent: Number(bpDraft.equityPercent) || Math.round((investWan / Math.max(1, valuation)) * 100),
    elapsedMonths: 0,
    checkIntervalMonths: roundCfg.checkIntervalMonths || 6,
    rngOrderSlot,
  };
  state.activeBusinesses.push(ord);
  appendLog(state, `【初创·投资】${emp.name} 对「${ord.name}」投入 ${investWan} 万（轮次 ${ord.round}）。`);
  return { ok: true, businessId: id };
}

/**
 * 每月推进 startup_invest 项目：按轮次配置每 N 月检查一次，可能进入下一轮/被收购/破产/IPO。
 * 返回 true 表示已处理并跳过通用结算逻辑。
 */
export function processStartupMonthly(state, ord) {
  if (!ord || ord.kind !== 'startup_invest') return false;
  const cfg = _cfg || null;
  if (!cfg) return false;
  const rounds = cfg.investmentRounds || [];
  const roundCfg = rounds.find((r) => r.round === ord.round);
  const emp = state.employees.find((e) => e.id === ord.employeeId) || { name: '—' };
  ord.elapsedMonths = (ord.elapsedMonths || 0) + 1;
  if (ord.elapsedMonths < (ord.checkIntervalMonths || (roundCfg?.checkIntervalMonths || 6))) {
    // not time yet
    return true;
  }
  // 时间到，进行一次命运判定
  ord.elapsedMonths = 0;
  const mi = ymToMonthIndex(state.year, state.month);
  const h = mixUint32(state.gameSeed >>> 0, [mi, ord.rngOrderSlot || 0, ord.investedWan | 0]);
  const r0 = (h % 10000) / 10000;
  const pNext0 = roundCfg?.nextRoundProbability || 0.3;
  const pAcq0 = roundCfg?.acquiredProbability || 0.05;
  let pBank = roundCfg?.bankruptProbability || 0.15;
  const pIpo0 = roundCfg?.ipoProbability || 0;
  if (state.macro?.lines) {
    const lineId = getMacroLineIdByIndustry(ord.industry || 'tech', getMacroConfigSync());
    const cInd = state.macro.lines[lineId]?.c ?? 2;
    pBank = Math.min(0.45, Math.max(0.04, pBank * (1.15 - 0.12 * cInd)));
    if (state.macro.baseRate > 8) pBank = Math.min(0.5, pBank * 1.1);
  }
  const pNext = pNext0;
  const pAcq = pAcq0;
  const pIpo = pIpo0;
  const r = r0;
  // normalize order: bankrupt, acquired, ipo, nextRound, survival fallback
  if (r < pBank) {
    appendLog(state, `【初创·破产】${ord.name} 在 ${ord.round} 阶段破产，投资归零。`);
    const ix = state.activeBusinesses.findIndex((b) => b.id === ord.id);
    if (ix >= 0) state.activeBusinesses.splice(ix, 1);
    return true;
  }
  if (r < pBank + pAcq) {
    // 收购：收益 1.5~3x
    const mult = 1.5 + ((h >>> 8) % 1501) / 1000; // 1.5 ~ 3.0
    const proceeds = roundWan(ord.investedWan * mult);
    state.companyCashWan = roundWan(state.companyCashWan + proceeds);
    appendLog(state, `【初创·被收购】${ord.name} 被收购，获得回报 ${proceeds} 万（倍数 ${(mult).toFixed(2)}x）。`);
    const ix2 = state.activeBusinesses.findIndex((b) => b.id === ord.id);
    if (ix2 >= 0) state.activeBusinesses.splice(ix2, 1);
    return true;
  }
  if (r < pBank + pAcq + pIpo) {
    // IPO：2~5x
    const mult = 2 + ((h >>> 12) % 3001) / 1000; // 2.0 ~ 5.0
    const proceeds2 = roundWan(ord.investedWan * mult);
    state.companyCashWan = roundWan(state.companyCashWan + proceeds2);
    appendLog(state, `【初创·IPO】${ord.name} IPO，获得回报 ${proceeds2} 万（倍数 ${(mult).toFixed(2)}x）。`);
    const ix3 = state.activeBusinesses.findIndex((b) => b.id === ord.id);
    if (ix3 >= 0) state.activeBusinesses.splice(ix3, 1);
    return true;
  }
  if (r < pBank + pAcq + pIpo + pNext) {
    // 进入下一轮：提升轮次、估值上升
    const idx = rounds.findIndex((rr) => rr.round === ord.round);
    if (idx >= 0 && idx + 1 < rounds.length) {
      const next = rounds[idx + 1];
      ord.round = next.round;
      // simple valuation bump
      ord.valuationWan = Math.round((next.minValuationWan + next.maxValuationWan) / 2);
      appendLog(state, `【初创·晋级】${ord.name} 进入 ${ord.round}，估值调整为 ${ord.valuationWan} 万。`);
    } else {
      appendLog(state, `【初创】${ord.name} 达到当前已配置最高轮次，维持观望。`);
    }
    return true;
  }
  // 生存：维持现状
  appendLog(state, `【初创·维持】${ord.name} 本轮维持，继续观望。`);
  return true;
}
