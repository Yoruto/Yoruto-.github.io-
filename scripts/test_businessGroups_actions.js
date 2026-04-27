// 测试脚本：验证创建时自动生成在研产品、每月 +20% 进度、拓展消耗与市占提升
// 运行：
//   node --experimental-modules scripts/test_businessGroups_actions.js

import BusinessGroupsManager from '../investment-sim/js/core/businessGroups.js';

async function run(){
  const mgr = new BusinessGroupsManager();

  // 准备员工池
  mgr.employees = [ { id: 'EMP-1', name: '张三' } ];

  // 创建业务组（包含负责人）
  const g = mgr.createGroup({
    id: 'BG-TEST1',
    name: '测试业务组',
    industry: 'tech',
    ownerPlayerId: 'PLAYER-1',
    initialFundingWan: 500, // 500 万
    fundingWan: 500,
    teamIds: ['EMP-1'],
    leaderId: 'EMP-1'
  });

  console.log('创建后 products:', g.products || g.metrics.products || (g.metrics && g.metrics.products));

  // 验证在研产品存在
  const prod = (g.products || g.metrics.products || [])[0];
  if(!prod){
    console.error('未生成在研产品，测试失败');
    process.exit(1);
  }
  console.log('初始进度:', prod.progress);

  // 多次月度 tick，应该在 5 个月内完成（每月 +20%）
  for(let i=1;i<=5;i++){
    console.log(`--- Month ${i} tick ---`);
    mgr.tickMonth({ companyCashWan: 1000 });
    const p = (g.products || g.metrics.products || [])[0];
    console.log('进度:', p.progress, 'completed:', p.completed, 'productLevel:', g.metrics.productLevel, 'fundingWan:', g.fundingWan);
  }

  const finished = ((g.products || g.metrics.products || [])[0].completed === true) || (g.metrics.productLevel > 0);
  console.log('产品完成?', finished ? 'YES' : 'NO');

  // 测试拓展按钮：记录资金与市占
  const beforeFunds = g.fundingWan;
  const beforeShare = g.metrics.marketShare || 0;
  const r = mgr.expandMarket(g);
  console.log('拓展结果:', r);
  console.log('拓展后资金:', g.fundingWan, '市占:', g.metrics.marketShare);

  if(!r.ok){
    console.error('拓展操作失败：', r.error);
    process.exit(1);
  }

  console.log('测试完成');
}

run().catch(e=>{ console.error(e); process.exit(1); });
