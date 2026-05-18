import BusinessGroupsManager, {
  applyBusinessGroupsSnapshot,
  buildBusinessGroupsSnapshot,
} from '../investment-sim/js/core/businessGroups.js';

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
  stocks: [{ id: 'STK-BASE', name: 'Base' }],
};
const ipoStock = { id: 'STKBG-PERSIST', name: '持久化业务组股份有限公司' };
const snapshot = buildBusinessGroupsSnapshot(source, { stocks: [...config.stocks, ipoStock] });

const restored = new BusinessGroupsManager();
const ok = applyBusinessGroupsSnapshot(restored, snapshot, config);

if (!ok) throw new Error('snapshot restore failed');
if (restored.groups.length !== 1) throw new Error(`expected 1 group, got ${restored.groups.length}`);
if (restored.groups[0].id !== 'BG-PERSIST') throw new Error('restored the wrong group');
if (restored.employees[0]?.id !== 'EMP-1') throw new Error('employees were not restored');
if (!config.stocks.some((s) => s.id === 'STKBG-PERSIST')) throw new Error('IPO stock snapshot was not merged');

source.groups[0].fundingWan = 1;
if (snapshot.groups[0].fundingWan !== 500) throw new Error('snapshot shares group references with source manager');

restored.groups[0].fundingWan = 2;
applyBusinessGroupsSnapshot(restored, snapshot, config);
if (snapshot.groups[0].fundingWan !== 500) throw new Error('snapshot was mutated by restored manager');
if (restored.groups[0].fundingWan !== 500) throw new Error('snapshot restore did not reset group data');

console.log('business group persistence snapshot test passed');
