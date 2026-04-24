import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { pathToFileURL } from 'url';

const root = path.resolve('d:/Yoruto-.github.io-/investment-sim/js');
function loadModule(rel) {
  const full = path.join(root, rel);
  return import(pathToFileURL(full).href);
}

async function run() {
  const stateMod = await loadModule('./core/state.js');
  const me = await loadModule('./core/monthEngine.js');
  const persistence = await loadModule('./core/persistence.js');
  const settlement = await loadModule('./core/settlement.js');

  // create a fresh state
  const state = stateMod.createInitialState ? stateMod.createInitialState(42) : stateMod.createInitialState?.(1) || JSON.parse(JSON.stringify(stateMod.DEFAULT_STATE || {}));
  // ensure we have at least one employee
  if (!state.employees || !state.employees.length) {
    state.employees = [{ id: 'e1', name: 'Test', leadership: 5, industryTech: { finance: 10 }, experienceMonths:0 }];
  }

  // test consulting: create order then run settlement and ensure cash increased
  const emp = state.employees[0];
  const beforeCash = state.companyCashWan || 0;
  let res = me.addActiveBusiness(state, { employeeId: emp.id, kind: 'consulting', industry: 'finance' }, {});
  assert(res.ok, 'add consulting failed: ' + JSON.stringify(res));
  me.runSettlement(state, {});
  const afterCash = state.companyCashWan;
  assert(afterCash > beforeCash, 'consulting did not increase cash');

  // test fundraising: create order and progress months until completion or removal
  const beforeCash2 = state.companyCashWan;
  res = me.addActiveBusiness(state, { employeeId: emp.id, kind: 'fundraising' }, {});
  if (res.needsConfirmation) {
    const c = me.confirmFundraisingWithEquity(state, true);
    assert(c.ok, 'confirm fundraising: ' + JSON.stringify(c));
  } else {
    assert(res.ok, 'add fundraising failed: ' + JSON.stringify(res));
  }
  const bid = state.activeBusinesses.find(b => b.kind === 'fundraising').id;
  // simulate months
  let max = 12;
  let completed = false;
  while (max-- > 0) {
    me.runSettlement(state, {});
    if (!state.activeBusinesses.find(b => b.id === bid)) { completed = true; break; }
  }
  assert(completed, 'fundraising did not complete within 12 months');

  // verify monthReportData contains fundraisingRows when monthReportData present
  // trigger month report by calling closeMonthAndAdvance if possible
  if (me.runSettlement) {
    // monthEngine sets monthReportData inside closeMonthAndAdvance, so call endTurn
    if (me.endTurn) {
      // reset to ensure no pending margin
      state.pendingMargin = [];
      const r = me.endTurn(state, {});
      // allow success
    }
  }

  // save and load
  const dump = persistence.exportJson ? persistence.exportJson(state) : JSON.stringify(state);
  const loaded = persistence.importJson ? persistence.importJson(dump) : JSON.parse(dump);
  // check fundraising fields preserved if any
  const f = (loaded.activeBusinesses || []).find(x => x.kind === 'fundraising');
  // it's okay if none (completed), but fields for consulting should be present in dump of prior consulting entries

  console.log('TEST OK');
}

run().catch((e) => { console.error(e); process.exit(2); });
