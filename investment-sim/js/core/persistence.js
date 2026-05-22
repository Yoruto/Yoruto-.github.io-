import { createInitialState, SCHEMA_VERSION } from './state.js';

const STORAGE_KEY = 'investment-sim-dev-v5';

const LEGACY_STORAGE_KEYS = ['investment-company-v2-save', 'investment-sim-dev-save', 'investment-sim:save'];

function normalizeLoadedState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const defaults = createInitialState(Number(raw.gameSeed) || 1);
  const state = { ...defaults, ...raw };
  state.schemaVersion = SCHEMA_VERSION;

  state.companyPhase = state.companyPhase || defaults.companyPhase;
  state.pendingCompanyPhaseModal = state.pendingCompanyPhaseModal ?? null;
  state.offices = Array.isArray(state.offices) ? state.offices : defaults.offices;
  state.employees = Array.isArray(state.employees) ? state.employees : defaults.employees;
  state.activeBusinesses = Array.isArray(state.activeBusinesses) ? state.activeBusinesses : [];
  state.monthOrders = Array.isArray(state.monthOrders) ? state.monthOrders : [];
  state.majorEffectStack = Array.isArray(state.majorEffectStack) ? state.majorEffectStack : [];
  state.majorFiredKeys = Array.isArray(state.majorFiredKeys) ? state.majorFiredKeys : [];
  state.monthLog = Array.isArray(state.monthLog) ? state.monthLog : [];
  state.pendingMargin = Array.isArray(state.pendingMargin) ? state.pendingMargin : [];
  state.lastSettlementResults = Array.isArray(state.lastSettlementResults) ? state.lastSettlementResults : [];
  state.talentPool = Array.isArray(state.talentPool) ? state.talentPool : [];
  state.companyEquity = state.companyEquity || defaults.companyEquity;
  state.pendingFundraisingConfirmation = state.pendingFundraisingConfirmation ?? null;
  state.pendingNpcInvestment = state.pendingNpcInvestment ?? null;
  state.pendingListingSuccessModal = state.pendingListingSuccessModal ?? null;
  state.pendingAnnualReport = state.pendingAnnualReport ?? null;
  state.pendingIssuanceSuccess = state.pendingIssuanceSuccess ?? null;
  state.macro = state.macro ?? null;
  state.market = state.market ?? null;
  state.broadIndexWeights = state.broadIndexWeights ?? null;
  state.stockSpotMult = state.stockSpotMult ?? null;
  state.broadIndexLevel = Number.isFinite(Number(state.broadIndexLevel)) ? Number(state.broadIndexLevel) : defaults.broadIndexLevel;

  for (const emp of state.employees) {
    if (!emp || typeof emp !== 'object') continue;
    const ability = Math.max(1, Math.min(10, Number(emp.ability) || 5));
    emp.leadership = emp.leadership ?? ability;
    emp.innovation = emp.innovation ?? ability;
    emp.execution = emp.execution ?? ability;
    emp.industryTech = emp.industryTech || {
      finance: ability,
      realestate: ability,
      tech: ability,
      semiconductor: ability,
      consumer: ability,
      medical: ability,
      energy: ability,
      aerospace: ability,
    };
    emp.hiredThisMonth = !!emp.hiredThisMonth;
    emp.trainingScheduled = !!emp.trainingScheduled;
    emp.idleStreakMonths = emp.idleStreakMonths ?? 0;
  }

  for (const b of state.activeBusinesses) {
    if (!b || typeof b !== 'object') continue;
    if (b.kind === 'fundraising') {
      b.totalMonths = b.totalMonths ?? 6;
      b.elapsedMonths = b.elapsedMonths ?? 0;
      b.expectedFundWan = b.expectedFundWan ?? 10;
    }
    if (b.kind === 'consulting') {
      b.industry = b.industry || 'finance';
      b.oneOff = b.oneOff ?? true;
    }
  }

  return state;
}

function purgeLegacyKeys() {
  for (const k of LEGACY_STORAGE_KEYS) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
}

export function saveToLocal(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export function loadFromLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeLoadedState(JSON.parse(raw));
  } catch {
    /* fall through to legacy keys */
  }

  let sawLegacyState = false;
  for (const key of LEGACY_STORAGE_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      sawLegacyState = true;
      const state = normalizeLoadedState(JSON.parse(raw));
      if (!state) continue;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        purgeLegacyKeys();
      } catch {
        /* keep the legacy save if copying to the current key fails */
      }
      return state;
    } catch {
      /* try next legacy key */
    }
  }

  if (!sawLegacyState) purgeLegacyKeys();
  return null;
}

export function clearLocal() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  purgeLegacyKeys();
}

export function exportJson(state) {
  return JSON.stringify(state, null, 2);
}

export function importJson(text) {
  const state = normalizeLoadedState(JSON.parse(text));
  if (!state) throw new Error('无效存档');
  return state;
}
