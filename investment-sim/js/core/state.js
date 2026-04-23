import { OFFICE_GRADES, RECRUIT_COST_WAN, SEVERANCE_MONTHS_PAY } from './tables.js';

/** 仅与当前开发构建一致；不兼容旧存档 */
export const SCHEMA_VERSION = 3;

export function nextId(state, prefix) {
  if (typeof state.idSeq !== 'number') state.idSeq = 0;
  state.idSeq += 1;
  return `${prefix}${state.idSeq.toString(36)}`;
}

export function tierSalaryWan(tier, ability) {
  const a = Math.max(1, Math.min(10, ability | 0));
  if (tier === 'junior') return 0.3 + a * 0.05;
  if (tier === 'mid') return 0.8 + a * 0.1;
  return 2.0 + a * 0.2;
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
  const e1 = {
    id: nextId(state0, 'e'),
    name: 'MMZ',
    tier: 'junior',
    ability: 5,
    loyalty: 6,
    experienceMonths: 0,
    hiredYearMonth: { year: 1990, month: 1 },
    hiredThisMonth: false,
    trainingScheduled: false,
    idleStreakMonths: 0,
  };
  const e2 = {
    id: nextId(state0, 'e'),
    name: 'CCZ',
    tier: 'junior',
    ability: 3,
    loyalty: 5,
    experienceMonths: 0,
    hiredYearMonth: { year: 1990, month: 1 },
    hiredThisMonth: false,
    trainingScheduled: false,
    idleStreakMonths: 0,
  };
  const e3 = {
    id: nextId(state0, 'e'),
    name: 'HHZ',
    tier: 'junior',
    ability: 4,
    loyalty: 7,
    experienceMonths: 0,
    hiredYearMonth: { year: 1990, month: 1 },
    hiredThisMonth: false,
    trainingScheduled: false,
    idleStreakMonths: 0,
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
    employees: [e1, e2, e3],
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
    monthLog: [],
    pendingMargin: [],
    lastSettlementResults: [],
    gameOver: false,
    gameOverReason: '',
    victory: false,
    recruitCountThisMonth: 0,
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
  return state.employees.reduce((s, e) => s + tierSalaryWan(e.tier, e.ability), 0);
}

export function appendLog(state, text) {
  const key = `${state.year}-${String(state.month).padStart(2, '0')}`;
  state.monthLog.push({ key, text });
}

export function severanceForEmployee(emp) {
  return tierSalaryWan(emp.tier, emp.ability) * SEVERANCE_MONTHS_PAY;
}

export function recruitCostForTier(tier) {
  if (tier === 'junior') return RECRUIT_COST_WAN.junior;
  if (tier === 'mid') return RECRUIT_COST_WAN.mid;
  return RECRUIT_COST_WAN.senior;
}
