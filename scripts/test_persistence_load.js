import assert from 'assert/strict';
import { createInitialState, SCHEMA_VERSION } from '../investment-sim/js/core/state.js';
import { importJson, loadFromLocal, saveToLocal } from '../investment-sim/js/core/persistence.js';

const STORAGE_KEY = 'investment-sim-dev-v5';

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }

  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value) {
    this.map.set(key, String(value));
  }

  removeItem(key) {
    this.map.delete(key);
  }
}

globalThis.localStorage = new MemoryStorage();

const saved = createInitialState(123);
saved.year = 2004;
saved.month = 9;
saved.companyCashWan = 321.25;

assert.deepEqual(saveToLocal(saved), { ok: true });
const loaded = loadFromLocal();
assert.equal(loaded.year, 2004);
assert.equal(loaded.month, 9);
assert.equal(loaded.companyCashWan, 321.25);

const legacy = createInitialState(456);
legacy.schemaVersion = 7;
legacy.year = 2012;
delete legacy.companyPhase;
delete legacy.companyEquity;
delete legacy.broadIndexWeights;
delete legacy.stockSpotMult;
delete legacy.broadIndexLevel;
legacy.employees = [{ id: 'e-old', name: 'Legacy', ability: 6, experienceMonths: 12 }];
legacy.activeBusinesses = [{ id: 'b-old', employeeId: 'e-old', kind: 'fundraising' }];

localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
const migrated = loadFromLocal();
assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
assert.equal(migrated.year, 2012);
assert.ok(migrated.companyPhase);
assert.ok(migrated.companyEquity);
assert.equal(migrated.broadIndexWeights, null);
assert.equal(migrated.stockSpotMult, null);
assert.equal(migrated.broadIndexLevel, 2000);
assert.equal(typeof migrated.employees[0].leadership, 'number');
assert.equal(migrated.activeBusinesses[0].totalMonths, 6);
assert.equal(migrated.activeBusinesses[0].elapsedMonths, 0);
assert.equal(migrated.activeBusinesses[0].expectedFundWan, 10);

const imported = importJson(JSON.stringify({ year: 2020, month: 5, employees: [], activeBusinesses: [] }));
assert.equal(imported.schemaVersion, SCHEMA_VERSION);
assert.equal(imported.broadIndexLevel, 2000);

console.log('persistence load and migration test passed');
