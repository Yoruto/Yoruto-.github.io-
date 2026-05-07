import assert from 'assert';
import { createInitialState, SCHEMA_VERSION } from '../investment-sim/js/core/state.js';
import { importJson, loadFromLocal, saveToLocal } from '../investment-sim/js/core/persistence.js';

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
saved.year = 2008;
saved.month = 9;
saved.companyCashWan = 4321.1234;
saved.schemaVersion = 7;
delete saved.broadIndexWeights;
delete saved.stockSpotMult;
delete saved.broadIndexLevel;

const saveResult = saveToLocal(saved);
assert.equal(saveResult.ok, true, 'saveToLocal should write to localStorage');

const loaded = loadFromLocal();
assert(loaded, 'loadFromLocal should restore the saved state');
assert.equal(loaded.year, 2008, 'saved progress year should be preserved');
assert.equal(loaded.month, 9, 'saved progress month should be preserved');
assert.equal(loaded.companyCashWan, 4321.1234, 'saved cash should be preserved');
assert.equal(loaded.schemaVersion, SCHEMA_VERSION, 'loaded saves should migrate to the current schema');
assert.equal(loaded.broadIndexWeights, null, 'schema 8 broad index weights should be initialized');
assert.equal(loaded.stockSpotMult, null, 'schema 8 stock multiplier state should be initialized');
assert.equal(loaded.broadIndexLevel, 2000, 'schema 8 broad index level should be initialized');

const imported = importJson(JSON.stringify({ year: 2001, month: 2, employees: [], activeBusinesses: [] }));
assert.equal(imported.schemaVersion, SCHEMA_VERSION, 'imported JSON should also be migrated');
assert.equal(imported.broadIndexLevel, 2000, 'imported JSON should receive new market fields');

console.log('persistence load regression test passed');
