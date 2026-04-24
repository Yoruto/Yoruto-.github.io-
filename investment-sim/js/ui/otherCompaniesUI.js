import { loadOtherCompanies, getCategories, getCompaniesByCategory, getCompanyById } from '../core/otherCompanies.js';

function createButton() {
  let btn = document.getElementById('other-companies-btn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'other-companies-btn';
    btn.className = 'small';
    btn.style.marginLeft = '8px';
    btn.textContent = '其他公司';
    const container = document.querySelector('.topbar') || document.body;
    container.insertBefore(btn, container.firstChild);
  }
  return btn;
}

function renderPanel(data) {
  let panel = document.getElementById('other-companies-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'other-companies-panel';
    panel.className = 'modal-overlay';
    document.body.appendChild(panel);
  }
  const cats = data.categories || [];
  const companies = data.companies || [];
  const tabs = cats.map((c, i) => `<button class="oc-tab" data-cat="${c.id}">${c.icon || ''} ${c.name}</button>`).join('');
  const items = companies.slice(0, 20).map((c) => `
    <div class="oc-item" data-id="${c.id}">
      <div><strong>${c.name}</strong> · ${c.shortName || ''}</div>
      <div class="hint">${c.description || ''}</div>
      <div><button class="oc-view" data-id="${c.id}">查看详情</button></div>
    </div>
  `).join('');
  panel.innerHTML = `
    <div class="panel-card">
      <div class="panel-header">其他公司 <button id="oc-close" class="small">×</button></div>
      <div class="panel-tabs">${tabs}</div>
      <div id="oc-list" class="panel-list">${items}</div>
      <div id="oc-detail" class="panel-detail" style="display:none"></div>
    </div>
  `;
  panel.querySelector('#oc-close').addEventListener('click', () => (panel.style.display = 'none'));
  panel.style.display = 'block';

  const tabEls = panel.querySelectorAll('.oc-tab');
  tabEls.forEach((t) => t.addEventListener('click', async (e) => {
    const id = e.currentTarget.getAttribute('data-cat');
    const list = await getCompaniesByCategory(id);
    const html = list.map((c) => `
      <div class="oc-item" data-id="${c.id}">
        <div><strong>${c.name}</strong> · ${c.shortName || ''}</div>
        <div class="hint">${c.description || ''}</div>
        <div><button class="oc-view" data-id="${c.id}">查看详情</button></div>
      </div>
    `).join('');
    panel.querySelector('#oc-list').innerHTML = html;
    bindListButtons(panel);
  }));

  bindListButtons(panel);
}

function bindListButtons(panel) {
  const views = panel.querySelectorAll('.oc-view');
  views.forEach((b) => b.addEventListener('click', async (e) => {
    const id = e.currentTarget.getAttribute('data-id');
    const obj = await getCompanyById(id);
    const detail = panel.querySelector('#oc-detail');
    detail.style.display = 'block';
    detail.innerHTML = `
      <h3>${obj.name} (${obj.shortName || ''})</h3>
      <p>${obj.description || ''}</p>
      <p>成立：${obj.foundingYear || '—'} · 总部：${obj.headquarters || '—'}</p>
      <p>投资重点：${(obj.investmentFocus || []).join(', ')}</p>
      <div style="margin-top:0.5rem;"><button id="oc-back" class="small">返回</button></div>
    `;
    detail.querySelector('#oc-back').addEventListener('click', () => { detail.style.display = 'none'; });
  }));
}

export async function initOtherCompaniesUI() {
  const btn = createButton();
  const data = await loadOtherCompanies();
  btn.addEventListener('click', () => renderPanel(data));
}
