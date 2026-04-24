import { PHASE_UNLOCKS } from './tables.js';

function calculateTotalAssetWan(state) {
  let total = Number(state.companyCashWan) || 0;
  if (Array.isArray(state.activeBusinesses)) {
    for (const b of state.activeBusinesses) {
      total += Number(b.aumWan || 0);
    }
  }
  return total;
}

function detectTriggerCondition(state, nextPhase) {
  const totalAsset = calculateTotalAssetWan(state);
  const year = state.year || 1990;
  if (nextPhase === 'expansion') {
    if (totalAsset >= 10000) return '资产达标（≥1亿）';
    if (year >= 2000 && totalAsset >= 5000) return '年份与资产条件（2000年且资产≥5000万）';
    if ((state.reputation || 0) >= 80) return '公司声望达标（≥80）';
  }
  if (nextPhase === 'mature') {
    if (state.ipoSuccess === true) return 'IPO 成功';
    if (totalAsset >= 50000) return '资产达标（≥50亿）';
    if (year >= 2010) return '年份达标（≥2010）';
  }
  return '条件触发';
}

export function checkPhaseTransition(state) {
  if (!state) return;
  if (!state.companyPhase) return;
  const current = state.companyPhase.current;
  // 防止重复同月触发
  if (state.companyPhase.lastCheckedMonth === state.month) return;
  state.companyPhase.lastCheckedMonth = state.month;

  if (current === 'startup') {
    // 升级到 expansion
    const totalAsset = calculateTotalAssetWan(state);
    const year = state.year || 1990;
    if (totalAsset >= 10000 || (year >= 2000 && totalAsset >= 5000) || (state.reputation || 0) >= 80) {
      const prev = current;
      const next = 'expansion';
      state.companyPhase.current = next;
      state.companyPhase.unlockedFeatures = PHASE_UNLOCKS[next];
      state.companyPhase.history = state.companyPhase.history || [];
      state.companyPhase.history.push({ phase: next, month: state.month, year: state.year, triggeredBy: detectTriggerCondition(state, next) });
      state.pendingCompanyPhaseModal = {
        from: prev,
        to: next,
        unlocked: PHASE_UNLOCKS[next],
        history: state.companyPhase.history,
        isForced: true,
        triggeredBy: detectTriggerCondition(state, next),
      };
    }
  } else if (current === 'expansion') {
    const totalAsset = calculateTotalAssetWan(state);
    const year = state.year || 1990;
    if (state.ipoSuccess === true || totalAsset >= 50000 || year >= 2010) {
      const prev = current;
      const next = 'mature';
      state.companyPhase.current = next;
      state.companyPhase.unlockedFeatures = PHASE_UNLOCKS[next];
      state.companyPhase.history = state.companyPhase.history || [];
      state.companyPhase.history.push({ phase: next, month: state.month, year: state.year, triggeredBy: detectTriggerCondition(state, next) });
      state.pendingCompanyPhaseModal = {
        from: prev,
        to: next,
        unlocked: PHASE_UNLOCKS[next],
        history: state.companyPhase.history,
        isForced: true,
        triggeredBy: detectTriggerCondition(state, next),
      };
    }
  }
}

export default { checkPhaseTransition };
