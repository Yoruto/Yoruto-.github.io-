import { createInitialState } from '../investment-sim/js/core/state.js';
import {
  clearLocal,
  loadOrCreateState,
  saveToLocal,
} from '../investment-sim/js/core/persistence.js';

const storage = new Map();

globalThis.localStorage = {
  getItem(key) {
    return storage.has(key) ? storage.get(key) : null;
  },
  setItem(key, value) {
    storage.set(key, String(value));
  },
  removeItem(key) {
    storage.delete(key);
  },
};

clearLocal();

const fresh = loadOrCreateState(createInitialState, 7);
if (fresh.loaded) throw new Error('expected no saved state on empty storage');
if (fresh.state.gameSeed !== 7) throw new Error(`expected seed 7, got ${fresh.state.gameSeed}`);

const saved = createInitialState(42);
saved.year = 2001;
saved.month = 8;
saved.companyCashWan = 1234.5;

const saveResult = saveToLocal(saved);
if (!saveResult.ok) throw new Error(`save failed: ${saveResult.error}`);

const restored = loadOrCreateState(() => {
  throw new Error('fresh-state factory should not run when a save exists');
}, 1);

if (!restored.loaded) throw new Error('expected saved state to be loaded');
if (restored.state.gameSeed !== 42) throw new Error(`expected restored seed 42, got ${restored.state.gameSeed}`);
if (restored.state.year !== 2001 || restored.state.month !== 8) {
  throw new Error(`expected restored date 2001-8, got ${restored.state.year}-${restored.state.month}`);
}
if (restored.state.companyCashWan !== 1234.5) {
  throw new Error(`expected restored cash 1234.5, got ${restored.state.companyCashWan}`);
}

console.log('persistence load test passed');
