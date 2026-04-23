import { OFFICE_GRADES, RECRUIT_COST_WAN, SEVERANCE_MONTHS_PAY } from './tables.js';
import { randomEmployeeNameForSeed } from './rng.js';

/** 仅与当前开发构建一致；不兼容旧存档 */
export const SCHEMA_VERSION = 5;

/** 万元精确到 0.0001（对应 1 元人民币） */
export function roundWan(x) {
  if (x == null || !Number.isFinite(Number(x))) return 0;
  return Math.round(Number(x) * 10000) / 10000;
}

export function nextId(state, prefix) {
  if (typeof state.idSeq !== 'number') state.idSeq = 0;
  state.idSeq += 1;
  return `${prefix}${state.idSeq.toString(36)}`;
}

/**
 * 月薪（万）：基础 0.5，每工作满 12 个月 +0.1（与职级/能力无关）
 */
export function employeeMonthlySalaryWan(emp) {
  const m = Math.max(0, emp.experienceMonths | 0);
  const years = Math.floor(m / 12);
  return roundWan(0.5 + 0.1 * years);
}

export function recruitTierAllowed(year, tier) {
  if (tier === 'junior') return year <= 2020;
  if (tier === 'mid') return year >= 1996;
  if (tier === 'senior') return year >= 2006;
  return false;
}

export function canPromote(emp) {
  if (emp.tier === 'junior') {
    return emp.experienceMonths >= 24 && emp.ability >= 5;
  }
  if (emp.tier === 'mid') {
    return emp.experienceMonths >= 60 && emp.ability >= 7;
  }
  return false;
}

export function trainingCostWan(abilityAfterTraining) {
  return abilityAfterTraining * 1;
}

export function createInitialState(gameSeed) {
  const state0 = { idSeq: 0 };
  const seed = (gameSeed >>> 0) || 1;
  let n1 = randomEmployeeNameForSeed(seed, 0);
  let n2 = randomEmployeeNameForSeed(seed, 1);
  if (n1 === n2) n2 = `${n2}乙`;
  const e1 = {
    id: nextId(state0, 'e'),
    name: n1,
    tier: 'junior',
    ability: 5,
    loyalty: 6,
    experienceMonths: 0,
    hiredYearMonth: { year: 1990, month: 1 },
    hiredThisMonth: false,
    trainingScheduled: false,
    idleStreakMonths: 0,
    aiStyle: 'momentum',
    lastRebalanceMonth: null,
  };
  const e2 = {
    id: nextId(state0, 'e'),
    name: n2,
    tier: 'junior',
    ability: 4,
    loyalty: 7,
    experienceMonths: 0,
    hiredYearMonth: { year: 1990, month: 1 },
    hiredThisMonth: false,
    trainingScheduled: false,
    idleStreakMonths: 0,
    aiStyle: 'dividend',
    lastRebalanceMonth: null,
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    idSeq: state0.idSeq,
    gameSeed: (gameSeed >>> 0) || 1,
    year: 1990,
    month: 1,
    phase: 'opening',
    companyCashWan: 80,
    reputation: 50,
    offices: [
      { kind: 'lease', gradeId: 'small', sinceYear: 1990, sinceMonth: 1 },
    ],
    employees: [e1, e2],
    /** 持久在营业务；滚存=reinvest 时 aumWan 按月复利 */
    activeBusinesses: [],
    /** 每条业务固定 RNG 槽位，保证可复现 */
    businessRngSlotSeq: 0,
    monthOrders: [],
    guidanceRemaining: 1,
    actualEquityC: 2,
    actualCommodityC: 2,
    predictedEquityC: 2,
    predictedCommodityC: 2,
    majorEffectStack: [],
    majorFiredKeys: [],
    /** 下月随机大事件判定用概率（%），未触发时累加 5，触发后重置 5 */
    randomMajorP: 5,
    monthLog: [],
    pendingMargin: [],
    lastSettlementResults: [],
    gameOver: false,
    gameOverReason: '',
    victory: false,
    talentPool: [],
    talentPoolRefreshIndex: 0,
    /** 0.2 月结报告弹窗 */
    showMonthReport: false,
    monthReportData: null,
    trainedThisMonth: false,
    trainedEmployeeId: null,
    /** P1+ 事件 */
    minorEventNote: '',
    majorEventNote: '',
    allowMinorEventThisMonth: true,
  };
}

export function getTotalCapacity(state) {
  return state.offices.reduce((s, o) => {
    const g = OFFICE_GRADES[o.gradeId];
    return s + (g ? g.capacity : 0);
  }, 0);
}

export function getMonthlyRentTotalWan(state) {
  let t = 0;
  for (const o of state.offices) {
    if (o.kind === 'lease') {
      const g = OFFICE_GRADES[o.gradeId];
      if (g) t += g.monthlyRentWan;
    }
  }
  return t;
}

export function getPayrollTotalWan(state) {
  return roundWan(state.employees.reduce((s, e) => s + employeeMonthlySalaryWan(e), 0));
}

export function appendLog(state, text) {
  const key = `${state.year}-${String(state.month).padStart(2, '0')}`;
  state.monthLog.push({ key, text });
}

export function severanceForEmployee(emp) {
  return roundWan(employeeMonthlySalaryWan(emp) * SEVERANCE_MONTHS_PAY);
}

export function recruitCostForTier(tier) {
  if (tier === 'junior') return RECRUIT_COST_WAN.junior;
  if (tier === 'mid') return RECRUIT_COST_WAN.mid;
  return RECRUIT_COST_WAN.senior;
}
