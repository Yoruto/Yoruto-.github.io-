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

export function migrateLoadedState(s) {
  if (!s || typeof s !== 'object') return null;

  if (!s.companyPhase) {
    s.companyPhase = { current: 'startup', lastCheckedMonth: 0, unlockedFeatures: [], history: [] };
    s.pendingCompanyPhaseModal = null;
  }

  try {
    if (Array.isArray(s.employees)) {
      for (const emp of s.employees) {
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
  } catch (e) {
    console.warn('employee migration failed', e);
  }

  try {
    if (Array.isArray(s.activeBusinesses)) {
      for (const b of s.activeBusinesses) {
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
  } catch (e) {
    console.warn('businesses migration failed', e);
  }

  try {
    if (!s.companyEquity) {
      s.companyEquity = createDefaultCompanyEquity();
      s.pendingFundraisingConfirmation = s.pendingFundraisingConfirmation ?? null;
      s.pendingNpcInvestment = s.pendingNpcInvestment ?? null;
      s.pendingListingSuccessModal = s.pendingListingSuccessModal ?? null;
      s.pendingAnnualReport = s.pendingAnnualReport ?? null;
      s.pendingIssuanceSuccess = s.pendingIssuanceSuccess ?? null;
    }
  } catch (e) {
    console.warn('v0.4 state migration', e);
  }

  s.macro = s.macro ?? null;
  s.market = s.market ?? null;
  s.broadIndexWeights = s.broadIndexWeights ?? null;
  s.stockSpotMult = s.stockSpotMult ?? null;
  if (s.broadIndexLevel == null || !Number.isFinite(Number(s.broadIndexLevel))) {
    s.broadIndexLevel = 2000;
  }
  s.schemaVersion = SCHEMA_VERSION;

  return s;
}

export function loadFromLocal() {
  purgeLegacyKeys();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return migrateLoadedState(JSON.parse(raw));
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
  const s = migrateLoadedState(JSON.parse(text));
  if (!s) throw new Error('无效存档');
  return s;
}
