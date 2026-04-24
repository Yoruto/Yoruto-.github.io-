import { roundWan, nextId, appendLog, employeeCanDeploy } from './state.js';
import { ymToMonthIndex, mixUint32 } from './rng.js';

/**
 * realEstate - v0.5.1 基础骨架
 * - 加载项目模板
 * - 简单生成项目列表（用于 UI 展示）
 * 实际投资/烂尾/分阶段结算逻辑将另行实现
 */

let _cfg = null;

async function loadCfg() {
  if (_cfg) return _cfg;
  const tryPaths = [
    '../data/investment-sim/real-estate-projects.json',
    './data/investment-sim/real-estate-projects.json',
    '/data/investment-sim/real-estate-projects.json',
  ];
  for (const path of tryPaths) {
    try {
      const res = await fetch(path);
      if (res.ok) {
        _cfg = await res.json();
        return _cfg;
      }
    } catch (e) {
      // try next path
    }
  }
  throw new Error('无法加载 real-estate-projects 数据');
}

export async function loadRealEstateConfig() {
  return await loadCfg();
}

export async function sampleProjectList(count = 6, year = 2000) {
  const cfg = await loadCfg();
  const types = Object.keys(cfg.projectTypes || {});
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = types[i % types.length];
    const tp = cfg.projectTypes[t];
    const loc = cfg.locationPrefixes[i % cfg.locationPrefixes.length] || '某地';
    const ser = cfg.seriesSuffixes[i % cfg.seriesSuffixes.length] || '';
    const nameTemplate = tp.nameTemplates[0] || '{location}{series}项目';
    const name = nameTemplate.replace('{location}', loc).replace('{series}', ser);
    const cycle = Math.floor((tp.cycleMonthsMin + tp.cycleMonthsMax) / 2);
    const invest = Math.round((tp.investMinWan + tp.investMaxWan) / 2);
    out.push({ id: `re-${t}-${i}`, type: t, name, cycleMonths: cycle, investWan: invest, roiMin: tp.roiMin, roiMax: tp.roiMax, risk: tp.riskLevel });
  }
  return out;
}

export function clearCache() {
  _cfg = null;
}

/**
 * Start a real estate project as an active business.
 * Deducts 尽调费（1%）立即支付。
 */
export async function startRealEstateProject(state, employeeId, projectTemplate) {
  const emp = state.employees.find((e) => e.id === employeeId);
  if (!emp) return { ok: false, error: '员工不存在' };
  if (!employeeCanDeploy(state, emp)) return { ok: false, error: '员工不可新开业务' };
  const cfg = await loadCfg();
  const tp = cfg.projectTypes[projectTemplate.type];
  if (!tp) return { ok: false, error: '无效项目类型' };
  const total = Number(projectTemplate.investWan) || tp.investMinWan;
  if (!Number.isFinite(total) || total < tp.investMinWan) return { ok: false, error: '投资金额不足' };

  const ddStage = cfg.stages.find((s) => s.id === 'dd');
  const ddCost = roundWan(total * (ddStage.costRate || 0.01));
  if (state.companyCashWan + 1e-9 < ddCost) return { ok: false, error: '公司现金不足支付尽调费' };
  state.companyCashWan = roundWan(state.companyCashWan - ddCost);

  const id = nextId(state, 'b');
  const rngOrderSlot = (state.businessRngSlotSeq = (state.businessRngSlotSeq || 0) + 1) - 1;

  // build stages with costWan and durations
  const stages = (cfg.stages || []).map((s) => ({ id: s.id, name: s.name, durationMonths: s.durationMonths, costRate: s.costRate, costWan: roundWan(total * (s.costRate || 0)), paidWan: 0, elapsedMonths: 0 }));

  const avgRoi = (tp.roiMin + tp.roiMax) / 2;
  const totalProceeds = roundWan(total * (1 + avgRoi));

  const proj = {
    id,
    employeeId: emp.id,
    kind: 'realestate',
    name: projectTemplate.name || `地产-${projectTemplate.type}-${id}`,
    projectType: projectTemplate.type,
    totalInvestWan: total,
    paidWan: ddCost,
    stages,
    currentStageIndex: 0,
    totalProceedsWan: totalProceeds,
    salesRemainingWan: totalProceeds, // will be distributed in sales phase
    rngOrderSlot,
    abandon: false,
  };

  // mark dd stage as paid
  if (proj.stages.length && proj.stages[0].id === 'dd') {
    proj.stages[0].paidWan = ddCost;
  }

  state.activeBusinesses.push(proj);
  appendLog(state, `【房地产·开工】${emp.name} 开始项目「${proj.name}」，投资 ${total} 万，已支付尽调费 ${ddCost} 万。`);
  return { ok: true, projectId: id };
}

/**
 * 每月推进单个 realestate 业务；由 monthEngine 在结算循环中调用。
 * 返回 true 表示已被处理并跳过通用结算逻辑。
 */
