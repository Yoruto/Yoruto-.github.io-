/**
 * 房地产投资 — 新开业务面板 HTML 构建（由 main.js 注入）
 */

const TYPE_LABELS = {
  residential: '住宅开发',
  commercial: '商业地产',
  office: '写字楼',
  industrial: '产业园区',
};

const RISK_LABELS = { low: '低', medium: '中', high: '高' };

export function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function riskLabel(risk) {
  return RISK_LABELS[risk] || risk || '—';
}

export function typeLabel(typeId) {
  return TYPE_LABELS[typeId] || typeId || '—';
}

/**
 * @param {{ state: { year?: number }, projects: object[], idleEmployees: {id:string,name:string}[], embedInForm?: boolean }} opts
 * @param embedInForm 为 true 时嵌入「新开业务」主表单：不重复员工选择，使用上方 #dep-emp
 */
export function buildRealEstateNewBusinessHtml(opts) {
  const { state, projects, idleEmployees, embedInForm } = opts;
  const y = state?.year ?? 1990;
  if (!projects?.length) {
    return `<p class="hint">暂无可用项目（请确认已加载 real-estate-projects 配置）。</p>`;
  }

  const cards = projects
    .map((p, idx) => {
      const roiPct = `${Math.round((p.roiMin || 0) * 100)}%–${Math.round((p.roiMax || 0) * 100)}%`;
      return `
      <div class="re-card" style="background:#2a3d22;border:1px solid #5e4b34;border-radius:0.75rem;padding:0.75rem;min-width:200px;max-width:280px;">
        <div style="font-weight:700;color:#ffeaac;margin-bottom:0.35rem;">${escapeHtml(p.name)}</div>
        <div style="font-size:0.78rem;color:#ac9e7e;">${escapeHtml(typeLabel(p.type))}</div>
        <div style="font-size:0.8rem;margin-top:0.4rem;">周期 <strong>${p.cycleMonths}</strong> 月 · 风险 <strong>${riskLabel(p.risk)}</strong></div>
        <div style="font-size:0.8rem;">投资 <strong>${p.investWan}</strong> 万 · 预期回报率 ${roiPct}</div>
        <div style="margin-top:0.5rem;">
          <button type="button" class="primary small" data-action="add-realestate" data-re-idx="${idx}" ${idleEmployees.length ? '' : 'disabled'}>开工</button>
        </div>
      </div>`;
    })
    .join('');

  const head =
    (embedInForm
      ? `<p class="hint">请在上方选择<strong>员工</strong>，再点项目卡片上「开工」。尽调费 1% 立即扣除，建设期可能烂尾。</p>`
      : `<p class="hint">扩张期解锁：从下列机会中选择项目，指派员工并开工。尽调费 1% 立即扣除，建设期可能烂尾。</p>
      <div class="flex-row" style="margin-bottom:0.75rem;align-items:center;gap:0.75rem;">
        <label>指派员工
          <select id="re-emp">${
            idleEmployees.length
              ? idleEmployees.map((e) => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`).join('')
              : '<option value="">无可用员工</option>'
          }</select>
        </label>
      </div>`) + `<p class="hint">当前游戏年 <strong>${y}</strong>。未解锁类型会按配置过滤，早年可能退化为显示模板机会。</p>`;

  const body = `${head}
      <div style="display:flex;flex-wrap:wrap;gap:0.75rem;">${cards}</div>`;

  if (embedInForm) {
    return body;
  }
  return `<div class="panel">${body}</div>`;
}
