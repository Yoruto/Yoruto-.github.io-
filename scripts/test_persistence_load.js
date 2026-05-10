import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { loadFromLocal, saveToLocal } from '../investment-sim/js/core/persistence.js';
import { SCHEMA_VERSION } from '../investment-sim/js/core/state.js';

const STORAGE_KEY = 'investment-sim-dev-v5';

function installLocalStorageMock() {
  const store = new Map();
  global.localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
  return store;
}

const store = installLocalStorageMock();
const legacyState = {
  schemaVersion: 7,
  gameSeed: 99,
  year: 2010,
  month: 6,
  phase: 'market',
  companyCashWan: 1234,
  employees: [{ id: 'e1', name: '旧员工', ability: 6, experienceMonths: 12 }],
  activeBusinesses: [{ id: 'b1', kind: 'fundraising' }, { id: 'b2', kind: 'consulting' }],
};

localStorage.setItem(STORAGE_KEY, JSON.stringify(legacyState));
localStorage.setItem('investment-company-v2-save', '{"stale":true}');

const loaded = loadFromLocal();
assert(loaded, 'expected saved state to load');
assert.equal(loaded.schemaVersion, SCHEMA_VERSION, 'legacy save should migrate to current schema');
assert.equal(loaded.companyCashWan, 1234, 'saved cash should be preserved');
assert.equal(loaded.year, 2010, 'saved calendar should be preserved');
assert.equal(loaded.broadIndexLevel, 2000, 'missing broad index level should be initialized');
assert.equal(loaded.broadIndexWeights, null, 'missing broad index weights should be initialized');
assert.equal(loaded.stockSpotMult, null, 'missing stock multiplier map should be initialized');
assert.equal(loaded.activeBusinesses[0].totalMonths, 6, 'fundraising migration should initialize duration');
assert.equal(loaded.activeBusinesses[1].industry, 'finance', 'consulting migration should initialize industry');
assert.equal(typeof loaded.employees[0].leadership, 'number', 'employee migration should initialize dimensions');
assert.equal(localStorage.getItem('investment-company-v2-save'), null, 'legacy storage key should be purged');

loaded.companyCashWan = 4321;
const saved = saveToLocal(loaded);
assert(saved.ok, 'save should succeed');
assert.equal(loadFromLocal().companyCashWan, 4321, 'current save should round-trip');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainSource = fs.readFileSync(path.resolve(__dirname, '../investment-sim/js/main.js'), 'utf8');
assert(
  mainSource.includes('state = loadFromLocal();'),
  'bootstrap should load the saved state before falling back to a new game',
);

console.log('persistence load regression test passed');
