// 简单测试脚本：在 Node 中加载业务组数据并调用 tickMonth()
// 运行：在项目根目录用 node 执行：
//    node --experimental-modules scripts/test_tick_businessGroups.js

import fs from 'fs';
import path from 'path';
import BusinessGroupsManager from '../investment-sim/js/core/businessGroups.js';

async function run() {
  const base = path.resolve('./data/investment-sim');
  const groupsPath = path.join(base, 'business-groups.json');
  const empsPath = path.join(base, 'employees.json');

  const groups = JSON.parse(fs.readFileSync(groupsPath, 'utf8'));
  const employees = JSON.parse(fs.readFileSync(empsPath, 'utf8'));

  const mgr = new BusinessGroupsManager({ deterministic: true });
  // 直接注入数据以便测试
  mgr.groups = groups;
  mgr.employees = employees;

  console.log('BEFORE tick:');
  mgr.groups.forEach(g => console.log(g.id, g.name, 'fundingWan=', g.fundingWan, 'valuationWan=', g.metrics?.valuationWan));

  await mgr.tickMonth();

  console.log('\nAFTER tick:');
  mgr.groups.forEach(g => console.log(g.id, g.name, 'fundingWan=', g.fundingWan, 'valuationWan=', g.metrics?.valuationWan));

  // 简单断言示例（非测试框架）
  const anyChanged = mgr.groups.some((g, i) => g.fundingWan !== groups[i].fundingWan || g.metrics?.valuationWan !== groups[i].metrics?.valuationWan);
  console.log('\nTick changed values?', anyChanged ? 'YES' : 'NO');
}

run().catch((e) => { console.error(e); process.exit(1); });
