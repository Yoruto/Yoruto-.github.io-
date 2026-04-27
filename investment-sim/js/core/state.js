import { OFFICE_GRADES, RECRUIT_COST_WAN, SEVERANCE_MONTHS_PAY } from './tables.js';
import { randomEmployeeNameForSeed } from './rng.js';
import { createDefaultCompanyEquity } from './companyEquity.js';

/** 仅与当前开发构建一致；不兼容旧存档 */
export const SCHEMA_VERSION = 7;

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
    return emp.experienceMonths >= 24 && ((emp.leadership || 0) + (emp.innovation || 0) + (emp.execution || 0)) / 3 >= 5;
  }
  if (emp.tier === 'mid') {
    return emp.experienceMonths >= 60 && ((emp.leadership || 0) + (emp.innovation || 0) + (emp.execution || 0)) / 3 >= 7;
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
    leadership: 3,
    innovation: 3,
    execution: 3,
    industryTech: { finance: 5, realestate: 5, tech: 5, semiconductor: 5, consumer: 5, medical: 5, energy: 5, aerospace: 5 },
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
    leadership: 3,
    innovation: 2,
    execution: 3,
    industryTech: { finance: 5, realestate: 5, tech: 5, semiconductor: 5, consumer: 5, medical: 5, energy: 5, aerospace: 5 },
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
    // 公司发展阶段（startup | expansion | mature）——与 UI 的交互阶段 `phase` 区分
    companyPhase: {
      current: 'startup',
      lastCheckedMonth: 0,
      unlockedFeatures: [],
      history: [],
    },
    // 弹窗数据：当晋升发生时写入，由 UI 渲染并清除
    pendingCompanyPhaseModal: null,
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
    /** v0.4 股份与上市 */
    companyEquity: createDefaultCompanyEquity(),
    pendingFundraisingConfirmation: null,
    pendingNpcInvestment: null,
    pendingListingSuccessModal: null,
    pendingAnnualReport: null,
    pendingIssuanceSuccess: null,
    /** v0.6 宏观经济与市场竞争（由 macro.js / marketCompetition.js 填充） */
    macro: null,
    market: null,
  };
}

/**
 * 将旧版本员工迁移到 v0.3 员工模型（保留 ability 作只读历史值）
 */
export function migrateEmployeeFromV02(oldEmployee) {
  const oldAbility = oldEmployee.ability || 5;
  const base = Math.max(1, Math.min(10, Math.round(oldAbility)));
  // 将旧 ability 按照 3 维平均分配并加上小幅随机波动
  const rnd = Math.floor(Math.random() * 3) - 1; // -1..1
  const leadership = Math.max(1, Math.min(10, Math.ceil((base / 3) * (0.9 + Math.random() * 0.2))));
  const innovation = Math.max(1, Math.min(10, Math.ceil((base / 3) * (0.9 + Math.random() * 0.2))));
  const execution = Math.max(1, Math.min(10, Math.ceil((base / 3) * (0.9 + Math.random() * 0.2))));
  const industryTech = {
    finance: Math.floor(Math.random() * 10) + 5,
    realestate: Math.floor(Math.random() * 10) + 5,
    tech: Math.floor(Math.random() * 10) + 5,
    semiconductor: Math.floor(Math.random() * 10) + 5,
    consumer: Math.floor(Math.random() * 10) + 5,
    medical: Math.floor(Math.random() * 10) + 5,
    energy: Math.floor(Math.random() * 10) + 5,
    aerospace: Math.floor(Math.random() * 10) + 5,
  };
  return Object.assign({}, oldEmployee, { leadership, innovation, execution, industryTech });
}

/**
 * 计算员工对某业务的等效能力值（1..10），使用 BUSINESS_ABILITY_WEIGHTS 表
 */
import { BUSINESS_ABILITY_WEIGHTS } from './tables.js';
export function computeBusinessAbility(emp, businessKind) {
  const weights = BUSINESS_ABILITY_WEIGHTS[businessKind] || { leadership: 0.33, execution: 0.33, innovation: 0.34 };
  const l = emp.leadership || 0;
  const e = emp.execution || 0;
  const i = emp.innovation || 0;
  const weighted = l * (weights.leadership || 0) + e * (weights.execution || 0) + i * (weights.innovation || 0);
  const sumW = (weights.leadership || 0) + (weights.execution || 0) + (weights.innovation || 0) || 1;
  // normalized in 1..10
  const normalized = Math.max(1, Math.min(10, Math.round(weighted / sumW)));
  return normalized;
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

/** 查询员工是否有在营业务 */
export function hasActiveBusiness(state, employeeId) {
  return state.activeBusinesses.some((b) => b.employeeId === employeeId);
}

/** 检查员工是否可以部署新业务 */
export function employeeCanDeploy(state, emp) {
  if (emp.hiredThisMonth) return false;
  if (hasActiveBusiness(state, emp.id)) return false;
  return true;
}
