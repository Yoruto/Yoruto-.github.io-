import BusinessGroupsManager, {
  applyBusinessGroupsSnapshot,
  buildBusinessGroupsSnapshot,
} from '../investment-sim/js/core/businessGroups.js';
import { createInitialState } from '../investment-sim/js/core/state.js';
import {
  computeBroadMarketIndexReturnForUI,
  computeSpotDisplayPrice,
} from '../investment-sim/js/core/stockPricing.js';

const source = new BusinessGroupsManager();
source.employees = [{ id: 'EMP-1', name: '持久化测试员工' }];
source.createGroup({
  id: 'BG-PERSIST',
  name: '持久化业务组',
  industry: 'tech',
  ownerPlayerId: 'PLAYER-1',
  fundingWan: 500,
  initialFundingWan: 500,
  teamIds: ['EMP-1'],
  leaderId: 'EMP-1',
});

const config = {
  sectors: [{ id: 'tech', name: 'Technology', sectorBetaBp: 2000 }],
  stocks: [{ id: 'STK-BASE', name: 'Base', sectorId: 'tech', basePrice: 10, matureYear: 1990 }],
};
const ipoStock = source.generateIPOObject(source.groups[0], { year: 2001, month: 6 });
const expectedIpoId = ipoStock.id;
const snapshot = buildBusinessGroupsSnapshot(source, { stocks: [...config.stocks, ipoStock] });

const restored = new BusinessGroupsManager();
const ok = applyBusinessGroupsSnapshot(restored, snapshot, config);

if (!ok) throw new Error('snapshot restore failed');
if (restored.groups.length !== 1) throw new Error(`expected 1 group, got ${restored.groups.length}`);
if (restored.groups[0].id !== 'BG-PERSIST') throw new Error('restored the wrong group');
if (restored.employees[0]?.id !== 'EMP-1') throw new Error('employees were not restored');
const restoredIpo = config.stocks.find((s) => s.id === expectedIpoId);
if (!restoredIpo) throw new Error('IPO stock snapshot was not merged');
if (restoredIpo.stockId !== expectedIpoId) throw new Error('legacy stockId was not preserved');
if (!restoredIpo.sectorId || !restoredIpo.listingYearMonth || !restoredIpo.basePrice) {
  throw new Error('IPO stock was not saved with market-compatible fields');
}

const legacySnapshot = {
  configStocks: [
    {
      stockId: 'STKBG-LEGACY',
      name: '旧业务组股份有限公司',
      symbol: 'BGLEGACY',
      initialPrice: 12.34,
      listingYear: 2002,
      industry: 'tech',
    },
  ],
};
if (!applyBusinessGroupsSnapshot(restored, legacySnapshot, config)) {
  throw new Error('legacy snapshot restore failed');
}
const legacyIpo = config.stocks.find((s) => s.id === 'STKBG-LEGACY');
if (!legacyIpo) throw new Error('legacy stockId-only IPO was not normalized');

const state = createInitialState(1);
state.year = 2002;
state.month = 1;
state.phase = 'market';
state.actualEquityC = 2;
state.macro = { sentiment: 50, baseRate: 6, lines: {} };
computeSpotDisplayPrice(state, config, restoredIpo, state.actualEquityC, 1);
computeSpotDisplayPrice(state, config, legacyIpo, state.actualEquityC, 2);
computeBroadMarketIndexReturnForUI(state, config, state.actualEquityC);

console.log('business group persistence snapshot test passed');
