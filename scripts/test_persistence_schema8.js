import assert from 'node:assert/strict';
import {
  importJson,
  loadFromLocal,
  migrateSavedState,
  saveToLocal,
} from '../investment-sim/js/core/persistence.js';
import { SCHEMA_VERSION } from '../investment-sim/js/core/state.js';

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

const schema7Save = {
  schemaVersion: 7,
  year: 2003,
  month: 8,
  phase: 'decision',
  companyCashWan: 1234,
};

const migrated = migrateSavedState(schema7Save);
assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
assert.equal(migrated.year, 2003);
assert.equal(migrated.companyCashWan, 1234);
assert.equal(migrated.broadIndexWeights, null);
assert.equal(migrated.stockSpotMult, null);
assert.equal(migrated.broadIndexLevel, 2000);

saveToLocal(schema7Save);
const loaded = loadFromLocal();
assert.equal(loaded.schemaVersion, SCHEMA_VERSION);
assert.equal(loaded.year, 2003);
assert.equal(loaded.month, 8);

const imported = importJson(JSON.stringify(schema7Save));
assert.equal(imported.schemaVersion, SCHEMA_VERSION);

assert.equal(migrateSavedState({ schemaVersion: 6 }), null);
assert.throws(() => importJson(JSON.stringify({ schemaVersion: 6 })), /schema/);

console.log('persistence schema 8 migration test passed');
