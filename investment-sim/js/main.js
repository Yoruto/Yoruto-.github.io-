/**
 * 《投资公司发展物语 V2.0》— 并行面板 UI（参考 futures-game 布局）
 */
import {
  createInitialState,
  getTotalCapacity,
  canPromote,
  SCHEMA_VERSION,
} from './core/state.js';
import { SENTIMENT_LABELS, SENTIMENT_ICONS, STOCK_GUIDE_LABELS, OFFICE_GRADES, B_STOCK_BP_BY_C, B_FUT_BP_BY_C } from './core/tables.js';
import {
  runMonthOpening,
  addActiveBusiness,
  closeActiveBusiness,
  setBusinessProfitPolicy,
  applyGuidance,
  endTurn,
  resolveMargin,
  runRecruit,
  runTrain,
  runPromote,
  runFireEmployee,
  runRenameEmployee,
  runLeaseOffice,
  runReleaseLease,
  runPurchaseOffice,
  runSellOwnedOffice,
  employeeCanDeploy,
  hasActiveBusiness,
} from './core/monthEngine.js';
import { saveToLocal, loadFromLocal, clearLocal, exportJson, importJson } from './core/persistence.js';

const $ = (sel, root = document) => root.querySelector(sel);

let config = null;
let state = null;
let currentView = 'market'; // 当前C区域显示的视图
let selectedBusinessId = null; // 当前选中的业务ID（用于业务详情视图）

// 情绪标签渲染（带样式类）
function sentimentLine(c, withClass = false) {
  const i = Math.max(0, Math.min(4, c | 0));
  const text = `${SENTIMENT_ICONS[i]} ${SENTIMENT_LABELS[i]}`;
  if (!withClass) return `${text}（c=${i}）`;

  const classMap = ['sentiment-bear', 'sentiment-bear', 'sentiment-neutral', 'sentiment-bull', 'sentiment-bull'];
  return `<span class="${classMap[i]}">${text}</span>`;
}

// 纯文本版本（用于兼容性）
function sentimentText(c) {
  const i = Math.max(0, Math.min(4, c | 0));
  return `${SENTIMENT_ICONS[i]} ${SENTIMENT_LABELS[i]}（c=${i}）`;
}

function formatMoney(x) {
  return `${Math.round(x * 10) / 10} 万`;
}

function portfolioSummary(b) {
  if (b.kind !== 'stock' || !b.stockPortfolio?.length) return '—';
  return b.stockPortfolio
    .map((p) => {
      const st = config.stocks.find((s) => s.id === p.stockId);
      const name = st?.shortName || p.stockId;
      return `${name} ${(p.weightBp / 100).toFixed(1)}%`;
    })
    .join(' · ');
}

function renderHrPanel() {
  const tiers =
    state.year >= 2006 ? ['junior', 'mid', 'senior'] : state.year >= 1996 ? ['junior', 'mid'] : ['junior'];
  const tierLabels = { junior: '初级', mid: '中级', senior: '高级' };
  const officeOpts = ['standard', 'business', 'hq'].filter((gid) => state.year >= OFFICE_GRADES[gid].unlockYear);
  const prom = state.employees.filter((e) => canPromote(e));
  const trainCandidates = state.employees.filter((e) => {
    if (state.trainedThisMonth) return false;
    if (e.ability >= 10) return false;
    return !hasActiveBusiness(state, e.id);
  });

  const leaseRows = state.offices
    .map((o, i) => {
      const g = OFFICE_GRADES[o.gradeId];
      const tag = o.kind === 'owned' ? '自有' : '租赁';
      const fee =
        o.kind === 'lease' ? `租 ${g.monthlyRentWan}万/月` : `购入 ${o.purchasePriceWan}万 · 税1%/年`;
      return `<tr><td>${i}</td><td>${g.name}</td><td>${tag}</td><td>+${g.capacity}</td><td>${fee}</td><td>${
        o.kind === 'lease'
          ? `<button type="button" class="small danger" data-action="release-lease" data-idx="${i}">退租</button>`
          : `<button type="button" class="small danger" data-action="sell-owned" data-idx="${i}">出售</button>`
      }</td></tr>`;
    })
    .join('');

  return `
    <div class="panel">
      <h2 class="section-title">人事与写字楼</h2>
      <div class="flex-row" style="margin-bottom:0.75rem; gap:1rem;">
        <div>
          <span class="hint">招聘</span><br/>
          <select id="hr-tier">${tiers.map((t) => `<option value="${t}">${tierLabels[t]}</option>`).join('')}</select>
          <button type="button" data-action="recruit">招聘</button>
        </div>
        <div>
          <span class="hint">培训（1人次/月）</span><br/>
          <select id="hr-train">${state.employees
            .map((e) => {
              const ok = trainCandidates.some((x) => x.id === e.id);
              return `<option value="${e.id}" ${ok ? '' : 'disabled'}>${e.name} 能${e.ability}</option>`;
            })
            .join('')}</select>
          <button type="button" data-action="train">培训</button>
        </div>
        <div>
          <span class="hint">晋升</span><br/>
          <select id="hr-prom">${state.employees
            .map((e) => {
              const ok = prom.some((x) => x.id === e.id);
              return `<option value="${e.id}" ${ok ? '' : 'disabled'}>${e.name}</option>`;
            })
            .join('')}</select>
          <button type="button" data-action="promote">晋升</button>
        </div>
      </div>
      <table class="data-table"><thead><tr><th>#</th><th>写字楼</th><th>类型</th><th>容量</th><th>费用</th><th></th></tr></thead>
      <tbody>${leaseRows}</tbody></table>
      <div class="flex-row" style="margin-top:0.5rem;">
        <select id="hr-lease-grade">${officeOpts
          .map((gid) => {
            const g = OFFICE_GRADES[gid];
            return `<option value="${gid}">租 ${g.name} +${g.capacity}人 / ${g.monthlyRentWan}万</option>`;
          })
          .join('')}</select>
        <button type="button" data-action="lease">租赁</button>
        ${
          state.year >= 2010
            ? `<select id="hr-buy-grade">${['standard', 'business', 'hq']
                .filter((gid) => state.year >= OFFICE_GRADES[gid].unlockYear)
                .map((gid) => {
                  const g = OFFICE_GRADES[gid];
                  return `<option value="${gid}">购 ${g.name} ${g.purchasePriceWan}万</option>`;
                })
                .join('')}</select><button type="button" data-action="buy-office">购买</button>`
            : '<span class="hint">2010年后可购楼</span>'
        }
      </div>
      <p class="hint" style="margin-top:0.5rem;">房地产/并购等：后续版本开放。</p>
    </div>`;
}

