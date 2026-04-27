import { generateBPs, loadStartupConfig, startStartupInvestment } from '../core/startupInvest.js';

const $ = (sel, root = document) => root.querySelector(sel);

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 生成 BP 列表 HTML
 * @param {{ bps: object[], idleEmployees: {id:string,name:string}[], embedInForm?: boolean }} p
 * @param embedInForm 为 true 时嵌入主表单，员工用上方 #dep-emp
 */
export function buildStartupNewBusinessHtml({ bps, idleEmployees, embedInForm }) {
  if (!bps?.length) {
    return '<p class="hint">暂无 BP（请确认已加载 startup-invest 与 startup-projects 配置）。</p>';
  }
  const cards = bps
    .map((b, idx) => {
      const pct = b.valuationWan > 0 ? ((b.raiseWan / b.valuationWan) * 100).toFixed(1) : '—';
      return `
      <div class="bp-card-sim" style="background:#2a1f1a;border:1px solid #5e4b34;border-radius:0.75rem;padding:0.75rem;flex:1;min-width:240px;max-width:100%;">
        <div style="font-size:0.9rem;">🚀 <strong style="color:#ffeaac;">在研 / ${escapeHtml(b.name)}</strong></div>
        <div style="font-size:0.78rem;color:#ac9e7e;margin:0.35rem 0;">行业 <strong>${escapeHtml(b.industry)}</strong> · 轮次 <strong>${escapeHtml(String(b.round))}</strong></div>
        <div style="font-size:0.8rem;">估值 <strong>${b.valuationWan}</strong> 万 · 拟融资 <strong>${b.raiseWan}</strong> 万 · 约出让 ${pct}%</div>
        <div style="margin-top:0.5rem;">
          <button type="button" class="primary small" data-action="add-startup-invest" data-bp-idx="${idx}" ${idleEmployees.length ? '' : 'disabled'}>直接投资</button>
        </div>
      </div>`;
    })
    .join('');

  const topHint = embedInForm
    ? `<p class="hint">请在上方选择<strong>员工</strong>，再点下方 BP 的「直接投资」。尽调费 2%，每 6 个月命运判定（晋级/收购/IPO/破产等）。</p>`
    : `<p class="hint">扩张期解锁：尽调费 2%，资金一次性划出；每 6 个月进行一轮命运判定（晋级/收购/IPO/破产等）。</p>
      <div class="flex-row" style="margin-bottom:0.75rem;align-items:center;gap:0.75rem;">
        <label>指派员工
          <select id="su-emp">${
            idleEmployees.length
              ? idleEmployees.map((e) => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`).join('')
              : '<option value="">无可用员工</option>'
          }</select>
        </label>
      </div>`;

  const block = `${topHint}
      <div style="display:flex;flex-direction:column;gap:0.75rem;">${cards}</div>`;

  if (embedInForm) return block;
  return `<div class="panel">${block}</div>`;
}

export function initStartupUI(getState, saveAndRender) {
  // create a panel button in the header toolbar area (if exists)
  const container = document.getElementById('right-sidebar') || document.body;
  const panel = document.createElement('div');
  panel.id = 'startup-panel';
  panel.style.padding = '0.5rem';
  panel.innerHTML = `
    <h3 style="margin:0 0 0.5rem 0;">初创投资</h3>
    <div id="bp-list" style="max-height:240px;overflow:auto;border:1px solid #333;padding:0.5rem;background:#0b1620;color:#dfe8ef;"></div>
    <div style="margin-top:0.5rem;display:flex;gap:0.5rem;align-items:center;">
      <button id="refresh-bps" class="small">刷新 BP 列表</button>
      <button id="open-bp-modal" class="small">生成并展开</button>
    </div>
    <div id="bp-detail" style="margin-top:0.5rem;display:none;border-top:1px dashed #334;padding-top:0.5rem;"></div>
  `;
  container.appendChild(panel);

  panel.querySelector('#refresh-bps').addEventListener('click', async () => {
    await renderBPList();
  });

  panel.querySelector('#open-bp-modal').addEventListener('click', async () => {
    await renderBPList();
    const det = panel.querySelector('#bp-detail');
    det.style.display = 'block';
  });

  async function onInvestClick(draft) {
    const state = getState();
    const empId = draft.employeeId || (state.employees && state.employees[0] && state.employees[0].id);
    const res = await startStartupInvestment(state, empId, draft);
    if (res && res.ok) {
      alert('投资已发起，业务ID：' + res.businessId);
      saveAndRender();
      await renderBPList();
    } else {
      alert('投资失败：' + (res && res.error ? res.error : '未知错误'));
    }
  }

  async function renderBPList() {
    const listEl = panel.querySelector('#bp-list');
    listEl.innerHTML = '<div class="hint">正在加载 BP...</div>';
    try {
      const cfg = await loadStartupConfig();
      const bps = await generateBPs(6, (new Date()).getFullYear(), Math.floor(Math.random()*10000));
      listEl.innerHTML = bps
        .map((b) => `<div class="bp-item" data-id="${b.id}" style="padding:0.35rem;border-bottom:1px solid #223;">
            <div style="display:flex;justify-content:space-between;align-items:center;"><div><strong>${escapeHtml(b.name)}</strong> <span style="color:#9fb3c6">(${escapeHtml(b.industry)})</span></div><div><button class="bp-view small">查看</button></div></div>
            <div style="font-size:0.85rem;color:#9fb3c6;">轮次: ${escapeHtml(String(b.round))} · 估值 ${b.valuationWan} 万 · 募资 ${b.raiseWan} 万</div>
          </div>`)
        .join('');

      listEl.querySelectorAll('.bp-view').forEach((btn, i) => {
        btn.addEventListener('click', (ev) => {
          const b = bps[i];
          showBPDetail(b);
        });
      });
    } catch (e) {
      listEl.innerHTML = `<div class="hint">加载 BP 失败：${escapeHtml(String(e.message || e))}</div>`;
    }
  }

  async function showBPDetail(b) {
    const det = panel.querySelector('#bp-detail');
    det.style.display = 'block';
    // load config for round labels
    let cfg = null;
    try { cfg = await loadStartupConfig(); } catch (e) { cfg = null; }

    const rounds = (cfg && cfg.investmentRounds) ? cfg.investmentRounds : [{ round: 'A' }, { round: 'B' }];
    const state = getState();
    const employees = state.employees || [];

    det.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;"><div><strong>${escapeHtml(b.name)}</strong> · ${escapeHtml(b.industry)}</div><div><button id="close-detail" class="small">关闭</button></div></div>
      <div style="margin-top:0.5rem;color:#9fb3c6;">估值 ${b.valuationWan} 万 · 募资 ${b.raiseWan} 万 · 建议轮次 ${escapeHtml(String(b.round))}</div>
      <div style="margin-top:0.5rem;border-top:1px solid #152; padding-top:0.5rem;">
        <label style="display:block;margin-bottom:0.25rem;">员工：</label>
        <select id="invest-employee" style="width:100%;padding:0.35rem;margin-bottom:0.5rem;">${employees.map(e=>`<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('')}</select>
        <label style="display:block;margin-bottom:0.25rem;">投资金额（万）：</label>
        <input id="invest-wan" type="number" min="1" value="${b.raiseWan}" style="width:100%;padding:0.35rem;margin-bottom:0.5rem;" />
        <label style="display:block;margin-bottom:0.25rem;">估值（万）：</label>
        <input id="invest-valuation" type="number" min="1" value="${b.valuationWan}" style="width:100%;padding:0.35rem;margin-bottom:0.5rem;" />
        <label style="display:block;margin-bottom:0.25rem;">轮次：</label>
        <select id="invest-round" style="width:100%;padding:0.35rem;margin-bottom:0.5rem;">${rounds.map(r=>`<option value="${escapeHtml(String(r.round))}">${escapeHtml(String(r.round))}</option>`).join('')}</select>
        <div style="display:flex;gap:0.5rem;justify-content:flex-end;margin-top:0.25rem;">
          <button id="invest-now" class="primary">确认投资</button>
        </div>
      </div>
    `;

    det.querySelector('#close-detail').addEventListener('click', () => (det.style.display = 'none'));
    det.querySelector('#invest-now').addEventListener('click', async () => {
      const empId = det.querySelector('#invest-employee').value;
      const investWan = Number(det.querySelector('#invest-wan').value || 0);
      const valuationWan = Number(det.querySelector('#invest-valuation').value || b.valuationWan || 0);
      const roundVal = det.querySelector('#invest-round').value;
      if (!empId) return alert('请选择员工');
      if (!investWan || investWan <= 0) return alert('请输入有效的投资金额');
      const draft = { name: b.name, industry: b.industry, round: roundVal, investWan, valuationWan };
      await onInvestClick(draft);
      det.style.display = 'none';
    });
  }

  // initial render
  renderBPList();
}

export default initStartupUI;
