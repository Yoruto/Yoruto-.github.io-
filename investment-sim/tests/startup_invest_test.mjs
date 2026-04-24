import assert from 'assert';
import { createInitialState } from '../js/core/state.js';
import { generateBPs, startStartupInvestment, processStartupMonthly, loadStartupConfig } from '../js/core/startupInvest.js';

async function run() {
  const state = createInitialState(1);
  const cfg = await loadStartupConfig();
  const bps = await generateBPs(2, 2025, 42);
  assert(Array.isArray(bps) && bps.length === 2, 'generateBPs returned 2 items');

  // ensure there is an employee to use
  if (!state.employees || state.employees.length === 0) {
    state.employees = [{ id: 1, name: '测试员工' }];
  }
  // ensure sufficient cash for investment in test
  state.companyCashWan = 10000;

  const res = await startStartupInvestment(state, state.employees[0].id, { name: bps[0].name, industry: bps[0].industry, round: bps[0].round, investWan: bps[0].raiseWan, valuationWan: bps[0].valuationWan });
  console.log('startStartupInvestment result:', res);
  assert(res && res.ok, 'startStartupInvestment should succeed');

  // simulate months to trigger process
  const ord = state.activeBusinesses.find((b) => b.id === res.businessId);
  assert(ord, 'business created');

  // set seed and time to a fixed value to ensure deterministic behavior
  state.gameSeed = 12345;
  state.year = 2025;
  state.month = 1;

  // run several months
  for (let i = 0; i < 12; i++) {
    state.month++;
    if (state.month > 12) { state.month = 1; state.year++; }
    processStartupMonthly(state, ord);
  }

  console.log('startup_invest_test passed');
}

run().catch((e) => { console.error(e); process.exit(1); });
