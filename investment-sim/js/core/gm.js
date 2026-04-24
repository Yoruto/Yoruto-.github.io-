// 简易 GM 命令核心 v0.1
import { addActiveBusiness, closeActiveBusiness } from './monthEngine.js';
import { PHASE_UNLOCKS } from './tables.js';

export function initGM(api) {
  const ctx = { api };

  function formatStateSummary(s) {
    return `时间: ${s.year}-${String(s.month).padStart(2,'0')}  现金: ${s.companyCashWan}万  声誉: ${s.reputation}  员工:${s.employees.length}  业务:${s.activeBusinesses.length}`;
  }

  async function executeCommand(raw) {
    const cmd = (raw || '').trim();
    if (!cmd) return { ok: false, msg: '空命令' };
    if (!cmd.startsWith('/')) return { ok: false, msg: 'GM 命令需以 / 开头' };
    const parts = cmd.slice(1).split(/\s+/);
    const verb = parts[0];
    const s = api.getState();

    try {
      if (verb === 'cash') {
        const v = Number(parts[1]);
        if (!Number.isFinite(v)) return { ok: false, msg: '金额无效' };
        s.companyCashWan = v;
        api.saveAndRender();
        return { ok: true, msg: `现金设为 ${v} 万` };
      }
      if (verb === 'add') {
        const v = Number(parts[1]);
        if (!Number.isFinite(v)) return { ok: false, msg: '金额无效' };
        s.companyCashWan = (s.companyCashWan || 0) + v;
        api.saveAndRender();
        return { ok: true, msg: `已增加 ${v} 万，当前 ${s.companyCashWan} 万` };
      }
      if (verb === 'date') {
        const y = Number(parts[1]);
        const m = Number(parts[2]);
        if (!Number.isFinite(y) || !Number.isFinite(m)) return { ok: false, msg: '年/月无效' };
        s.year = y; s.month = m;
        api.saveAndRender();
        return { ok: true, msg: `已跳转到 ${y}-${String(m).padStart(2,'0')}` };
      }
      if (verb === 'next') {
        const r = api.endTurn();
        api.saveAndRender();
        return { ok: true, msg: '执行下一个月', detail: r };
      }
      if (verb === 'market') {
        // 支持： /market <equityC> <commodityC>
        const e = Number(parts[1]);
        const c = Number(parts[2]);
        if (!Number.isFinite(e) || !Number.isFinite(c)) return { ok: false, msg: '参数须为数字 (0-4)' };
        s.actualEquityC = Math.max(0, Math.min(4, e|0));
        s.actualCommodityC = Math.max(0, Math.min(4, c|0));
        api.saveAndRender();
        return { ok: true, msg: `已设置行情 股市 c=${s.actualEquityC} 大宗 c=${s.actualCommodityC}` };
      }
      if (verb === 'rep') {
        const v = Number(parts[1]);
        if (!Number.isFinite(v)) return { ok: false, msg: '声誉值无效' };
        s.reputation = Math.max(0, Math.min(100, v));
        api.saveAndRender();
        return { ok: true, msg: `声誉设置为 ${s.reputation}` };
      }
      if (verb === 'seed') {
        const v = Number(parts[1]);
        if (!Number.isFinite(v)) return { ok: false, msg: '种子须为数字' };
        s.gameSeed = v >>> 0;
        // 重置若干预测字段，以便下次结算使用新种子
        s.predictedEquityC = undefined; s.predictedCommodityC = undefined;
        api.saveAndRender();
        return { ok: true, msg: `种子设置为 ${s.gameSeed}` };
      }
      if (verb === 'emp' && parts[1] === 'add') {
        const tier = parts[2] || 'junior';
        const now = Date.now();
        const id = `gm-emp-${now}`;
        const template = { id, name: `GM_${tier}_${now%1000}`, tier, ability: tier==='senior'?9: tier==='mid'?7:5, loyalty: tier==='senior'?8: (tier==='mid'?7:6), experienceMonths:0, industryTech: {} };
        s.employees.push(template);
        api.saveAndRender();
        return { ok: true, msg: `添加员工 ${template.name} (${tier}) id=${id}` };
      }
      if (verb === 'emp' && parts[1] === 'set') {
        const id = parts[2]; const attr = parts[3]; const val = parts[4];
        const emp = s.employees.find((e)=>e.id===id);
        if (!emp) return { ok: false, msg: '找不到员工' };
        if (!attr) return { ok: false, msg: '缺少属性名' };
        const n = Number(val);
        emp[attr] = Number.isFinite(n) ? n : val;
        api.saveAndRender();
        return { ok: true, msg: `已设置 ${id}.${attr} = ${emp[attr]}` };
      }
      if (verb === 'biz' && parts[1] === 'add') {
        const empId = parts[2]; const kind = parts[3]; const aum = Number(parts[4]||0);
        const res = api.addBusiness({ employeeId: empId, kind, allocWan: aum });
        api.saveAndRender();
        return { ok: true, msg: `创建业务 ${kind} 分配给 ${empId}`, detail: res };
      }
      if (verb === 'biz' && parts[1] === 'close') {
        const targ = parts[2];
        if (targ === 'all') {
          const ids = (s.activeBusinesses || []).map((b) => b.id);
          const results = [];
          for (const id of ids) {
            try { results.push(api.closeBusiness(id)); } catch (e) { results.push({ ok:false, error:String(e) }); }
          }
          api.saveAndRender();
          return { ok:true, msg: `已结业所有业务 (${ids.length})`, detail: results };
        } else {
          const id = targ;
          const res = api.closeBusiness(id);
          api.saveAndRender();
          return { ok: true, msg: `结业业务 ${id}`, detail: res };
        }
      }
      if (verb === 'biz' && parts[1] === 'set') {
        // /biz set all aum <n>  或 /biz set <id> aum <n>
        const target = parts[2];
        const field = parts[3];
        const val = parts[4];
        if (!field) return { ok:false, msg:'缺少字段 (aum|policy)' };
        if (target === 'all') {
          if (field === 'aum') {
            const n = Number(val);
            if (!Number.isFinite(n)) return { ok:false, msg:'金额无效' };
            (s.activeBusinesses || []).forEach((b) => { b.aumWan = n; });
            api.saveAndRender();
            return { ok:true, msg:`所有业务 AUM 设为 ${n} 万` };
          }
          if (field === 'policy') {
            const p = val || 'reinvest';
            (s.activeBusinesses || []).forEach((b) => { b.profitPolicy = p; });
            api.saveAndRender();
            return { ok:true, msg:`所有业务 策略 设为 ${p}` };
          }
          return { ok:false, msg:'未知字段' };
        } else {
          const id = target;
          const b = (s.activeBusinesses || []).find((x)=>x.id===id);
          if (!b) return { ok:false, msg:'找不到业务' };
          if (field === 'aum') {
            const n = Number(val);
            if (!Number.isFinite(n)) return { ok:false, msg:'金额无效' };
            b.aumWan = n;
            api.saveAndRender();
            return { ok:true, msg:`业务 ${id} AUM 设为 ${n} 万` };
          }
          if (field === 'policy') {
            b.profitPolicy = val || 'reinvest';
            api.saveAndRender();
            return { ok:true, msg:`业务 ${id} 策略设为 ${b.profitPolicy}` };
          }
          return { ok:false, msg:'未知字段' };
        }
      }
      if (verb === 'list') {
        const r = api.applyForListing ? api.applyForListing() : { ok:false, msg:'未实现' };
        api.saveAndRender();
        return { ok: true, msg: '请求上市（已触发）', detail: r };
      }
      if (verb === 'ipo') {
        const price = Number(parts[1]);
        if (!Number.isFinite(price)) return { ok:false, msg:'价格无效' };
        const ce = api.ensureCompanyEquity && api.ensureCompanyEquity();
        if (ce) { ce.sharePriceWan = price; api.saveAndRender(); return { ok:true, msg:`已设置股价 ${price} 万/股` }; }
        return { ok:false, msg:'公司股权接口不可用' };
      }
      if (verb === 'save') {
        const j = api.exportJson();
        try { await navigator.clipboard?.writeText(j); return { ok:true, msg:'已复制 JSON 到剪贴板' }; } catch (e) { window.prompt('JSON', j); return { ok:true, msg:'导出至 prompt' }; }
      }
      if (verb === 'load') {
        try { const t = await navigator.clipboard.readText(); const obj = api.importJson(t); api.saveAndRender(); return { ok:true, msg:'已从剪贴板导入' }; } catch (e) { return { ok:false, msg: String(e) }; }
      }
      if (verb === 'state') {
        return { ok:true, msg: formatStateSummary(s) };
      }
      if (verb === 'help') {
        return { ok:true, msg: '/cash /add /date /next /market /emp add|set /biz add|close /list /ipo /phase /save /load /state' };
      }
      if (verb === 'phase') {
        const want = parts[1];
        if (!want) return { ok:false, msg: '缺少阶段参数或使用 next' };
        // 支持 next/up 快捷命令
        let target = want;
        if (want === 'next' || want === 'up') {
          const order = ['startup','expansion','mature'];
          const cur = s.companyPhase?.current || 'startup';
          const idx = order.indexOf(cur);
          target = order[Math.min(order.length-1, Math.max(0, idx+1))];
        }
        if (!['startup','expansion','mature'].includes(target)) return { ok:false, msg: '期段须为 startup|expansion|mature 或 next' };
        const prev = s.companyPhase?.current || 'startup';
        if (!s.companyPhase) s.companyPhase = { current: want, lastCheckedMonth: 0, unlockedFeatures: [], history: [] };
        s.companyPhase.current = target;
        s.companyPhase.unlockedFeatures = PHASE_UNLOCKS[target] || [];
        s.companyPhase.history = s.companyPhase.history || [];
        s.companyPhase.history.push({ phase: target, month: s.month, year: s.year, triggeredBy: 'GM set' });
        s.pendingCompanyPhaseModal = {
          from: prev,
          to: target,
          unlocked: PHASE_UNLOCKS[target] || {},
          history: s.companyPhase.history,
          isForced: true,
          triggeredBy: 'GM set',
        };
        api.saveAndRender();
        return { ok:true, msg: `公司阶段设置为 ${target}` };
      }

      if (verb === 'time') {
        // /time year -> 年份 +1，不触发结算
        const sub = parts[1];
        if (!sub) return { ok:false, msg:'缺少子命令，使用 /time year' };
        if (sub === 'year') {
          s.year = (s.year || 1990) + 1;
          api.saveAndRender();
          return { ok:true, msg: `年份已增加到 ${s.year}（未结算）` };
        }
        return { ok:false, msg:'未知子命令，支持 year' };
      }
      return { ok:false, msg: '未知命令' };
    } catch (e) {
      return { ok:false, msg: String(e) };
    }
  }

  return { executeCommand };
}
