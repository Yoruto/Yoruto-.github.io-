import { loadOtherCompanies, getCompaniesByCategory, getCompanyById } from '../core/otherCompanies.js';

/**
 * 将「其他公司」入口挂到 B 区功能菜单；点击打开覆盖层与详情
 */
async function renderPanel(data) {
  let panel = document.getElementById('other-companies-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'other-companies-panel';
    document.body.appendChild(panel);
  }
  const cats = data.categories || [];
  const firstId = cats[0] && cats[0].id;
  let companies = data.companies || [];
  if (firstId) {
    try {
      companies = await getCompaniesByCategory(firstId);
    } catch (e) {
      companies = (data.companies || []).filter((c) => c.category === firstId);
    }
  }
  const tabs = cats.map((c) => `<button type="button" class="oc-tab" data-cat="${c.id}">${c.icon || ''} ${c.name}</button>`).join('');
  const items = companies
    .map(
      (c) => `
    <div class="oc-item" data-id="${c.id}">
      <div><strong>${c.name}</strong> · ${c.shortName || ''}</div>
      <div class="hint" style="font-size:0.78rem;">${c.description || ''}</div>
      <div><button type="button" class="oc-view small" data-id="${c.id}">查看详情</button></div>
    </div>
  `,
    )
    .join('');
  panel.className = 'month-report-overlay';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.innerHTML = `
    <div class="month-report-card" style="max-width:44rem;max-height:90vh;overflow:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
        <h2 class="section-title" style="margin:0;">其他公司</h2>
        <button type="button" class="small" id="oc-close">× 关闭</button>
      </div>
      <div class="oc-tabs" style="display:flex;flex-wrap:wrap;gap:0.35rem;margin-bottom:0.75rem;">${tabs}</div>
      <div id="oc-list" class="oc-list" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:0.5rem;">${items}</div>
      <div id="oc-detail" class="oc-detail" style="display:none;margin-top:0.75rem;border-top:1px solid #5e4b34;padding-top:0.75rem;"></div>
    </div>
  `;
  panel.style.display = 'flex';
  panel.querySelector('#oc-close').addEventListener('click', () => (panel.style.display = 'none'));

  const tabEls = panel.querySelectorAll('.oc-tab');
  tabEls.forEach((t) => {
    t.addEventListener('click', async (e) => {
      const id = e.currentTarget.getAttribute('data-cat');
      const list = await getCompaniesByCategory(id);
      const html = list
        .map(
          (c) => `
      <div class="oc-item" data-id="${c.id}">
        <div><strong>${c.name}</strong> · ${c.shortName || ''}</div>
        <div class="hint" style="font-size:0.78rem;">${c.description || ''}</div>
        <div><button type="button" class="oc-view small" data-id="${c.id}">查看详情</button></div>
      </div>
    `,
        )
        .join('');
      panel.querySelector('#oc-list').innerHTML = html;
      const det = panel.querySelector('#oc-detail');
      if (det) {
        det.style.display = 'none';
        det.innerHTML = '';
      }
      bindListButtons(panel);
    });
  });

  bindListButtons(panel);
}

function aumForYear(obj, year) {
  const curve = obj.aumGrowthCurve;
  if (!curve || !curve.length) return '—';
  const sorted = [...curve].filter((p) => (p.year | 0) <= (year | 0));
  if (!sorted.length) return '—';
  const last = sorted.sort((a, b) => (a.year | 0) - (b.year | 0)).pop();
  if (last && last.aumWan != null) return `${(last.aumWan / 1).toLocaleString('zh-CN')} 万`;
  return '—';
}

function bindListButtons(panel) {
  const year = 2020; // 展示用固定参考年
  const views = panel.querySelectorAll('.oc-view');
  views.forEach((b) => {
    b.addEventListener('click', async (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      const obj = await getCompanyById(id);
      if (!obj) return;
      const detail = panel.querySelector('#oc-detail');
      const listEl = panel.querySelector('#oc-list');
      if (listEl) listEl.style.display = 'none';
      detail.style.display = 'block';
      const aum = aumForYear(obj, year);
      const aumList = (obj.aumGrowthCurve || [])
        .map((p) => `<li>${p.year} 年：约 ${(p.aumWan / 1).toLocaleString('zh-CN')} 万${p.note ? ' — ' + p.note : ''}</li>`)
        .join('');
      detail.innerHTML = `
        <h3 style="color:#ffeaac;margin-top:0;">${obj.name} (${obj.shortName || ''})</h3>
        <p>${obj.description || ''}</p>
        <p>成立：${obj.foundingYear || '—'} · 总部：${obj.headquarters || '—'}</p>
        <p>投资重点/领域：${
          Array.isArray(obj.investmentFocus || obj.keyProducts || obj.businessLines)
            ? (obj.investmentFocus || obj.keyProducts || obj.businessLines).join('、')
            : '—'
        }</p>
        <p>参考 AUM（${year} 年前最近节点）：<strong>${aum}</strong></p>
        <p class="section-title" style="font-size:0.9rem">AUM 历史</p>
        <ul style="margin:0.25rem 0 0.5rem 1rem;padding:0;">${aumList || '<li>无曲线数据</li>'}</ul>
        <p><button type="button" class="small" id="oc-back">返回列表</button></p>
      `;
      detail.querySelector('#oc-back').addEventListener('click', () => {
        detail.style.display = 'none';
        detail.innerHTML = '';
        if (listEl) listEl.style.display = '';
      });
    });
  });
}

export async function initOtherCompaniesUI() {
  const nav = document.getElementById('function-nav');
  if (document.getElementById('other-companies-nav-btn')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'other-companies-nav-btn';
  /** 不要设置 data-view，避免被 bindSidebarActions 切到不存在的 C 区视图 */
  btn.textContent = '其他公司';
  if (nav) {
    nav.appendChild(btn);
  } else {
    const dock = document.getElementById('month-dock');
    if (dock) {
      const wrap = dock.querySelector('.next-month-wrap') || dock;
      wrap.insertBefore(btn, wrap.firstChild);
    } else {
      document.body.appendChild(btn);
    }
  }
  btn.addEventListener('click', async () => {
    const d = await loadOtherCompanies();
    await renderPanel(d);
  });
}
