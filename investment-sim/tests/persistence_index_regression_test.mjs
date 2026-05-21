import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createInitialState, SCHEMA_VERSION } from '../js/core/state.js';
import { runMonthOpening } from '../js/core/monthEngine.js';
import { saveToLocal, loadFromLocal, importJson } from '../js/core/persistence.js';
import {
  computeBroadIndexMonthlyReturnPct,
  getStockFactorParts,
} from '../js/core/stockPricing.js';

function installLocalStorageStub() {
  const store = new Map();
  globalThis.localStorage = {
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

function loadMarketConfigFixture() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const full = path.resolve(here, '../../data/investment-sim/stocks-futures.json');
  const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
  return { stocks: raw.stocks, futures: raw.futures, sectors: raw.sectors || [] };
}

function listedNonPlayerStocksInReturnOrder(cfg, year, month) {
  return (cfg.stocks || [])
    .filter((s) => {
      if (s.isPlayerCompany) return false;
      if (!s.listingYearMonth) return true;
      const [yy, mm] = s.listingYearMonth.split('-').map(Number);
      return yy < year || (yy === year && mm <= month);
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function assertPersistenceRoundTrip() {
  installLocalStorageStub();
  const saved = createInitialState(77);
  saved.year = 2001;
  saved.month = 7;
  saved.companyCashWan = 1234.5;

  const saveResult = saveToLocal(saved);
  assert.equal(saveResult.ok, true);

  const loaded = loadFromLocal();
  assert.equal(loaded.schemaVersion, SCHEMA_VERSION);
  assert.equal(loaded.gameSeed, 77);
  assert.equal(loaded.year, 2001);
  assert.equal(loaded.month, 7);
  assert.equal(loaded.companyCashWan, 1234.5);

  const legacy = { ...saved, schemaVersion: SCHEMA_VERSION - 1 };
  delete legacy.stockSpotMult;
  delete legacy.broadIndexLevel;
  delete legacy.broadIndexWeights;
  const migrated = importJson(JSON.stringify(legacy));
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
  assert.equal(migrated.stockSpotMult, null);
  assert.equal(migrated.broadIndexWeights, null);
  assert.equal(migrated.broadIndexLevel, 2000);
}

function assertBroadIndexMatchesWeightedRows() {
  const cfg = loadMarketConfigFixture();
  const state = createInitialState(123);
  runMonthOpening(state);

  const actualPct = computeBroadIndexMonthlyReturnPct(state, cfg, state.actualEquityC);
  const weights = state.broadIndexWeights?.weights || {};
  const listed = listedNonPlayerStocksInReturnOrder(cfg, state.year, state.month);

  let expectedPct = 0;
  listed.forEach((stock, orderIndex) => {
    const w = Number(weights[stock.id]) || 0;
    if (w <= 0) return;
    const bp = getStockFactorParts(state, cfg, stock, state.actualEquityC, orderIndex).totalReturnBp;
    expectedPct += w * (bp / 100);
  });

  assert.ok(Object.keys(weights).length > 1, 'fixture should exercise multiple index constituents');
  assert.ok(Math.abs(actualPct - expectedPct) < 1e-10, `index ${actualPct} !== weighted rows ${expectedPct}`);
}

assertPersistenceRoundTrip();
assertBroadIndexMatchesWeightedRows();

console.log('persistence_index_regression_test passed');
