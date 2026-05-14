import {
  applyStockSpotAndIndexAccumulators,
  computeBroadIndexMonthlyReturnPct,
} from '../investment-sim/js/core/stockPricing.js';

const config = {
  sectors: [
    { id: 'tech', sectorBetaBp: 1200 },
    { id: 'util', sectorBetaBp: -500 },
  ],
  stocks: [
    {
      id: 'AAA',
      sectorId: 'tech',
      listingYearMonth: '1995-01',
      basePrice: 100,
      matureYear: 1990,
      matureBetaExtraBp: 600,
    },
    {
      id: 'BBB',
      sectorId: 'util',
      listingYearMonth: '1995-01',
      basePrice: 100,
      matureYear: 1990,
      matureBetaExtraBp: -300,
    },
  ],
};

const baseState = {
  year: 1996,
  month: 1,
  gameSeed: 123,
  actualEquityC: 4,
  macro: { sentiment: 90, baseRate: 6, lines: {}, cyclePhase: 'boom' },
  stockSpotMult: { AAA: 4, BBB: 1 },
  broadIndexWeights: null,
  broadIndexLevel: 2000,
};

const expectedState = structuredClone(baseState);
computeBroadIndexMonthlyReturnPct(expectedState, config, expectedState.actualEquityC);
const expectedWeights = expectedState.broadIndexWeights.weights;

const actualState = structuredClone(baseState);
applyStockSpotAndIndexAccumulators(actualState, config);
const actualWeights = actualState.broadIndexWeights.weights;

for (const id of Object.keys(expectedWeights)) {
  const delta = Math.abs((actualWeights[id] || 0) - expectedWeights[id]);
  if (delta > 1e-12) {
    throw new Error(`weight ${id} was rebalanced after applying current-month return; delta=${delta}`);
  }
}

if (!(actualState.stockSpotMult.AAA !== baseState.stockSpotMult.AAA)) {
  throw new Error('expected stock spot multiplier to advance after weight calculation');
}

console.log('broad index accumulator ordering test passed');
