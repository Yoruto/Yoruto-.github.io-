const store = new Map();

globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => {
    store.set(key, String(value));
  },
  removeItem: (key) => {
    store.delete(key);
  },
};

const { loadFromLocal, saveToLocal } = await import('../investment-sim/js/core/persistence.js');

const currentKey = 'investment-sim-dev-v5';
const legacyKey = 'investment-sim-dev-save';
const legacyState = {
  schemaVersion: 7,
  year: 2001,
  month: 8,
  phase: 'market',
  companyCashWan: 1234,
  employees: [],
  activeBusinesses: [],
  offices: [],
  monthLog: [],
  pendingMargin: [],
};

store.set(legacyKey, JSON.stringify(legacyState));

const loadedLegacy = loadFromLocal();
if (!loadedLegacy) throw new Error('expected legacy save to load');
if (loadedLegacy.year !== legacyState.year || loadedLegacy.month !== legacyState.month) {
  throw new Error('loaded legacy save has the wrong date');
}
if (loadedLegacy.companyCashWan !== legacyState.companyCashWan) {
  throw new Error('loaded legacy save lost company cash');
}
if (loadedLegacy.schemaVersion !== 8) {
  throw new Error(`expected migrated schema 8, got ${loadedLegacy.schemaVersion}`);
}
if (!store.has(currentKey)) {
  throw new Error('legacy save was not copied to the current storage key');
}
if (store.has(legacyKey)) {
  throw new Error('legacy key should be purged after a successful migration');
}

saveToLocal({ year: 2010, month: 2 });
const loadedCurrent = loadFromLocal();
if (loadedCurrent.year !== 2010 || loadedCurrent.month !== 2) {
  throw new Error('current-key save did not reload');
}

store.clear();
store.set(legacyKey, '{not-json');
if (loadFromLocal() !== null) {
  throw new Error('corrupt legacy save should not load');
}
if (!store.has(legacyKey)) {
  throw new Error('corrupt legacy save should not be purged');
}

console.log('persistence load migration test passed');