function renderGuidePanel() {
  const opts = state.activeBusinesses
    .map((b) => {
      const name = state.employees.find((e) => e.id === b.employeeId)?.name || '';
      return `<option value="${b.id}" data-kind="${b.kind}">${name} · ${b.kind === 'stock' ? '股票' : '期货'}</option>`;
    })
    .join('');

  const weightGrid = config.stocks
    .map((s) => {
      return `<label>${s.shortName}<input type="number" class="guide-w narrow" data-stock-id="${s.id}" min="0" max="100" step="0.1" value="0" /></label>`;
    })
    .join('');

  return `
    <div class="panel">
      <h2 class="section-title">本月指导（全公司 1 次）</h2>
      <p class="hint">同一笔指导可同时修改：<strong>股票</strong>风格+组合（权重合计 100%）、<strong>期货</strong>杠杆，以及<strong>资金</strong>（正=公司划给业务增资，负=从业务减资划回公司；减资后 AUM 不少于 1 万）。上交模式会同步增减「初始本金」以便月结基数一致。</p>
      <p>剩余指导：<strong>${state.guidanceRemaining}</strong> 次</p>
      <div class="flex-row" style="margin:0.5rem 0;">
        <label>目标业务 <select id="guide-biz">${opts || '<option value="">无在营业务</option>'}</select></label>
        <label>资金调拨(万) <input type="number" id="guide-aum-delta" class="narrow" step="0.1" placeholder="不改则留空" title="正数增资、负数减资，可与策略同时提交" /></label>
      </div>
      <div id="guide-stock-block">
        <p class="hint">股票指导风格</p>
        <select id="guide-mode">
          <option value="0">${STOCK_GUIDE_LABELS[0]}</option>
          <option value="1" selected>${STOCK_GUIDE_LABELS[1]}</option>
          <option value="2">${STOCK_GUIDE_LABELS[2]}</option>
        </select>
        <p class="hint" style="margin-top:0.5rem;">组合权重（%，总和须为 100；可只改风格不改组合）</p>
        <div class="guide-grid" id="guide-weights">${weightGrid}</div>
        <button type="button" class="small" data-action="guide-fill-equal">均分仓位（前4支或当前非零）</button>
      </div>
      <div id="guide-fut-block">
        <p class="hint">期货杠杆</p>
        <select id="guide-lev"><option value="1">1x</option><option value="2">2x</option><option value="3">3x</option></select>
      </div>
      <div style="margin-top:0.75rem;">
        <button type="button" class="primary" data-action="apply-guide" ${state.guidanceRemaining < 1 ? 'disabled' : ''}>应用指导（消耗 1 次）</button>
      </div>
    </div>`;
}

// ========== C区域视图渲染函数 ==========

// 根据宏观行情计算股票实际涨跌幅（万分比 -> 百分比显示）
// 获取股票的三个影响因子（单位：万分比）
function getStockFactors(stock, cMacro) {
  const sec = config.sectors?.find((x) => x.id === stock.sectorId);
  // 1. 大环境因子
  const macroFactor = B_STOCK_BP_BY_C[cMacro] || 0;
  // 2. 行业影响因子
  const sectorFactor = sec?.sectorBetaBp || 0;
  // 3. 个股自身影响因子
  const stockFactor = stock.betaExtraBp || 0;
  return { macroFactor, sectorFactor, stockFactor };
}

// 计算股票总收益率（基于三个因子）
function calculateStockReturn(stock, cMacro) {
  const { macroFactor, sectorFactor, stockFactor } = getStockFactors(stock, cMacro);
  // 总收益 = 大环境 + 行业 + 个股
  const totalReturnBp = macroFactor + sectorFactor + stockFactor;
  return (totalReturnBp / 100).toFixed(2);
}

// 计算股价（基于basePrice配置）
function calculateStockPrice(stock, cMacro) {
  const basePrice = stock.basePrice || 100;
  const totalReturnBp = Number(calculateStockReturn(stock, cMacro)) * 100;
  const price = basePrice * (1 + totalReturnBp / 10000);
  return price.toFixed(2);
}

