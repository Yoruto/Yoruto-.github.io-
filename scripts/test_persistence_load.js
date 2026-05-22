import assert from 'node:assert/strict';
import { loadFromLocal, saveToLocal, clearLocal, importJson } from '../investment-sim/js/core/persistence.js';
import { SCHEMA_VERSION } from '../investment-sim/js/core/state.js';

function installLocalStorageStub({ throwOnSetKey = null } = {}) {
  const store = new Map();
  globalThis.localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      if (key === throwOnSetKey) throw new Error(`quota exceeded for ${key}`);
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
  return store;
}

let store = installLocalStorageStub();
const currentState = {
  schemaVersion: SCHEMA_VERSION,
  gameSeed: 7,
  year: 2004,
  month: 9,
  phase: 'market',
  companyCashWan: 321,
  employees: [],
};
assert.equal(saveToLocal(currentState).ok, true);
let loaded = loadFromLocal();
assert.equal(loaded.year, 2004);
assert.equal(loaded.month, 9);
assert.equal(loaded.companyCashWan, 321);
assert.equal(loaded.schemaVersion, SCHEMA_VERSION);
assert.ok(Array.isArray(loaded.majorEffectStack));
assert.ok(Array.isArray(loaded.majorFiredKeys));

store = installLocalStorageStub();
store.set('investment-company-v2-save', JSON.stringify({
  schemaVersion: 5,
  gameSeed: 3,
  year: 2001,
  month: 6,
  phase: 'market',
  companyCashWan: 123,
  employees: [{ id: 'e-old', name: '旧员工', ability: 6 }],
  activeBusinesses: [{ id: 'b-old', kind: 'consulting' }],
}));
loaded = loadFromLocal();
assert.equal(loaded.year, 2001);
assert.equal(loaded.month, 6);
assert.equal(loaded.companyCashWan, 123);
assert.equal(loaded.schemaVersion, SCHEMA_VERSION);
assert.equal(loaded.employees[0].leadership, 6);
assert.equal(loaded.activeBusinesses[0].industry, 'finance');
assert.equal(store.has('investment-company-v2-save'), false);
assert.ok(store.get('investment-sim-dev-v5'));

store = installLocalStorageStub({ throwOnSetKey: 'investment-sim-dev-v5' });
const legacyOnly = JSON.stringify({
  year: 2002,
  month: 2,
  phase: 'market',
  employees: [],
});
store.set('investment-sim-dev-save', legacyOnly);
loaded = loadFromLocal();
assert.equal(loaded.year, 2002);
assert.equal(store.get('investment-sim-dev-save'), legacyOnly);
assert.equal(store.has('investment-sim-dev-v5'), false);

const imported = importJson(JSON.stringify({
  year: 1999,
  month: 12,
  phase: 'market',
  employees: [],
}));
assert.equal(imported.year, 1999);
assert.equal(imported.month, 12);
assert.ok(Array.isArray(imported.majorEffectStack));
assert.ok(Array.isArray(imported.majorFiredKeys));

clearLocal();
assert.equal(loadFromLocal(), null);

console.log('persistence load and migration test passed');
