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

export function migrateSavedState(state) {
  if (!state || typeof state !== 'object') return null;
  const version = state.schemaVersion | 0;
  if (version === SCHEMA_VERSION) return state;
  if (version === 7 && SCHEMA_VERSION === 8) {
    return {
      ...state,
      schemaVersion: SCHEMA_VERSION,
      broadIndexWeights: state.broadIndexWeights ?? null,
      stockSpotMult: state.stockSpotMult ?? null,
      broadIndexLevel:
        state.broadIndexLevel != null && Number.isFinite(Number(state.broadIndexLevel))
          ? Number(state.broadIndexLevel)
          : 2000,
    };
  }
  return null;
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
  purgeLegacyKeys();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return migrateSavedState(JSON.parse(raw));
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
  const state = migrateSavedState(JSON.parse(text));
  if (!state) throw new Error(`须为 schema ${SCHEMA_VERSION}`);
  return state;
}