// 1. 市场行情视图
function renderMarketView() {
  const cMacro = state.actualEquityC;
  const macroReturn = (B_STOCK_BP_BY_C[cMacro] / 100).toFixed(2);
  return `
    <div class="view-section">
      <h2 class="section-title">股票市场（均可配置进组合）</h2>
      <p class="hint">本月宏观行情：股市 ${sentimentText(state.actualEquityC)} · 大环境因子 ${macroReturn}%</p>
      <table class="data-table">
        <thead><tr><th>代码</th><th>简称</th><th>行业</th><th>股价</th><th>本月涨跌</th><th>涨跌分解</th></tr></thead>
        <tbody>
          ${config.stocks
            .map((s) => {
              const sec = config.sectors?.find((x) => x.id === s.sectorId);
              const price = calculateStockPrice(s, cMacro);
              const returnPct = calculateStockReturn(s, cMacro);
              const { macroFactor, sectorFactor, stockFactor } = getStockFactors(s, cMacro);
              const returnClass = Number(returnPct) > 0 ? 'up' : Number(returnPct) < 0 ? 'down' : 'neutral';
              const returnIcon = Number(returnPct) > 0 ? '▲' : Number(returnPct) < 0 ? '▼' : '—';
              return `<tr>
                <td>${s.id}</td>
                <td>${s.shortName}</td>
                <td>${sec?.name || s.sectorId}</td>
                <td>${price}</td>
                <td class="return-${returnClass}">${returnIcon} ${returnPct}%</td>
                <td style="font-size:0.7rem;color:#ac9e7e;">
                  大环境${(macroFactor/100).toFixed(1)}% + 行业${(sectorFactor/100).toFixed(1)}% + 个股${(stockFactor/100).toFixed(1)}%
                </td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>

      <h2 class="section-title" style="margin-top:1.5rem">期货市场</h2>
      <p class="hint">本月宏观行情：大宗 ${sentimentText(state.actualCommodityC)} · 预期收益 ${(B_FUT_BP_BY_C[state.actualCommodityC] / 100).toFixed(2)}%</p>
      <table class="data-table">
        <thead><tr><th>品种</th><th>说明</th><th>杠杆上限</th></tr></thead>
        <tbody>
          ${Object.entries(config.futures?.variants || {})
            .map(([k, v]) => `<tr><td>${v.displayName}</td><td>${v.description || '-'}</td><td>3x</td></tr>`)
            .join('')}
        </tbody>
      </table>
    </div>`;
}

// 2. 在营业务总览视图
function renderBusinessListView() {
  if (!state.activeBusinesses.length) {
    return `
      <div class="view-section">
        <h2 class="section-title">在营业务</h2>
        <p class="hint">暂无在营业务。点击左侧「新开业务」或下方按钮创建。</p>
        <button type="button" class="primary" data-action="switch-view" data-view="new-business">前往新开业务</button>
      </div>`;
  }

  return `
    <div class="view-section">
      <h2 class="section-title">在营业务总览</h2>
      <div class="business-grid">
        ${state.activeBusinesses.map((b) => {
          const emp = state.employees.find((e) => e.id === b.employeeId);
          const pol = b.profitPolicy === 'reinvest' ? '复利' : '上交';
          const typeClass = b.kind === 'stock' ? 'stock' : 'fut';
          const typeName = b.kind === 'stock' ? '股票' : '期货';
          return `
            <div class="biz-card" data-action="view-business-detail" data-bid="${b.id}">
              <div class="card-header">
                <span class="card-type ${typeClass}">${typeName}</span>
                <span style="font-size:0.75rem;color:#ac9e7e">${pol}</span>
              </div>
              <div style="margin-bottom:0.5rem;">
                <strong style="color:#ffeaac;">${emp?.name || '未知'}</strong>
              </div>
              <div style="font-size:0.8rem;color:#ffd966;">AUM: ${formatMoney(b.aumWan)}</div>
              <div style="font-size:0.7rem;color:#ac9e7e;margin-top:0.25rem;">初始: ${formatMoney(b.initialWan)}</div>
            </div>
          `;
        }).join('')}
      </div>
    </div>`;
}

// 3. 单个业务详情视图
function renderBusinessDetailView() {
  const b = state.activeBusinesses.find((x) => x.id === selectedBusinessId);
  if (!b) {
    selectedBusinessId = null;
    currentView = 'business-list';
    return renderBusinessListView();
  }

  const emp = state.employees.find((e) => e.id === b.employeeId);
  const pol = b.profitPolicy === 'reinvest' ? '复利' : '上交';
  const typeName = b.kind === 'stock' ? '股票' : '期货';

  // 组合摘要
  let portfolioHtml = '—';
  if (b.kind === 'stock' && b.stockPortfolio?.length) {
    portfolioHtml = b.stockPortfolio
      .map((p) => {
        const st = config.stocks.find((s) => s.id === p.stockId);
        const name = st?.shortName || p.stockId;
        return `${name} ${(p.weightBp / 100).toFixed(1)}%`;
      })
      .join(' · ');
  } else if (b.kind === 'fut') {
    const varInfo = config.futures?.variants[b.futuresVariantId];
    portfolioHtml = `品种: ${varInfo?.displayName || b.futuresVariantId} · 杠杆: ${b.leverage}x`;
  }

  return `
    <div class="view-section">
      <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem;">
        <button type="button" class="small" data-action="switch-view" data-view="business-list">← 返回列表</button>
        <h2 class="section-title" style="margin:0;">${emp?.name || '未知'} · ${typeName}业务详情</h2>
      </div>

      <div class="overview-stats" style="grid-template-columns:repeat(4,1fr);">
        <div class="stat-box">
          <div class="label">AUM</div>
          <div class="value">${formatMoney(b.aumWan)}</div>
        </div>
        <div class="stat-box">
          <div class="label">初始本金</div>
          <div class="value">${formatMoney(b.initialWan)}</div>
        </div>
        <div class="stat-box">
          <div class="label">利润策略</div>
          <div class="value">${pol}</div>
        </div>
        <div class="stat-box">
          <div class="label">${b.kind === 'stock' ? '指导风格' : '杠杆'}</div>
          <div class="value">${b.kind === 'stock' ? STOCK_GUIDE_LABELS[b.stockGuideMode ?? 1] : b.leverage + 'x'}</div>
        </div>
      </div>

      <div class="panel">
        <h3 class="section-title">组合/配置</h3>
        <p>${portfolioHtml}</p>
      </div>

      <div class="panel">
        <h3 class="section-title">操作</h3>
        <div class="flex-row">
          <label>利润策略
            <select data-action="set-policy" data-bid="${b.id}">
              <option value="reinvest" ${b.profitPolicy === 'reinvest' ? 'selected' : ''}>复利</option>
              <option value="remit" ${b.profitPolicy === 'remit' ? 'selected' : ''}>上交</option>
            </select>
          </label>
          <button type="button" class="danger" data-action="close-business" data-bid="${b.id}">结业清算</button>
        </div>
      </div>
    </div>`;
}

// 4. 新开业务视图
function renderNewBusinessView() {
  const idle = state.employees.filter((e) => employeeCanDeploy(state, e));
  const variants = Object.keys(config?.futures?.variants || {});

  return `
    <div class="view-section">
      <h2 class="section-title">新开业务</h2>
      <p class="hint">股票业务：开业时由员工自动生成 2～4 支股票的组合。期货：自选品种与初始杠杆。</p>

      <div class="panel">
        <div class="flex-row" style="gap:0.75rem; flex-wrap:wrap;">
          <label>员工<select id="dep-emp">${idle.map((e) => `<option value="${e.id}">${e.name} 能${e.ability}</option>`).join('')}</select></label>
          <label>类型<select id="dep-kind"><option value="stock">股票</option><option value="fut">期货</option></select></label>
          <label>本金(万)<input type="number" id="dep-alloc" class="narrow" value="20" min="1" /></label>
          <label>利润分配<select id="dep-policy"><option value="reinvest">滚存复利</option><option value="remit">上交公司</option></select></label>
        </div>
        <div id="dep-fut-wrap" class="hidden" style="margin-top:0.5rem;">
          <label>品种 <select id="dep-futvar">${variants.map((v) => `<option value="${v}">${config.futures.variants[v].displayName}</option>`).join('')}</select></label>
          <label>杠杆 <select id="dep-lev"><option value="1">1x</option><option value="2">2x</option><option value="3">3x</option></select></label>
        </div>
        <div id="dep-stock-wrap" style="margin-top:0.5rem;">
          <span class="hint">股票默认指导风格（开业）</span>
          <select id="dep-mode"><option value="0">${STOCK_GUIDE_LABELS[0]}</option><option value="1" selected>${STOCK_GUIDE_LABELS[1]}</option><option value="2">${STOCK_GUIDE_LABELS[2]}</option></select>
        </div>
        <div style="margin-top:0.6rem;">
          <button type="button" class="primary" data-action="add-order" ${idle.length ? '' : 'disabled'}>开业</button>
          ${!idle.length ? '<span class="hint"> 无空闲员工</span>' : ''}
        </div>
      </div>
    </div>`;
}

// 5. 本月指导视图
function renderGuideView() {
  if (!state.activeBusinesses.length) {
    return `
      <div class="view-section">
        <h2 class="section-title">本月指导</h2>
        <p class="hint">暂无可指导的业务。请先开设业务。</p>
      </div>`;
  }
  return `<div class="view-section">${renderGuidePanel()}</div>`;
}

// 6. 人事招聘视图
function renderHrView() {
  const tiers =
    state.year >= 2006 ? ['junior', 'mid', 'senior'] : state.year >= 1996 ? ['junior', 'mid'] : ['junior'];
  const tierLabels = { junior: '初级', mid: '中级', senior: '高级' };
  const officeOpts = ['standard', 'business', 'hq'].filter((gid) => state.year >= OFFICE_GRADES[gid].unlockYear);
  const prom = state.employees.filter((e) => canPromote(e));
  const trainCandidates = state.employees.filter((e) => {
    if (state.trainedThisMonth) return false;
    if (e.ability >= 10) return false;
    return !hasActiveBusiness(state, e.id);
  });

  // 可开除的员工（没有在营业务的）
  const fireableEmployees = state.employees.filter((e) => !hasActiveBusiness(state, e.id));

  const leaseRows = state.offices
    .map((o, i) => {
      const g = OFFICE_GRADES[o.gradeId];
      const tag = o.kind === 'owned' ? '自有' : '租赁';
      const fee =
        o.kind === 'lease' ? `租 ${g.monthlyRentWan}万/月` : `购入 ${o.purchasePriceWan}万 · 税1%/年`;
      return `<tr><td>${i}</td><td>${g.name}</td><td>${tag}</td><td>+${g.capacity}</td><td>${fee}</td><td>${
        o.kind === 'lease'
          ? `<button type="button" class="small danger" data-action="release-lease" data-idx="${i}">退租</button>`
          : `<button type="button" class="small danger" data-action="sell-owned" data-idx="${i}">出售</button>`
      }</td></tr>`;
    })
    .join('');

  return `
    <div class="view-section">
      <h2 class="section-title">人事与写字楼</h2>

      <div class="panel">
        <h3 class="section-title">招聘</h3>
        <div class="flex-row" style="margin-bottom:0.75rem; gap:1rem;">
          <div>
            <span class="hint">招聘等级</span><br/>
            <select id="hr-tier">${tiers.map((t) => `<option value="${t}">${tierLabels[t]}</option>`).join('')}</select>
            <button type="button" data-action="recruit">招聘</button>
          </div>
        </div>
      </div>

      <div class="panel">
        <h3 class="section-title">培训（1人次/月）</h3>
        <div class="flex-row" style="gap:1rem;">
          <select id="hr-train">${state.employees
            .map((e) => {
              const ok = trainCandidates.some((x) => x.id === e.id);
              return `<option value="${e.id}" ${ok ? '' : 'disabled'}>${e.name} 能${e.ability}</option>`;
            })
            .join('')}</select>
          <button type="button" data-action="train">培训</button>
        </div>
      </div>

      <div class="panel">
        <h3 class="section-title">晋升</h3>
        <div class="flex-row" style="gap:1rem;">
          <select id="hr-prom">${state.employees
            .map((e) => {
              const ok = prom.some((x) => x.id === e.id);
              return `<option value="${e.id}" ${ok ? '' : 'disabled'}>${e.name}</option>`;
            })
            .join('')}</select>
          <button type="button" data-action="promote">晋升</button>
        </div>
      </div>

      <div class="panel">
        <h3 class="section-title">员工管理</h3>
        <table class="data-table">
          <thead><tr><th>姓名</th><th>等级</th><th>能力</th><th>忠诚</th><th>工龄</th><th>操作</th></tr></thead>
          <tbody>
            ${state.employees.map((e) => {
              const tierLabels = { junior: '初级', mid: '中级', senior: '高级' };
              const hasBiz = hasActiveBusiness(state, e.id);
              return `<tr>
                <td>
                  <input type="text" class="small" value="${e.name}" data-action="rename-emp" data-eid="${e.id}" style="width:80px;padding:2px 4px;font-size:0.75rem;" />
                </td>
                <td>${tierLabels[e.tier] || e.tier}</td>
                <td>${e.ability}</td>
                <td>${e.loyalty}</td>
                <td>${e.experienceMonths}月</td>
                <td>
                  ${!hasBiz
                    ? `<button type="button" class="small danger" data-action="fire-emp" data-eid="${e.id}">开除</button>`
                    : '<span class="hint">负责业务中</span>'}
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        <p class="hint">点击员工姓名可直接编辑修改</p>
      </div>

      <div class="panel">
        <h3 class="section-title">写字楼</h3>
        <table class="data-table"><thead><tr><th>#</th><th>写字楼</th><th>类型</th><th>容量</th><th>费用</th><th></th></tr></thead>
        <tbody>${leaseRows}</tbody></table>
        <div class="flex-row" style="margin-top:0.5rem;">
          <select id="hr-lease-grade">${officeOpts
            .map((gid) => {
              const g = OFFICE_GRADES[gid];
              return `<option value="${gid}">租 ${g.name} +${g.capacity}人 / ${g.monthlyRentWan}万</option>`;
            })
            .join('')}</select>
          <button type="button" data-action="lease">租赁</button>
          ${
            state.year >= 2010
              ? `<select id="hr-buy-grade">${['standard', 'business', 'hq']
                  .filter((gid) => state.year >= OFFICE_GRADES[gid].unlockYear)
                  .map((gid) => {
                    const g = OFFICE_GRADES[gid];
                    return `<option value="${gid}">购 ${g.name} ${g.purchasePriceWan}万</option>`;
                  })
                  .join('')}</select><button type="button" data-action="buy-office">购买</button>`
              : '<span class="hint">2010年后可购楼</span>'
          }
        </div>
      </div>
    </div>`;
}

// 7. 公司情况视图
function renderCompanyView() {
  const cap = getTotalCapacity(state);

  return `
    <div class="view-section">
      <h2 class="section-title">公司概览</h2>

      <div class="overview-stats">
        <div class="stat-box">
          <div class="label">现金</div>
          <div class="value">${formatMoney(state.companyCashWan)}</div>
        </div>
        <div class="stat-box">
          <div class="label">声誉</div>
          <div class="value">${state.reputation}</div>
        </div>
        <div class="stat-box">
          <div class="label">员工</div>
          <div class="value">${state.employees.length}/${cap}</div>
        </div>
        <div class="stat-box">
          <div class="label">写字楼</div>
          <div class="value">${state.offices.length}</div>
        </div>
      </div>

      <div class="panel">
        <h3 class="section-title">员工列表</h3>
        <table class="data-table">
          <thead><tr><th>姓名</th><th>等级</th><th>能力</th><th>忠诚</th><th>工龄(月)</th></tr></thead>
          <tbody>
            ${state.employees.map((e) => {
              const tierLabels = { junior: '初级', mid: '中级', senior: '高级' };
              return `<tr><td>${e.name}</td><td>${tierLabels[e.tier] || e.tier}</td><td>${e.ability}</td><td>${e.loyalty}</td><td>${e.experienceMonths}</td></tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>

      <div class="panel">
        <h3 class="section-title">写字楼资产</h3>
        <table class="data-table">
          <thead><tr><th>#</th><th>类型</th><th>容量</th><th>费用</th><th>操作</th></tr></thead>
          <tbody>
            ${state.offices.map((o, i) => {
              const g = OFFICE_GRADES[o.gradeId];
              const tag = o.kind === 'owned' ? '自有' : '租赁';
              const fee = o.kind === 'lease' ? `${g.monthlyRentWan}万/月` : `${o.purchasePriceWan}万购入`;
              return `<tr><td>${i}</td><td>${g.name}</td><td>+${g.capacity}</td><td>${fee}</td><td>
                ${o.kind === 'lease'
                  ? `<button type="button" class="small danger" data-action="release-lease" data-idx="${i}">退租</button>`
                  : `<button type="button" class="small danger" data-action="sell-owned" data-idx="${i}">出售</button>`}
              </td></tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>

      <div class="panel">
        <h3 class="section-title">存档管理</h3>
        <div class="flex-row">
          <button type="button" data-action="save">保存</button>
          <button type="button" data-action="export">导出 JSON</button>
          <button type="button" data-action="import">导入</button>
          <button type="button" class="danger" data-action="clear-save">清除存档</button>
        </div>
      </div>
    </div>`;
}

// 视图路由器
const viewRenderers = {
  'market': renderMarketView,
  'business-list': renderBusinessListView,
  'business-detail': renderBusinessDetailView,
  'new-business': renderNewBusinessView,
  'guide': renderGuideView,
  'hr': renderHrView,
  'company': renderCompanyView,
};

// ========== B区域侧边栏渲染 ==========
function renderSidebar() {
  const sidebar = $('#sidebar-b');
  if (!sidebar) return;

  // 更新功能按钮激活状态
  sidebar.querySelectorAll('.function-nav button').forEach((btn) => {
    const view = btn.dataset.view;
    btn.classList.toggle('active', view === currentView);
  });

  // 渲染已开展业务列表
  const bizList = $('#active-biz-list');
  if (!state.activeBusinesses.length) {
    bizList.innerHTML = '<p class="empty-biz-hint">暂无在营业务</p>';
    return;
  }

  bizList.innerHTML = state.activeBusinesses.map((b) => {
    const emp = state.employees.find((e) => e.id === b.employeeId);
    const isActive = currentView === 'business-detail' && selectedBusinessId === b.id;
    return `
      <div class="biz-thumb ${isActive ? 'active' : ''}" data-action="view-business-detail" data-bid="${b.id}">
        <div class="biz-name">${emp?.name || '未知'} · ${b.kind === 'stock' ? '股票' : '期货'}</div>
        <div class="biz-meta">AUM: <span class="biz-aum">${formatMoney(b.aumWan)}</span></div>
      </div>
    `;
  }).join('');
}

function render() {
  const root = $('#app');
  const dock = $('#month-dock');
  const sidebar = $('#sidebar-b');

  if (!state) {
    if (dock) dock.innerHTML = '';
    if (sidebar) sidebar.classList.add('hidden');
    root.innerHTML = '<p class="hint">尚未初始化</p>';
    return;
  }

  if (state.gameOver) {
    if (dock) dock.innerHTML = '';
    if (sidebar) sidebar.classList.add('hidden');
    root.innerHTML = `<div class="panel end-modal"><h2>游戏结束</h2><p>${state.gameOverReason}</p><button type="button" class="primary" data-action="new-game">新游戏</button></div>`;
    bindActions(root);
    return;
  }

  if (state.victory) {
    if (dock) dock.innerHTML = '';
    if (sidebar) sidebar.classList.add('hidden');
    root.innerHTML = `<div class="panel end-modal"><h2>终局</h2><p>最终现金 <strong>${formatMoney(state.companyCashWan)}</strong></p><button type="button" class="primary" data-action="new-game">新游戏</button></div>`;
    bindActions(root);
    return;
  }

  const cap = getTotalCapacity(state);
  const canNext = state.phase !== 'margin' && !state.pendingMargin.length && !state.gameOver && !state.victory;

  // ========== A区域: 顶栏（含宏观行情）==========
  if (dock) {
    dock.innerHTML = `
      <div class="month-dock-inner">
        <div class="status-bar">
          <div class="stat-row">
            <div class="stat-card"><span class="lbl">现金</span><span class="val">${formatMoney(state.companyCashWan)}</span></div>
            <div class="stat-card"><span class="lbl">年月</span><span class="val">${state.year}-${String(state.month).padStart(2, '0')}</span></div>
            <div class="stat-card"><span class="lbl">声誉</span><span class="val">${state.reputation}</span></div>
            <div class="stat-card"><span class="lbl">员工</span><span class="val">${state.employees.length}/${cap}</span></div>
            <div class="stat-card"><span class="lbl">种子</span><span class="val">${state.gameSeed}</span></div>
            <div class="stat-card market-sentiment"><span class="lbl">股市</span><span class="val">${sentimentLine(state.actualEquityC, true)}</span></div>
            <div class="stat-card market-sentiment"><span class="lbl">大宗</span><span class="val">${sentimentLine(state.actualCommodityC, true)}</span></div>
          </div>
        </div>
        <div class="next-month-wrap">
          <button type="button" class="primary" data-action="next-month" ${canNext ? '' : 'disabled'} title="结算本月并进入下一月（需先处理透支）">下一个月</button>
          <button type="button" class="danger" data-action="new-game" title="重新开始新游戏（可输入种子）" style="margin-left:0.5rem;">快速重来</button>
        </div>
      </div>
      <p class="month-dock-hint">「下一个月」与下方经营面板分离：本月内可并行操作行情、在营业务、指导、开业与人事，准备好后再点此推进回合。下月预测：股市 ${sentimentText(state.predictedEquityC)} · 大宗 ${sentimentText(state.predictedCommodityC)}</p>
    `;
    bindActions(dock);
  }

  // ========== B区域: 侧边栏 ==========
  if (sidebar) {
    sidebar.classList.remove('hidden');
    renderSidebar();
    bindSidebarActions(sidebar);
  }

  // ========== C区域: 动态内容 ==========
  // 处理透支警告（在C区域顶部显示）
  const marginBlock =
    state.phase === 'margin' && state.pendingMargin.length
      ? `<div class="margin-alert">
          <strong>业务透支</strong> — 处理完毕后将自动进入下一月。
          ${state.pendingMargin
            .map(
              (m) => `
            <div style="margin:0.5rem 0;">
              <div>${m.employeeName} · ${m.kind === 'stock' ? '股票' : '期货'} · 余额 ${m.balance} 万</div>
              <input type="number" id="pay-${m.businessId}" placeholder="续资(万)" class="narrow" />
              <button type="button" data-action="margin-topup" data-id="${m.businessId}">续资</button>
              <button type="button" class="danger" data-action="margin-kill" data-id="${m.businessId}">清算</button>
            </div>`,
            )
            .join('')}
        </div>`
      : '';

  // 渲染当前视图
  const renderer = viewRenderers[currentView] || renderMarketView;
  root.innerHTML = marginBlock + renderer();

  // 绑定事件
  bindActions(root);

  // 特定视图的后处理
  if (currentView === 'new-business') {
    wireKindToggle(root);
  } else if (currentView === 'guide') {
    syncGuideBlocks(root);
    const gbiz = $('#guide-biz', root);
    gbiz?.addEventListener('change', () => {
      syncGuideBlocks(root);
      prefillGuideWeights(root);
    });
    prefillGuideWeights(root);
  }
}

function wireKindToggle(root) {
  const kind = $('#dep-kind', root);
  if (!kind) return;
  const sync = () => {
    const k = kind.value;
    $('#dep-fut-wrap', root)?.classList.toggle('hidden', k !== 'fut');
    $('#dep-stock-wrap', root)?.classList.toggle('hidden', k !== 'stock');
  };
  kind.addEventListener('change', sync);
  sync();
}

function syncGuideBlocks(root) {
  const sel = $('#guide-biz', root);
  if (!sel || !sel.value) {
    $('#guide-stock-block', root)?.classList.add('hidden');
    $('#guide-fut-block', root)?.classList.add('hidden');
    return;
  }
  const opt = sel.options[sel.selectedIndex];
  const k = opt?.getAttribute('data-kind');
  $('#guide-stock-block', root)?.classList.toggle('hidden', k !== 'stock');
  $('#guide-fut-block', root)?.classList.toggle('hidden', k !== 'fut');
}

function prefillGuideWeights(root) {
  const sel = $('#guide-biz', root);
  const bid = sel?.value;
  const aumInp = $('#guide-aum-delta', root);
  if (aumInp) aumInp.value = '';
  if (!bid) return;
  const b = state.activeBusinesses.find((x) => x.id === bid);
  if (!b) return;
  if (b.kind === 'stock') {
    const gm = $('#guide-mode', root);
    if (gm) gm.value = String(b.stockGuideMode ?? 1);
    const map = new Map((b.stockPortfolio || []).map((p) => [p.stockId, p.weightBp]));
    root.querySelectorAll('.guide-w').forEach((inp) => {
      const sid = inp.getAttribute('data-stock-id');
      const w = map.get(sid) || 0;
      inp.value = String(w / 100);
    });
  } else if (b.kind === 'fut') {
    const gl = $('#guide-lev', root);
    if (gl) gl.value = String(b.leverage ?? 1);
  }
}

function bindActions(...roots) {
  for (const root of roots) {
    if (!root) continue;
    root.querySelectorAll('[data-action]').forEach((el) => {
      const act = el.getAttribute('data-action');
      if (act === 'set-policy') el.addEventListener('change', onPolicyChange);
      else if (act === 'rename-emp') {
        // 改名：失焦或回车时触发
        el.addEventListener('blur', onAction);
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            el.blur(); // 触发 blur 事件
          }
        });
      }
      else el.addEventListener('click', onAction);
    });
  }
}

// B区域侧边栏事件绑定
function bindSidebarActions(sidebar) {
  if (!sidebar) return;

  // 功能导航按钮
  sidebar.querySelectorAll('.function-nav button[data-view]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const view = e.currentTarget.dataset.view;
      if (view && view !== currentView) {
        currentView = view;
        selectedBusinessId = null; // 切换主视图时清除选中
        render();
      }
    });
  });

  // 业务缩略列表
  sidebar.querySelectorAll('[data-action="view-business-detail"]').forEach((el) => {
    el.addEventListener('click', (e) => {
      const bid = e.currentTarget.dataset.bid;
      if (bid) {
        selectedBusinessId = bid;
        currentView = 'business-detail';
        render();
      }
    });
  });
}

