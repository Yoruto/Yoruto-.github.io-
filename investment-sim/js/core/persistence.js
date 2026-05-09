import { createDefaultCompanyEquity } from './companyEquity.js';
import { SCHEMA_VERSION } from './state.js';

const STORAGE_KEY = 'investment-sim-dev-v5';

const LEGACY_STORAGE_KEYS = ['investment-company-v2-save', 'investment-sim-dev-save'];

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

function migrateEmployeeFields(state) {
  if (!state || !Array.isArray(state.employees)) return;
  for (const emp of state.employees) {
    if (!emp || typeof emp !== 'object' || emp.leadership != null) continue;
    const oldA = emp.ability || 5;
    emp.leadership = Math.max(1, Math.min(10, Math.ceil((oldA / 3) * (0.9 + Math.random() * 0.2))));
    emp.innovation = Math.max(1, Math.min(10, Math.ceil((oldA / 3) * (0.9 + Math.random() * 0.2))));
    emp.execution = Math.max(1, Math.min(10, Math.ceil((oldA / 3) * (0.9 + Math.random() * 0.2))));
    emp.industryTech = {
      finance: Math.floor(Math.random() * 10) + 5,
      realestate: Math.floor(Math.random() * 10) + 5,
      tech: Math.floor(Math.random() * 10) + 5,
      semiconductor: Math.floor(Math.random() * 10) + 5,
      consumer: Math.floor(Math.random() * 10) + 5,
      medical: Math.floor(Math.random() * 10) + 5,
      energy: Math.floor(Math.random() * 10) + 5,
      aerospace: Math.floor(Math.random() * 10) + 5,
    };
  }
}

function migrateBusinessFields(state) {
  if (!state || !Array.isArray(state.activeBusinesses)) return;
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
}

export function migrateStateForCurrentSchema(state) {
  if (!state || typeof state !== 'object') return null;
  if (!state.companyPhase) {
    state.companyPhase = { current: 'startup', lastCheckedMonth: 0, unlockedFeatures: [], history: [] };
    state.pendingCompanyPhaseModal = null;
  }
  migrateEmployeeFields(state);
  migrateBusinessFields(state);
  if (!state.companyEquity) {
    state.companyEquity = createDefaultCompanyEquity();
    state.pendingFundraisingConfirmation = state.pendingFundraisingConfirmation ?? null;
    state.pendingNpcInvestment = state.pendingNpcInvestment ?? null;
    state.pendingListingSuccessModal = state.pendingListingSuccessModal ?? null;
    state.pendingAnnualReport = state.pendingAnnualReport ?? null;
    state.pendingIssuanceSuccess = state.pendingIssuanceSuccess ?? null;
  }
  state.macro = state.macro ?? null;
  state.market = state.market ?? null;
  state.broadIndexWeights = state.broadIndexWeights ?? null;
  state.stockSpotMult = state.stockSpotMult ?? null;
  if (state.broadIndexLevel == null || !Number.isFinite(Number(state.broadIndexLevel))) {
    state.broadIndexLevel = 2000;
  }
  state.schemaVersion = SCHEMA_VERSION;
  return state;
}

export function loadFromLocal() {
  purgeLegacyKeys();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return migrateStateForCurrentSchema(JSON.parse(raw));
  } catch {
    return null;
  }
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
  return migrateStateForCurrentSchema(JSON.parse(text));
}