export function processRealEstateMonthly(state, ord) {
  if (!ord || ord.kind !== 'realestate') return false;
  const cfg = _cfg || null;
  // lazy load guard: if cfg missing, skip handling
  if (!cfg) return false;

  const emp = state.employees.find((e) => e.id === ord.employeeId) || { name: '—', execution: 0 };
  const stage = ord.stages[ord.currentStageIndex] || null;
  if (!stage) return true; // malformed, skip

  // If stage unpaid and requires upfront payment (land), pay now
  if (stage.id === 'land' && stage.paidWan < stage.costWan) {
    if (state.companyCashWan + 1e-9 < stage.costWan - stage.paidWan) {
      // 无法支付土地款，项目烂尾
      ord.abandon = true;
      appendLog(state, `【房地产·烂尾】${ord.name} 在土地获取阶段资金不足，项目烂尾，已损失投入。`);
      const idx = state.activeBusinesses.findIndex((b) => b.id === ord.id);
      if (idx >= 0) state.activeBusinesses.splice(idx, 1);
      return true;
    }
    const pay = roundWan(stage.costWan - stage.paidWan);
    state.companyCashWan = roundWan(state.companyCashWan - pay);
    stage.paidWan = roundWan(stage.costWan);
    ord.paidWan = roundWan((ord.paidWan || 0) + pay);
    appendLog(state, `【房地产·土地】${ord.name} 支付土地款 ${pay} 万。`);
    // stay in land stage for its duration; will advance next month
  }

  // Construction: pay monthly slice, each month检查烂尾
  if (stage.id === 'construction') {
    const totalConst = stage.costWan;
    const perMonth = roundWan(totalConst / Math.max(1, stage.durationMonths));
    // pay monthly
    if (state.companyCashWan + 1e-9 < perMonth) {
      ord.abandon = true;
      appendLog(state, `【房地产·烂尾】${ord.name} 在建设期现金不足，项目烂尾，已损失投入。`);
      const idx2 = state.activeBusinesses.findIndex((b) => b.id === ord.id);
      if (idx2 >= 0) state.activeBusinesses.splice(idx2, 1);
      return true;
    }
    state.companyCashWan = roundWan(state.companyCashWan - perMonth);
    stage.paidWan = roundWan(stage.paidWan + perMonth);
    ord.paidWan = roundWan((ord.paidWan || 0) + perMonth);
    stage.elapsedMonths = (stage.elapsedMonths || 0) + 1;
    appendLog(state, `【房地产·建设】${ord.name} 建设投入 ${perMonth} 万（${stage.elapsedMonths}/${stage.durationMonths} 月）。`);

    // 烂尾判定
    const baseRate = cfg.projectTypes[ord.projectType]?.abandonRate || 0.1;
    const exec = emp.execution || 0;
    const adj = Math.max(0, baseRate - 0.005 * exec);
    // deterministic-ish roll
    const mi = ymToMonthIndex(state.year, state.month);
    const h = mixUint32(state.gameSeed >>> 0, [mi, ord.rngOrderSlot || 0, 0x5245, ord.id.length]);
    const roll = (h % 10000) / 10000;
    if (roll < adj) {
      ord.abandon = true;
      appendLog(state, `【房地产·烂尾判定】${ord.name} 建设期发生烂尾（概率 ${Math.round(adj * 10000) / 100}%），已损失投入。`);
      const ix = state.activeBusinesses.findIndex((b) => b.id === ord.id);
      if (ix >= 0) state.activeBusinesses.splice(ix, 1);
      return true;
    }

    if (stage.elapsedMonths >= stage.durationMonths) {
      // advance to next stage
      ord.currentStageIndex += 1;
      appendLog(state, `【房地产】${ord.name} 建设阶段完成，进入下阶段。`);
      return true;
    }
    return true;
  }

  // Sales stage：按月回款
  if (stage.id === 'sales') {
    const salesMonths = stage.durationMonths || 1;
    const monthlyRecovery = roundWan(ord.totalProceedsWan / salesMonths);
    state.companyCashWan = roundWan(state.companyCashWan + monthlyRecovery);
    ord.salesRemainingWan = roundWan((ord.salesRemainingWan || ord.totalProceedsWan) - monthlyRecovery);
    stage.elapsedMonths = (stage.elapsedMonths || 0) + 1;
    appendLog(state, `【房地产·回款】${ord.name} 回款 ${monthlyRecovery} 万（${stage.elapsedMonths}/${salesMonths} 月）。`);
    if (stage.elapsedMonths >= salesMonths) {
      ord.currentStageIndex += 1;
      appendLog(state, `【房地产】${ord.name} 销售回款完成，进入结算。`);
    }
    return true;
  }

  // Settlement：结算并完成
  if (stage.id === 'settlement') {
    // 本阶段通常仅 1 月，做最终结算：将剩余回款（若有）计入并记录收益
    const remaining = roundWan(ord.salesRemainingWan || 0);
    if (remaining > 0) {
      state.companyCashWan = roundWan(state.companyCashWan + remaining);
    }
    const profit = roundWan(ord.totalProceedsWan - ord.totalInvestWan);
    appendLog(state, `【房地产·结算】${ord.name} 项目结算完毕，回收 ${ord.totalProceedsWan} 万，扣除投资 ${ord.totalInvestWan} 万，账面利润 ${profit} 万。`);
    const idx3 = state.activeBusinesses.findIndex((b) => b.id === ord.id);
    if (idx3 >= 0) state.activeBusinesses.splice(idx3, 1);
    return true;
  }

  // Other stages (包括 dd) 仅推进计时并在到期时切换到下一阶段
  stage.elapsedMonths = (stage.elapsedMonths || 0) + 1;
  appendLog(state, `【房地产·阶段】${ord.name} ${stage.name} 进度 ${stage.elapsedMonths}/${stage.durationMonths} 月。`);
  if (stage.elapsedMonths >= stage.durationMonths) {
    ord.currentStageIndex += 1;
    appendLog(state, `【房地产】${ord.name} 完成 ${stage.name}，进入下阶段。`);
  }
  return true;
}