function onPolicyChange(ev) {
  const sel = ev.currentTarget;
  const bid = sel.getAttribute('data-bid');
  const r = setBusinessProfitPolicy(state, bid, sel.value);
  if (!r.ok) alert(r.error);
  saveToLocal(state);
  render();
}

function collectGuidePortfolio(root) {
  const rows = [];
  root.querySelectorAll('.guide-w').forEach((inp) => {
    const pct = Number(inp.value);
    if (!Number.isFinite(pct) || pct <= 0) return;
    rows.push({ stockId: inp.getAttribute('data-stock-id'), weightBp: Math.round(pct * 100) });
  });
  const sum = rows.reduce((s, x) => s + x.weightBp, 0);
  if (rows.length && Math.abs(sum - 10000) > 2) {
    return { ok: false, error: `组合权重合计须为 100%（当前 ${(sum / 100).toFixed(1)}%）` };
  }
  return { ok: true, rows };
}

function onAction(ev) {
  const action = ev.currentTarget.getAttribute('data-action');
  const root = $('#app');

  if (action === 'new-game') {
    const seed = Number(prompt('种子（默认 1）', '1')) || 1;
    state = createInitialState(seed);
    currentView = 'market';
    selectedBusinessId = null;
    runMonthOpening(state);
    saveToLocal(state);
    render();
    return;
  }

  // 视图切换操作
  if (action === 'switch-view') {
    const view = ev.currentTarget.dataset.view;
    if (view && view !== currentView) {
      currentView = view;
      selectedBusinessId = null;
      render();
    }
    return;
  }

  // 查看业务详情（从业务卡片或缩略图）
  if (action === 'view-business-detail') {
    const bid = ev.currentTarget.dataset.bid;
    if (bid) {
      selectedBusinessId = bid;
      currentView = 'business-detail';
      render();
    }
    return;
  }

  if (action === 'next-month') {
    const r = endTurn(state, config);
    if (!r.ok) alert(r.error);
    saveToLocal(state);
    render();
    return;
  }
  if (action === 'add-order') {
    const kind = $('#dep-kind')?.value;
    const draft = {
      employeeId: $('#dep-emp')?.value,
      kind,
      allocWan: Number($('#dep-alloc')?.value),
      profitPolicy: $('#dep-policy')?.value || 'reinvest',
      stockGuideMode: Number($('#dep-mode')?.value ?? 1),
      leverage: Number($('#dep-lev')?.value ?? 1),
      futuresVariantId: $('#dep-futvar')?.value || 'composite',
    };
    const res = addActiveBusiness(state, draft, config);
    if (!res.ok) alert(res.error);
    saveToLocal(state);
    render();
    return;
  }
  if (action === 'apply-guide') {
    const bid = $('#guide-biz')?.value;
    if (!bid) {
      alert('请选择业务');
      return;
    }
    const b = state.activeBusinesses.find((x) => x.id === bid);
    const patch = {};
    const rawAum = $('#guide-aum-delta')?.value;
    if (rawAum != null && String(rawAum).trim() !== '') {
      patch.aumDeltaWan = Number(rawAum);
      if (!Number.isFinite(patch.aumDeltaWan)) {
        alert('资金调拨须为有效数字');
        return;
      }
    }
    if (b?.kind === 'stock') {
      patch.stockGuideMode = Number($('#guide-mode')?.value ?? 1);
      const pr = collectGuidePortfolio(root);
      if (!pr.ok) {
        alert(pr.error);
        return;
      }
      if (pr.rows.length) patch.stockPortfolio = pr.rows;
    } else if (b?.kind === 'fut') {
      patch.leverage = Number($('#guide-lev')?.value ?? 1);
    }
    const res = applyGuidance(state, bid, patch, config);
    if (!res.ok) alert(res.error);
    saveToLocal(state);
    render();
    return;
  }
  if (action === 'guide-fill-equal') {
    const inputs = [...root.querySelectorAll('.guide-w')].filter((i) => Number(i.value) > 0);
    const all = [...root.querySelectorAll('.guide-w')];
    if (!inputs.length) {
      const n = Math.min(4, all.length);
      const pct = 100 / n;
      all.slice(0, n).forEach((i) => {
        i.value = String(pct);
      });
    } else {
      const pct = 100 / inputs.length;
      inputs.forEach((i) => {
        i.value = String(pct);
      });
    }
    return;
  }
  if (action === 'close-business') {
    const bid = ev.currentTarget.getAttribute('data-bid');
    if (!confirm('结业？AUM 划回公司')) return;
    const r = closeActiveBusiness(state, bid);
    if (!r.ok) alert(r.error);
    saveToLocal(state);
    // 如果当前在业务详情视图且结业的是当前业务，返回列表视图
    if (currentView === 'business-detail' && selectedBusinessId === bid) {
      selectedBusinessId = null;
      currentView = 'business-list';
    }
    render();
    return;
  }
  if (action === 'recruit') {
    const r = runRecruit(state, $('#hr-tier')?.value);
    if (!r.ok) alert(r.error);
    saveToLocal(state);
    render();
    return;
  }
  if (action === 'train') {
    const r = runTrain(state, $('#hr-train')?.value);
    if (!r.ok) alert(r.error);
    saveToLocal(state);
    render();
    return;
  }
  if (action === 'promote') {
    const r = runPromote(state, $('#hr-prom')?.value);
    if (!r.ok) alert(r.error);
    saveToLocal(state);
    render();
    return;
  }
  if (action === 'fire-emp') {
    const eid = ev.currentTarget.getAttribute('data-eid');
    if (!confirm('确认开除该员工？需支付遣散费。')) return;
    const r = runFireEmployee(state, eid, config);
    if (!r.ok) alert(r.error);
    saveToLocal(state);
    render();
    return;
  }
  if (action === 'rename-emp') {
    // 改名通过 blur 或 enter 触发
    const eid = ev.currentTarget.getAttribute('data-eid');
    const newName = ev.currentTarget.value;
    const emp = state.employees.find((e) => e.id === eid);
    if (emp && newName !== emp.name) {
      const r = runRenameEmployee(state, eid, newName);
      if (!r.ok) {
        alert(r.error);
        ev.currentTarget.value = emp.name; // 恢复原值
      } else {
        saveToLocal(state);
        render();
      }
    }
    return;
  }
  if (action === 'lease') {
    const sel = $('#hr-lease-grade');
    if (!sel?.options.length) {
      alert('当前无可租档位');
      return;
    }
    const r = runLeaseOffice(state, sel.value);
    if (!r.ok) alert(r.error);
    saveToLocal(state);
    render();
    return;
  }
  if (action === 'buy-office') {
    const r = runPurchaseOffice(state, $('#hr-buy-grade')?.value);
    if (!r.ok) alert(r.error);
    saveToLocal(state);
    render();
    return;
  }
  if (action === 'release-lease') {
    const idx = Number(ev.currentTarget.getAttribute('data-idx'));
    if (!confirm('确认退租？')) return;
    const r = runReleaseLease(state, idx);
    if (!r.ok) alert(r.error);
    saveToLocal(state);
    render();
    return;
  }
  if (action === 'sell-owned') {
    const idx = Number(ev.currentTarget.getAttribute('data-idx'));
    if (!confirm('确认出售？')) return;
    const r = runSellOwnedOffice(state, idx);
    if (!r.ok) alert(r.error);
    saveToLocal(state);
    render();
    return;
  }
  if (action === 'margin-topup') {
    const id = ev.currentTarget.getAttribute('data-id');
    const r = resolveMargin(state, id, 'topup', Number($(`#pay-${id}`)?.value));
    if (!r.ok) alert(r.error || '失败');
    saveToLocal(state);
    render();
    return;
  }
  if (action === 'margin-kill') {
    const id = ev.currentTarget.getAttribute('data-id');
    const r = resolveMargin(state, id, 'liquidate');
    if (!r.ok) alert(r.error || '失败');
    saveToLocal(state);
    render();
    return;
  }
  if (action === 'save') {
    saveToLocal(state);
    alert('已保存');
    return;
  }
  if (action === 'export') {
    window.prompt('JSON', exportJson(state));
    return;
  }
  if (action === 'import') {
    const t = window.prompt('粘贴 JSON');
    if (!t) return;
    try {
      const o = importJson(t);
      if (o.schemaVersion !== SCHEMA_VERSION) throw new Error(`须为 schema ${SCHEMA_VERSION}`);
      state = o;
      saveToLocal(state);
      render();
    } catch (e) {
      alert(String(e));
    }
    return;
  }
  if (action === 'clear-save') {
    clearLocal();
    alert('已清除');
    return;
  }
}

async function bootstrap() {
  const origin = window.location.origin;
  const pathBase = window.location.pathname.replace(/\/investment-sim\/?.*$/, '') || '';
  const tryUrls = [
    './stocks-futures.json',
    `${origin}${pathBase}/data/investment-sim/stocks-futures.json`,
    '../data/investment-sim/stocks-futures.json',
  ];
  let raw = null;
  for (const u of tryUrls) {
    try {
      const res = await fetch(u);
      if (res.ok) {
        raw = await res.json();
        break;
      }
    } catch {
      /* next */
    }
  }
  if (!raw) {
    const dock = $('#month-dock');
    if (dock) dock.innerHTML = '';
    $('#app').innerHTML = '<p class="hint">无法加载 stocks-futures.json</p>';
    return;
  }

  config = {
    stocks: raw.stocks,
    futures: raw.futures,
    sectors: raw.sectors || [],
  };

  state = loadFromLocal();
  if (!state || state.schemaVersion !== SCHEMA_VERSION) {
    state = createInitialState(1);
    saveToLocal(state);
  }
  if (state.phase === 'opening' && !state.gameOver && !state.victory) {
    runMonthOpening(state);
    saveToLocal(state);
  }
  render();
}

bootstrap();
