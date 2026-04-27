import { createDefaultCompanyEquity } from './companyEquity.js';

/** 开发版存档键；更换即丢弃旧 localStorage，不做迁移 */
const STORAGE_KEY = 'investment-sim-dev-v5';

/** 历史键：加载时删除 */
const LEGACY_STORAGE_KEYS = ['investment-company-v2-save', 'investment-sim-dev-save'];

function purgeLegacyKeys() {
  for (const k of LEGACY_STORAGE_KEYS) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
}

export function saveToLocal(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export function loadFromLocal() {
  purgeLegacyKeys();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    // 兼容性：若旧存档缺少 companyPhase，填入默认结构
    if (s && typeof s === 'object' && !s.companyPhase) {
      s.companyPhase = { current: 'startup', lastCheckedMonth: 0, unlockedFeatures: [], history: [] };
      s.pendingCompanyPhaseModal = null;
    }
    // 兼容性：若旧存档员工缺少 leadership 字段，迁移员工结构
    try {
      if (s && Array.isArray(s.employees)) {
        let migrated = false;
        for (let i = 0; i < s.employees.length; i++) {
          const emp = s.employees[i];
          if (emp && typeof emp === 'object' && emp.leadership == null) {
            // 延迟导入以避免循环依赖问题
            // 使用简单迁移：均分旧 ability
            const oldA = emp.ability || 5;
            emp.leadership = Math.max(1, Math.min(10, Math.ceil((oldA / 3) * (0.9 + Math.random() * 0.2))));
            emp.innovation = Math.max(1, Math.min(10, Math.ceil((oldA / 3) * (0.9 + Math.random() * 0.2))));
            emp.execution = Math.max(1, Math.min(10, Math.ceil((oldA / 3) * (0.9 + Math.random() * 0.2))));
            emp.industryTech = {
              finance: Math.floor(Math.random() * 10) + 5,
              realestate: Math.floor(Math.random() * 10) + 5,
              tech: Math.floor(Math.random() * 10) + 5,
              semiconductor: Math.floor(Math.random() * 10) + 5,
              consumer: Math.floor(Math.random() * 10) + 5,
              medical: Math.floor(Math.random() * 10) + 5,
              energy: Math.floor(Math.random() * 10) + 5,
              aerospace: Math.floor(Math.random() * 10) + 5,
            };
            migrated = true;
          }
        }
        if (migrated) {
          // mark schema to current version if exists
          if (!s.schemaVersion) s.schemaVersion = 5;
        }
      }
    } catch (e) {
      // ignore migration errors
      console.warn('employee migration failed', e);
    }
    // 兼容性：迁移 activeBusinesses 中的 fundraising / consulting 字段
    try {
      if (s && Array.isArray(s.activeBusinesses)) {
        let changed = false;
        for (let i = 0; i < s.activeBusinesses.length; i++) {
          const b = s.activeBusinesses[i];
          if (!b || typeof b !== 'object') continue;
          if (b.kind === 'fundraising') {
            if (b.totalMonths == null) {
              // 旧档可能没有周期，估算为 6
              b.totalMonths = 6;
              changed = true;
            }
            if (b.elapsedMonths == null) {
              b.elapsedMonths = 0;
              changed = true;
            }
            if (b.expectedFundWan == null) {
              b.expectedFundWan = 10;
              changed = true;
            }
          }
          if (b.kind === 'consulting') {
            if (!b.industry) {
              b.industry = 'finance';
              changed = true;
            }
            if (b.oneOff == null) {
              b.oneOff = true;
              changed = true;
            }
          }
        }
        if (changed) {
          if (!s.schemaVersion) s.schemaVersion = 6;
        }
      }
    } catch (e) {
      console.warn('businesses migration failed', e);
    }
    // v0.4：公司股权、弹窗位
    try {
      if (s && typeof s === 'object' && !s.companyEquity) {
        s.companyEquity = createDefaultCompanyEquity();
        s.pendingFundraisingConfirmation = s.pendingFundraisingConfirmation ?? null;
        s.pendingNpcInvestment = s.pendingNpcInvestment ?? null;
        s.pendingListingSuccessModal = s.pendingListingSuccessModal ?? null;
        s.pendingAnnualReport = s.pendingAnnualReport ?? null;
        s.pendingIssuanceSuccess = s.pendingIssuanceSuccess ?? null;
        if (!s.schemaVersion || s.schemaVersion < 6) s.schemaVersion = 6;
      }
    } catch (e) {
      console.warn('v0.4 state migration', e);
    }
    try {
      if (s && typeof s === 'object' && (s.schemaVersion | 0) === 6) {
        s.schemaVersion = 7;
        s.macro = s.macro ?? null;
        s.market = s.market ?? null;
      }
    } catch (e) {
      console.warn('v0.6 state migration', e);
    }
    return s;
  } catch {
    return null;
  }
}

export function clearLocal() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  purgeLegacyKeys();
}

export function exportJson(state) {
  return JSON.stringify(state, null, 2);
}

export function importJson(text) {
  return JSON.parse(text);
}
