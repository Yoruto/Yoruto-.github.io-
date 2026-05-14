import { importJson, loadFromLocal, saveToLocal } from '../investment-sim/js/core/persistence.js';
import { SCHEMA_VERSION } from '../investment-sim/js/core/state.js';

const STORAGE_KEY = 'investment-sim-dev-v5';

function makeLocalStorage() {
  const store = new Map();
  return {
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
}

globalThis.localStorage = makeLocalStorage();

const savedState = {
  schemaVersion: 7,
  gameSeed: 42,
  year: 2012,
  month: 9,
  phase: 'market',
  companyCashWan: 1234.5,
  companyPhase: { current: 'expansion', lastCheckedMonth: 10, unlockedFeatures: [], history: [] },
  employees: [{ id: 'e1', name: '测试员工', leadership: 4, innovation: 5, execution: 6 }],
  activeBusinesses: [],
  monthLog: [],
  pendingMargin: [],
  macro: { sentiment: 55 },
  market: null,
};

localStorage.setItem(STORAGE_KEY, JSON.stringify(savedState));

const loaded = loadFromLocal();
if (!loaded) throw new Error('expected saved state to load');
if (loaded.schemaVersion !== SCHEMA_VERSION) throw new Error(`expected schema ${SCHEMA_VERSION}, got ${loaded.schemaVersion}`);
if (loaded.year !== 2012 || loaded.month !== 9) throw new Error('loaded save did not preserve calendar progress');
if (loaded.companyCashWan !== 1234.5) throw new Error('loaded save did not preserve company cash');
if (loaded.broadIndexWeights !== null) throw new Error('expected missing broad index weights to initialize to null');
if (loaded.stockSpotMult !== null) throw new Error('expected missing stock spot multipliers to initialize to null');
if (loaded.broadIndexLevel !== 2000) throw new Error('expected missing broad index level to initialize to 2000');

loaded.year = 2013;
const saveResult = saveToLocal(loaded);
if (!saveResult.ok) throw new Error(`save failed: ${saveResult.error}`);
const reloaded = loadFromLocal();
if (reloaded.year !== 2013) throw new Error('round-trip save/load failed');

const imported = importJson(JSON.stringify({ ...savedState, schemaVersion: 7, year: 2014 }));
if (imported.schemaVersion !== SCHEMA_VERSION) throw new Error('import did not migrate schema');
if (imported.year !== 2014) throw new Error('import migration did not preserve progress');

console.log('persistence load migration test passed');
