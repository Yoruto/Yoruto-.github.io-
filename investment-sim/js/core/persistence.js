/** 开发版存档键；更换即丢弃旧 localStorage，不做迁移 */
const STORAGE_KEY = 'investment-sim-dev-v3';

/** 历史键：加载时删除 */
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

export function loadFromLocal() {
  purgeLegacyKeys();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
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
  return JSON.parse(text);
}
