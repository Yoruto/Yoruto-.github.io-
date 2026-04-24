/**
 * 《投资公司发展物语 V2.0》— 并行面板 UI（参考 futures-game 布局）
 */
import {
  createInitialState,
  getTotalCapacity,
  canPromote,
  SCHEMA_VERSION,
  recruitCostForTier,
} from './core/state.js';
import {
  SENTIMENT_LABELS,
  SENTIMENT_ICONS,
  STOCK_GUIDE_LABELS,
  OFFICE_GRADES,
  B_STOCK_BP_BY_C,
  B_FUT_BP_BY_C,
  INDUSTRIES,
  PHASE_UNLOCKS,
} from './core/tables.js';
import { runRefreshTalentPool, runHireFromTalent, TALENT_REFRESH_COST_WAN } from './core/talentPool.js';
import {
  runMonthOpening,
  addActiveBusiness,
  closeActiveBusiness,
  setBusinessProfitPolicy,
  applyGuidance,
  endTurn,
  resolveMargin,
  dismissMonthReport,
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
let selectedNewBusinessKind = null; // 新开业务：临时选择的磁贴（tile-first UI）
/** 人事：null=磁贴选择；recruit | train | employees */
let selectedHrSubView = null;

// 内嵌的默认配置数据（当无法从服务器加载 JSON 时使用）
const EMBEDDED_CONFIG = {
  "schemaVersion": 1,
  "gameId": "investment-company-v2",
  "sectors": [
    { "id": "fin", "name": "金融", "nameEn": "Financial", "sectorBetaBp": 500 },
    { "id": "re", "name": "地产与基建", "nameEn": "Real Estate & Infra", "sectorBetaBp": 300 },
    { "id": "cons", "name": "消费", "nameEn": "Consumer", "sectorBetaBp": 100 },
    { "id": "tech", "name": "科技与通信", "nameEn": "Technology & Comms", "sectorBetaBp": 800 },
    { "id": "health", "name": "医疗与生命", "nameEn": "Healthcare", "sectorBetaBp": 200 },
    { "id": "ind", "name": "工业与制造", "nameEn": "Industrials", "sectorBetaBp": 400 },
    { "id": "ene", "name": "能源与材料", "nameEn": "Energy & Materials", "sectorBetaBp": 600 },
    { "id": "trans", "name": "交通运输", "nameEn": "Transportation", "sectorBetaBp": 250 },
    { "id": "util", "name": "公用与环保", "nameEn": "Utilities & Environment", "sectorBetaBp": -500 },
    { "id": "agri", "name": "农业与食品原料", "nameEn": "Agriculture", "sectorBetaBp": 50 }
  ],
  "stocks": [
    { "id": "STK0001", "name": "城信城市商业银行", "shortName": "城信", "sectorId": "fin", "listingYearMonth": "1992-05", "basePrice": 45.50, "matureYear": 1992, "matureBetaExtraBp": 200, "dividendRateAnnual": 0.035, "isFictional": true },
    { "id": "STK0002", "name": "华安联合证券", "shortName": "华安", "sectorId": "fin", "listingYearMonth": "1994-11", "basePrice": 128.00, "matureYear": 1999, "matureBetaExtraBp": 400, "dividendRateAnnual": 0.02, "isFictional": true },
    { "id": "STK0003", "name": "东岸置地发展", "shortName": "东岸", "sectorId": "re", "listingYearMonth": "1993-02", "basePrice": 85.20, "matureYear": 1993, "matureBetaExtraBp": 200, "dividendRateAnnual": 0.028, "isFictional": true },
    { "id": "STK0004", "name": "宏基路桥建设", "shortName": "宏基", "sectorId": "re", "listingYearMonth": "1995-08", "basePrice": 32.80, "matureYear": 2003, "matureBetaExtraBp": 100, "dividendRateAnnual": 0.022, "isFictional": true },
    { "id": "STK0005", "name": "金穗食品加工", "shortName": "金穗", "sectorId": "cons", "listingYearMonth": "1991-09", "basePrice": 156.50, "matureYear": 1991, "matureBetaExtraBp": 0, "dividendRateAnnual": 0.032, "isFictional": true },
    { "id": "STK0006", "name": "乐购连锁零售", "shortName": "乐购", "sectorId": "cons", "listingYearMonth": "1996-04", "basePrice": 78.30, "matureYear": 2001, "matureBetaExtraBp": -100, "dividendRateAnnual": 0.03, "isFictional": true },
    { "id": "STK0007", "name": "东方微电子", "shortName": "东微", "sectorId": "tech", "listingYearMonth": "1997-12", "basePrice": 268.80, "matureYear": 2007, "matureBetaExtraBp": 300, "dividendRateAnnual": 0.015, "isFictional": true },
    { "id": "STK0008", "name": "云联光通信", "shortName": "云联", "sectorId": "tech", "listingYearMonth": "2000-03", "basePrice": 198.00, "matureYear": 2003, "matureBetaExtraBp": 300, "dividendRateAnnual": 0.012, "isFictional": true },
    { "id": "STK0009", "name": "康宁联合制药", "shortName": "康宁", "sectorId": "health", "listingYearMonth": "1993-07", "basePrice": 112.50, "matureYear": 1993, "matureBetaExtraBp": 50, "dividendRateAnnual": 0.018, "isFictional": true },
    { "id": "STK0010", "name": "同和医疗集团", "shortName": "同和", "sectorId": "health", "listingYearMonth": "1998-06", "basePrice": 67.20, "matureYear": 2003, "matureBetaExtraBp": 0, "dividendRateAnnual": 0.02, "isFictional": true },
    { "id": "STK0011", "name": "重联重工机械", "shortName": "重联", "sectorId": "ind", "listingYearMonth": "1990-10", "basePrice": 45.80, "matureYear": 1990, "matureBetaExtraBp": 200, "dividendRateAnnual": 0.025, "isFictional": true },
    { "id": "STK0012", "name": "精密切削工具", "shortName": "精密切削", "sectorId": "ind", "listingYearMonth": "1994-01", "basePrice": 89.60, "matureYear": 2002, "matureBetaExtraBp": 100, "dividendRateAnnual": 0.022, "isFictional": true },
    { "id": "STK0013", "name": "长岭石化", "shortName": "长岭", "sectorId": "ene", "listingYearMonth": "1991-04", "basePrice": 145.00, "matureYear": 1991, "matureBetaExtraBp": 300, "dividendRateAnnual": 0.04, "isFictional": true },
    { "id": "STK0014", "name": "西北矿业", "shortName": "西矿", "sectorId": "ene", "listingYearMonth": "1996-09", "basePrice": 58.40, "matureYear": 2002, "matureBetaExtraBp": 200, "dividendRateAnnual": 0.035, "isFictional": true },
    { "id": "STK0015", "name": "远洋航运", "shortName": "远洋", "sectorId": "trans", "listingYearMonth": "1992-12", "basePrice": 34.50, "matureYear": 1992, "matureBetaExtraBp": 300, "dividendRateAnnual": 0.03, "isFictional": true },
    { "id": "STK0016", "name": "顺达综合物流", "shortName": "顺达", "sectorId": "trans", "listingYearMonth": "1999-11", "basePrice": 76.80, "matureYear": 2004, "matureBetaExtraBp": 0, "dividendRateAnnual": 0.028, "isFictional": true },
    { "id": "STK0017", "name": "绿源城市水务", "shortName": "绿源", "sectorId": "util", "listingYearMonth": "1993-05", "basePrice": 298.00, "matureYear": 1993, "matureBetaExtraBp": -300, "dividendRateAnnual": 0.045, "isFictional": true },
    { "id": "STK0018", "name": "净能环保", "shortName": "净能", "sectorId": "util", "listingYearMonth": "2002-08", "basePrice": 15.60, "matureYear": 2010, "matureBetaExtraBp": 100, "dividendRateAnnual": 0.02, "isFictional": true },
    { "id": "STK0019", "name": "丰禾种业", "shortName": "丰禾", "sectorId": "agri", "listingYearMonth": "1990-08", "basePrice": 52.30, "matureYear": 1990, "matureBetaExtraBp": 0, "dividendRateAnnual": 0.025, "isFictional": true },
    { "id": "STK0020", "name": "原香粮油", "shortName": "原香", "sectorId": "agri", "listingYearMonth": "1994-02", "basePrice": 38.90, "matureYear": 1999, "matureBetaExtraBp": 100, "dividendRateAnnual": 0.03, "isFictional": true }
  ],
  "futures": {
    "defaultVariantId": "composite",
    "leverageOptions": [1, 2, 3],
    "variants": {
      "composite": { "displayName": "大宗综合", "description": "一篮子可交割品种", "B_fut_bp_by_c": [600, 300, 0, -300, -600] },
      "energy": { "displayName": "能源", "description": "油、煤、气等", "B_fut_bp_by_c": [800, 400, 0, -400, -800] },
      "metal": { "displayName": "金属", "description": "工业金属", "B_fut_bp_by_c": [700, 350, 0, -350, -700] },
      "agri": { "displayName": "农产品", "description": "农产口粮/油料等", "B_fut_bp_by_c": [500, 250, 0, -250, -500] }
    }
  }
};

// 业务显示映射（用于 UI 文本）
const BUSINESS_DISPLAY = {
  stock: '📈 股票',
  fut: '📊 期货',
  consulting: '💼 咨询服务',
  fundraising: '🤝 拉投资',
  realestate: '🏠 房地产',
  startup_invest: '🚀 初创投资',
  ma_local: '🔗 并购',
  rnd: '🧪 研发',
  business_group: '🏢 业务组',
  overseas: '🌍 海外投资',
  ma_global: '🌐 跨国并购',
  ipo: '🏦 IPO',
};

// 阶段中文标签
const PHASE_LABELS = { startup: '初创期', expansion: '扩张期', mature: '成熟期' };

const TIER_LABELS = { junior: '初级', mid: '中级', senior: '高级' };

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

/** 万元显示：与 roundWan 一致，精确到 0.0001 万（1 元） */
function formatMoney(x) {
  if (x == null || !Number.isFinite(Number(x))) return '—';
  const v = Math.round(Number(x) * 10000) / 10000;
  return `${parseFloat(v.toFixed(4))} 万`;
}

/** 月度报告弹窗（已结束月份） */
function renderMonthReportModal(data) {
  const y = data.closedYear;
  const m = data.closedMonth;
  const majorHtml =
    data.majorStack && data.majorStack.length
      ? `<ul style="margin:0.5rem 0;padding-left:1.2rem;">${data.majorStack
          .map(
            (e) =>
              `<li><strong>${escapeHtml(e.title || e.id)}</strong>（剩余 ${e.monthsLeft != null ? e.monthsLeft : 0} 月）股市c=${e.equityC ?? '—'} 大宗c=${e.commodityC ?? '—'}</li>`,
          )
          .join('')}</ul>`
      : '<p class="hint" style="margin:0.5rem 0;">当前无持续中的大事件叠加（或已结束）。</p>';
  const hasDiv = (data.dividendTotalWan || 0) > 0;
  const divHint = hasDiv
    ? '<div style="font-size:0.75rem;color:#c9a227;margin-top:0.25rem;">年股息率按 12 个月均摊，每月按持仓计提一次（月分红）。</div>'
    : '';
  const rows =
    (data.rows || [])
      .map((r) => {
        const kind = r.kind === 'fut' ? '期货' : '股票';
        const ok = r.success ? '成功' : '未达正收益';
        const dWan = r.dividendWan != null ? r.dividendWan : 0;
        const divCell = r.kind === 'stock' ? formatMoney(dWan) : '—';
        return `<tr><td>${escapeHtml(r.employeeName)}</td><td>${kind}</td><td>${(r.P / 100).toFixed(2)}%</td><td>${formatMoney(
          r.profitWan
        )}</td><td>${divCell}</td><td>${ok}</td></tr>`;
      })
      .join('') || '<tr><td colspan="6" class="hint">无在营业务结算</td></tr>';

  // 公司盈亏汇总
  const incomeSection = `
    <div style="background:#2a3d22;border:1px solid #5e4b34;border-radius:0.75rem;padding:0.75rem;margin:0.75rem 0;">
      <h4 style="margin:0 0 0.5rem 0;color:#ffeaac;font-size:0.9rem;">公司盈亏汇总</h4>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;font-size:0.85rem;">
        <div><span style="color:#ac9e7e;">月初现金：</span>${formatMoney(data.companyCashStartWan || 0)}</div>
        <div><span style="color:#ac9e7e;">月末现金：</span>${formatMoney(data.companyCashEndWan || 0)}</div>
        <div><span style="color:#7fff7f;">收入项：</span></div>
        <div></div>
        <div style="padding-left:1rem;">· 交易利润 ${formatMoney(data.tradingProfitWan || 0)}</div>
        <div style="padding-left:1rem;">· 月分红收入 ${
          hasDiv ? formatMoney(data.dividendTotalWan || 0) : formatMoney(0)
        }${hasDiv ? '（年息÷12）' : ''}</div>
        ${divHint}
        <div style="padding-left:1rem;color:#ac9e7e;">收入合计 <strong style="color:#ffd966;">${formatMoney(data.incomeTotalWan || 0)}</strong>（含交易+月分红）</div>
        <div></div>
        <div><span style="color:#ff7f7f;">支出项：</span></div>
        <div></div>
        <div style="padding-left:1rem;">· 工资支出 ${formatMoney(data.payrollTotalWan || 0)}</div>
        <div style="padding-left:1rem;">· 写字楼支出 ${formatMoney(data.rentTotalWan || 0)}</div>
        <div style="padding-left:1rem;color:#ac9e7e;">支出合计 <strong style="color:#ff7f7f;">${formatMoney(data.expenseTotalWan || 0)}</strong></div>
        <div></div>
        <div style="padding-left:1rem;color:#ac9e7e;">净变动 <strong style="color:${(data.netChangeWan || 0) >= 0 ? '#7fff7f' : '#ff7f7f'};">${formatMoney(data.netChangeWan || 0)}</strong></div>
        <div></div>
      </div>
    </div>
  `;

  return `
    <div class="month-report-overlay" id="month-report-overlay" role="dialog" aria-modal="true">
      <div class="month-report-card">
        <h2 class="section-title" style="margin-top:0;">月度报告 · ${y}年${m}月</h2>
        <h3 class="section-title" style="font-size:0.95rem;">大事件（持续中，按 tick 前快照）</h3>
        ${majorHtml}
        <h3 class="section-title" style="font-size:0.95rem;">当月事件</h3>
        <p style="white-space:pre-wrap;">${escapeHtml(String(data.minorEvent || '—'))}</p>
        ${incomeSection}
        <h3 class="section-title" style="font-size:0.95rem;">业务与交易明细</h3>
        <p class="hint" style="margin:0.25rem 0 0.5rem 0;">月收益率为交易侧；股票业务另列月分红（成熟股权益、年股息按月计提）。</p>
        <table class="data-table">
          <thead><tr><th>员工</th><th>类型</th><th>月收益率</th><th>交易净利(万)</th><th>月分红(万)</th><th>结果</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <h3 class="section-title" style="font-size:0.95rem;margin-top:0.75rem;">长期/筹资进度</h3>
        ${Array.isArray(data.fundraisingRows) && data.fundraisingRows.length ? `
          <table class="data-table" style="margin-top:0.25rem;"><thead><tr><th>员工</th><th>进度</th><th>目标募集(万)</th></tr></thead>
          <tbody>
            ${data.fundraisingRows
              .map((r) => {
                const emp = state.employees.find((e) => e.id === r.employeeId) || {};
                return `<tr><td>${escapeHtml(emp.name || r.employeeName || '—')}</td><td>${r.elapsedMonths}/${r.totalMonths} 月</td><td>${formatMoney(r.expectedFundWan || 0)}</td></tr>`;
              })
              .join('')}
          </tbody></table>
        ` : '<p class="hint">本月无进行中的筹资项目。</p>'}
        <button type="button" class="primary" data-action="dismiss-month-report">关闭并继续经营</button>
      </div>
    </div>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderCompanyPhaseModal(modal) {
  const from = modal.from || '—';
  const to = modal.to || '—';
  const unlocked = modal.unlocked || {};
  const biz = (unlocked.businesses || [])
    .map((b) => `<li>${escapeHtml(BUSINESS_DISPLAY[b] || b)}</li>`)
    .join('') || '<li>无</li>';
  const tiers = (unlocked.employeeTiers || [])
    .map((t) => `<li>${escapeHtml(TIER_LABELS[t] || t)}</li>`)
    .join('') || '<li>无</li>';
  const offices = (unlocked.officeTypes || [])
    .map((o) => `<li>${escapeHtml(OFFICE_GRADES[o]?.name || o)}</li>`)
    .join('') || '<li>无</li>';
  const trigger = escapeHtml(modal.triggeredBy || '满足触发条件');
  const toLabel = PHASE_LABELS[to] || to;
  return `
    <div class="month-report-overlay" id="company-phase-overlay" role="dialog" aria-modal="true">
      <div class="month-report-card">
        <h2 class="section-title">🎉 公司进入 ${escapeHtml(toLabel)}！</h2>
        <p>恭喜，您的公司已满足触发条件：<strong>${trigger}</strong></p>
        <h3 class="section-title" style="font-size:0.95rem;">解锁内容</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.5rem;">
          <div><h4>新业务</h4><ul>${biz}</ul></div>
          <div><h4>新员工层级</h4><ul>${tiers}</ul></div>
          <div><h4>新写字楼类型</h4><ul>${offices}</ul></div>
        </div>
        <div style="margin-top:0.75rem;">
          <button type="button" class="primary" data-action="dismiss-company-phase">我知道了</button>
        </div>
      </div>
    </div>
  `;
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

function formatAbilities(e) {
  const l = e.leadership != null ? e.leadership : e.ability || 0;
  const i = e.innovation != null ? e.innovation : e.ability || 0;
  const x = e.execution != null ? e.execution : e.ability || 0;
  const avg = ((Number(l) + Number(i) + Number(x)) / 3).toFixed(1);
  return `${l}/${i}/${x} (${avg})`;
}

/** 行业熟练度：与 INDUSTRIES 顺序一致，图标+数值 */
function formatIndustryTech(emp) {
  const tech = emp?.industryTech || {};
  return Object.keys(INDUSTRIES)
    .map((key) => {
      const info = INDUSTRIES[key];
      const val = tech[key] != null ? tech[key] : 0;
      return `${info.icon || ''}${val}`;
    })
    .join(' · ');
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
  // 3. 个股自身影响因子（显示用成熟期值，实际结算用可复现随机）
  const isMature = state.year >= (stock.matureYear || 2100);
  const stockFactor = isMature ? (stock.matureBetaExtraBp || 0) : 0; // 成长期显示为0，实际用随机
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
      <p class="hint">本月宏观行情：股市 ${sentimentText(state.actualEquityC)} · 大环境因子 ${macroReturn}% · 成长股（高波动，不派息）vs 成熟期（低波动，派息）</p>
      <table class="data-table">
        <thead><tr><th>代码</th><th>简称</th><th>行业</th><th>阶段</th><th>成熟期</th><th>年股息</th><th>股价</th><th>本月涨跌</th><th>涨跌分解</th></tr></thead>
        <tbody>
          ${config.stocks
            .map((s) => {
              const sec = config.sectors?.find((x) => x.id === s.sectorId);
              const isMature = state.year >= (s.matureYear || 2100);
              const phaseLabel = isMature ? '成熟期' : '成长期';
              const phaseClass = isMature ? 'return-neutral' : 'return-bear';
              const price = calculateStockPrice(s, cMacro);
              const returnPct = calculateStockReturn(s, cMacro);
              const { macroFactor, sectorFactor, stockFactor } = getStockFactors(s, cMacro);
              const returnClass = Number(returnPct) > 0 ? 'up' : Number(returnPct) < 0 ? 'down' : 'neutral';
              const returnIcon = Number(returnPct) > 0 ? '▲' : Number(returnPct) < 0 ? '▼' : '—';
              const divLabel = isMature
                ? `${((Number(s.dividendRateAnnual) || 0) * 100).toFixed(1)}%`
                : '不派息';
              return `<tr>
                <td>${s.id}</td>
                <td>${s.shortName}</td>
                <td>${sec?.name || s.sectorId}</td>
                <td class="${phaseClass}" style="font-size:0.75rem;">${phaseLabel}</td>
                <td style="font-size:0.75rem;">${s.matureYear || '—'}年</td>
                <td style="font-size:0.75rem;">${divLabel}</td>
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
  const typeName = b.kind === 'stock' ? '股票' : b.kind === 'fut' ? '期货' : b.kind === 'consulting' ? '咨询' : '拉投资';

  const sleeveBp = b.stockSleeveBp != null && b.stockSleeveBp >= 0 ? b.stockSleeveBp : 10000;

  // 组合摘要（轻仓时「占AUM」为相对总本金的实际比例）
  let portfolioHtml = '—';
  if (b.kind === 'stock' && b.stockPortfolio?.length) {
    portfolioHtml = b.stockPortfolio
      .map((p) => {
        const st = config.stocks.find((s) => s.id === p.stockId);
        const name = st?.shortName || p.stockId;
        const pctAum = ((p.weightBp | 0) / 10000) * (sleeveBp / 10000) * 100;
        return `${name} 占AUM ${pctAum.toFixed(1)}%`;
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
          ${b.kind === 'consulting' ? `<p>行业：${INDUSTRIES?.[b.industry]?.icon || ''} ${INDUSTRIES?.[b.industry]?.name || b.industry}</p>` : ''}
          ${b.kind === 'fundraising' ? `<p>进度：${b.elapsedMonths || 0}/${b.totalMonths || 0} 月 · 目标募集 ${formatMoney(b.expectedFundWan || 0)}</p>` : ''}
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

  // Tile-first: 若未选中业务种类，展示磁贴选择
  if (!selectedNewBusinessKind) {
    // 根据当前公司阶段动态渲染可选业务磁贴
    const unlockedKinds = (PHASE_UNLOCKS[state.companyPhase?.current || 'startup']?.businesses) || ['stock', 'fut', 'consulting', 'fundraising'];
    const tilesHtml = unlockedKinds
      .map((k) => `<button type="button" class="biz-tile ${k==='stock'||k==='fut' ? 'primary' : ''}" data-action="select-newbiz" data-kind="${k}">${BUSINESS_DISPLAY[k] || k}</button>`)
      .join('');
    return `
      <div class="view-section">
        <h2 class="section-title">新开业务</h2>
        <p class="hint">先选择业务类型，然后填写指派信息。</p>
        <div class="panel" style="display:flex;flex-direction:column;gap:0.75rem;">
          <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">${tilesHtml}</div>
          <div class="hint">选择后可在表单中指派员工与填写参数，或点击返回重新选择。</div>
        </div>
      </div>`;
  }

  // 已选中某种业务，显示指派表单（类型预选）
  const selKind = selectedNewBusinessKind;
  // 可用业务选项（表单下拉）
  const unlockedFormKinds = (PHASE_UNLOCKS[state.companyPhase?.current || 'startup']?.businesses) || ['stock','fut','consulting','fundraising'];
  const selectOptionsHtml = unlockedFormKinds.map((k) => `<option value="${k}" ${selKind===k ? 'selected' : ''}>${BUSINESS_DISPLAY[k] || k}</option>`).join('');
  return `
    <div class="view-section">
      <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.5rem;">
        <button type="button" class="small" data-action="clear-newbiz">← 选择其他业务</button>
        <h2 class="section-title">新开：${selKind === 'stock' ? '股票' : selKind === 'fut' ? '期货' : selKind === 'consulting' ? '咨询' : '拉投资'}</h2>
      </div>
      <div class="panel">
        <div class="flex-row" style="gap:0.75rem; flex-wrap:wrap;">
          <label>员工<select id="dep-emp">${idle.map((e) => {
            return `<option value="${e.id}">${e.name} ${formatAbilities(e)}</option>`;
          }).join('')}</select></label>
          <label>类型<select id="dep-kind">${selectOptionsHtml}</select></label>
          <label id="dep-alloc-wrap">本金(万)<input type="number" id="dep-alloc" class="narrow" value="20" min="1" /></label>
          <label id="dep-policy-wrap">利润分配<select id="dep-policy"><option value="reinvest">滚存复利</option><option value="remit">上交公司</option></select></label>
        </div>
        <div id="dep-fut-wrap" class="hidden" style="margin-top:0.5rem;">
          <label>品种 <select id="dep-futvar">${variants.map((v) => `<option value="${v}">${config.futures.variants[v].displayName}</option>`).join('')}</select></label>
          <label>杠杆 <select id="dep-lev"><option value="1">1x</option><option value="2">2x</option><option value="3">3x</option></select></label>
        </div>
        <div id="dep-consult-wrap" class="hidden" style="margin-top:0.5rem;">
          <label>行业 <select id="dep-industry">${Object.keys(INDUSTRIES).map((k) => `<option value="${k}">${INDUSTRIES[k].icon || ''} ${INDUSTRIES[k].name}</option>`).join('')}</select></label>
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

// 6. 人事视图（磁贴优先，与「新开业务」一致）
function renderHrView() {
  const tierLabels = { junior: '初级', mid: '中级', senior: '高级' };
  const prom = state.employees.filter((e) => canPromote(e));
  const trainCandidates = state.employees.filter((e) => {
    if (state.trainedThisMonth) return false;
    if (e.ability >= 10) return false;
    return !hasActiveBusiness(state, e.id);
  });

  if (!selectedHrSubView) {
    return `
      <div class="view-section">
        <h2 class="section-title">人事</h2>
        <p class="hint">选择人事模块。写字楼租赁与购买请在「公司情况」中操作。</p>
        <div class="panel" style="display:flex;flex-direction:column;gap:0.75rem;">
          <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
            <button type="button" class="biz-tile primary" data-action="select-hr-subview" data-subview="recruit">招聘与人才库</button>
            <button type="button" class="biz-tile primary" data-action="select-hr-subview" data-subview="train">培训与晋升</button>
            <button type="button" class="biz-tile" data-action="select-hr-subview" data-subview="employees">员工信息</button>
          </div>
          <div class="hint">进入子页面后可返回重新选择模块。</div>
        </div>
      </div>`;
  }

  const subTitle =
    selectedHrSubView === 'recruit'
      ? '招聘与人才库'
      : selectedHrSubView === 'train'
        ? '培训与晋升'
        : selectedHrSubView === 'employees'
          ? '员工信息'
          : '人事';

  if (selectedHrSubView === 'recruit') {
    return `
      <div class="view-section">
        <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.5rem;">
          <button type="button" class="small" data-action="clear-hr-subview">← 返回人事首页</button>
          <h2 class="section-title" style="margin:0;">${subTitle}</h2>
        </div>
        <div class="panel">
          <h3 class="section-title">人才库（0.2）</h3>
          <p class="hint">支付 <strong>${TALENT_REFRESH_COST_WAN} 万</strong> 刷新 3～5 名候选人；招聘费按其职级（初/中/高 5/8/15 万）。每人带 AI 交易风格。</p>
          <div class="flex-row" style="margin-bottom:0.75rem; gap:0.75rem; flex-wrap:wrap; align-items:flex-end;">
            <button type="button" data-action="refresh-talent-pool">刷新人才（-${TALENT_REFRESH_COST_WAN}万）</button>
          </div>
          <div class="talent-card-grid">
            ${(state.talentPool || [])
              .map(
                (t) => `
              <div class="talent-card">
                <div class="talent-card-name">${escapeHtml(t.name)}</div>
                <div class="talent-card-meta">${tierLabels[t.tier] || t.tier}</div>
                <div class="talent-card-meta">能力 ${t.ability} · 忠诚 ${t.loyalty}</div>
                <div class="talent-card-meta">招聘 ${recruitCostForTier(t.tier)} 万</div>
                <button type="button" class="primary small" data-action="hire-talent" data-tid="${escapeHtml(t.id)}">招聘此人</button>
              </div>`,
              )
              .join('') || '<p class="hint">当前人才库为空，请先刷新。</p>'}
          </div>
        </div>
      </div>`;
  }

  if (selectedHrSubView === 'train') {
    return `
      <div class="view-section">
        <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.5rem;">
          <button type="button" class="small" data-action="clear-hr-subview">← 返回人事首页</button>
          <h2 class="section-title" style="margin:0;">${subTitle}</h2>
        </div>
        <div class="panel">
          <h3 class="section-title">培训（1人次/月）</h3>
          <div class="flex-row" style="gap:1rem;align-items:center;flex-wrap:wrap;">
            <select id="hr-train">${state.employees
              .map((e) => {
                const ok = trainCandidates.some((x) => x.id === e.id);
                return `<option value="${e.id}" ${ok ? '' : 'disabled'}>${e.name} ${formatAbilities(e)}</option>`;
              })
              .join('')}</select>
            <select id="hr-train-type"><option value="general">提升通用能力（+1）</option><option value="industry">提升行业技术（+5）</option></select>
            <select id="hr-train-dim">
              <option value="leadership">领导力</option>
              <option value="innovation">创新力</option>
              <option value="execution">执行力</option>
            </select>
            <select id="hr-train-industry" class="hidden">
              ${Object.keys(INDUSTRIES).map((k) => `<option value="${k}">${INDUSTRIES[k].icon} ${INDUSTRIES[k].name}</option>`).join('')}
            </select>
            <button type="button" data-action="train">培训</button>
          </div>
        </div>
        <div class="panel">
          <h3 class="section-title">晋升</h3>
          <div class="flex-row" style="gap:1rem;flex-wrap:wrap;">
            <select id="hr-prom">${state.employees
              .map((e) => {
                const ok = prom.some((x) => x.id === e.id);
                return `<option value="${e.id}" ${ok ? '' : 'disabled'}>${e.name}</option>`;
              })
              .join('')}</select>
            <button type="button" data-action="promote">晋升</button>
          </div>
        </div>
      </div>`;
  }

  if (selectedHrSubView === 'employees') {
    return `
      <div class="view-section">
        <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.5rem;">
          <button type="button" class="small" data-action="clear-hr-subview">← 返回人事首页</button>
          <h2 class="section-title" style="margin:0;">${subTitle}</h2>
        </div>
        <div class="panel">
          <h3 class="section-title">员工管理</h3>
          <table class="data-table">
            <thead><tr><th>姓名</th><th>等级</th><th>能力</th><th>行业熟练度</th><th>忠诚</th><th>工龄</th><th>操作</th></tr></thead>
            <tbody>
              ${state.employees.map((e) => {
                const tl = { junior: '初级', mid: '中级', senior: '高级' };
                const hasBiz = hasActiveBusiness(state, e.id);
                return `<tr>
                  <td>
                    <input type="text" class="small" value="${escapeHtml(e.name)}" data-action="rename-emp" data-eid="${e.id}" style="width:80px;padding:2px 4px;font-size:0.75rem;" />
                  </td>
                  <td>${tl[e.tier] || e.tier}</td>
                  <td>${formatAbilities(e)}</td>
                  <td style="font-size:0.68rem;line-height:1.35;color:#e9c891;max-width:14rem;">${escapeHtml(formatIndustryTech(e))}</td>
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
          <p class="hint">编辑姓名后失焦或按回车保存。行业熟练度顺序与培训中的行业一致。</p>
        </div>
      </div>`;
  }

  selectedHrSubView = null;
  return renderHrView();
}

// 7. 公司情况视图
function renderCompanyView() {
  const cap = getTotalCapacity(state);
  const officeOpts = ['standard', 'business', 'hq'].filter((gid) => state.year >= OFFICE_GRADES[gid].unlockYear);
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
          <thead><tr><th>姓名</th><th>等级</th><th>能力</th><th>行业熟练度</th><th>忠诚</th><th>工龄(月)</th></tr></thead>
          <tbody>
            ${state.employees.map((e) => {
              const tierLabels = { junior: '初级', mid: '中级', senior: '高级' };
              return `<tr><td>${escapeHtml(e.name)}</td><td>${tierLabels[e.tier] || e.tier}</td><td>${formatAbilities(e)}</td><td style="font-size:0.68rem;line-height:1.35;color:#e9c891;">${escapeHtml(formatIndustryTech(e))}</td><td>${e.loyalty}</td><td>${e.experienceMonths}</td></tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>

      <div class="panel">
        <h3 class="section-title">写字楼</h3>
        <p class="hint">租赁、购买、退租与出售均在此办理（原在「人事」中的写字楼逻辑已移至此处）。</p>
        <table class="data-table">
          <thead><tr><th>#</th><th>写字楼</th><th>类型</th><th>容量</th><th>费用</th><th>操作</th></tr></thead>
          <tbody>${leaseRows}</tbody>
        </table>
        <div class="flex-row" style="margin-top:0.5rem;flex-wrap:wrap;gap:0.5rem;">
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
    const kindLabel = { stock: '股票', fut: '期货', consulting: '咨询', fundraising: '拉投资' }[b.kind] || b.kind;
    return `
      <div class="biz-thumb ${isActive ? 'active' : ''}" data-action="view-business-detail" data-bid="${b.id}">
        <div class="biz-name">${emp?.name || '未知'} · ${kindLabel}</div>
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
  const canNext =
    state.phase !== 'margin' &&
    !state.pendingMargin.length &&
    !state.gameOver &&
    !state.victory &&
    !state.showMonthReport;

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
  const reportModal = state.showMonthReport && state.monthReportData ? renderMonthReportModal(state.monthReportData) : '';
  const companyPhaseModal = state.pendingCompanyPhaseModal ? renderCompanyPhaseModal(state.pendingCompanyPhaseModal) : '';
  root.innerHTML = marginBlock + renderer() + reportModal + companyPhaseModal;

  // 绑定事件
  bindActions(root);

  // 特定视图的后处理
  if (currentView === 'new-business') {
    wireKindToggle(root);
  } else if (currentView === 'hr' && selectedHrSubView === 'train') {
    wireTrainToggle(root);
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
    $('#dep-consult-wrap', root)?.classList.toggle('hidden', k !== 'consulting');
    // 咨询与拉投资无需本金输入
    $('#dep-alloc-wrap', root)?.classList.toggle('hidden', k === 'consulting' || k === 'fundraising');
    // 利润分配仅在 股票/期货 显示
    $('#dep-policy-wrap', root)?.classList.toggle('hidden', k !== 'stock' && k !== 'fut');
  };
  kind.addEventListener('change', sync);
  sync();
}

function wireTrainToggle(root) {
  const typeSel = $('#hr-train-type', root);
  const dim = $('#hr-train-dim', root);
  const ind = $('#hr-train-industry', root);
  if (!typeSel) return;
  const sync = () => {
    const t = typeSel.value;
    if (t === 'general') {
      dim?.classList.remove('hidden');
      ind?.classList.add('hidden');
    } else {
      dim?.classList.add('hidden');
      ind?.classList.remove('hidden');
    }
  };
  typeSel.addEventListener('change', sync);
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
        if (currentView === 'hr' && view !== 'hr') selectedHrSubView = null;
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
        if (currentView === 'hr') selectedHrSubView = null;
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
    selectedNewBusinessKind = null;
    selectedHrSubView = null;
    runMonthOpening(state);
    saveToLocal(state);
    render();
    return;
  }

  // 视图切换操作
  if (action === 'switch-view') {
    const view = ev.currentTarget.dataset.view;
    if (view && view !== currentView) {
      if (currentView === 'hr' && view !== 'hr') selectedHrSubView = null;
      currentView = view;
      selectedBusinessId = null;
      render();
    }
    return;
  }

  if (action === 'select-hr-subview') {
    selectedHrSubView = ev.currentTarget.dataset.subview || null;
    render();
    return;
  }
  if (action === 'clear-hr-subview') {
    selectedHrSubView = null;
    render();
    return;
  }

  // 查看业务详情（从业务卡片或缩略图）
  if (action === 'view-business-detail') {
    const bid = ev.currentTarget.dataset.bid;
    if (bid) {
      if (currentView === 'hr') selectedHrSubView = null;
      selectedBusinessId = bid;
      currentView = 'business-detail';
      render();
    }
    return;
  }

  // Tile-first: 选择新开业务磁贴
  if (action === 'select-newbiz') {
    selectedNewBusinessKind = ev.currentTarget.dataset.kind || null;
    render();
    return;
  }

  if (action === 'clear-newbiz') {
    selectedNewBusinessKind = null;
    render();
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
    if (kind === 'consulting') {
      draft.industry = $('#dep-industry')?.value || Object.keys(INDUSTRIES)[0];
      // consulting 不使用 alloc
      delete draft.allocWan;
    }
    if (kind === 'fundraising') {
      // fundraising 无需 alloc，后端根据员工领导力设置周期与目标
      delete draft.allocWan;
    }
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
  if (action === 'dismiss-month-report') {
    dismissMonthReport(state);
    saveToLocal(state);
    render();
    return;
  }
  if (action === 'dismiss-company-phase') {
    // 关闭强制阶段晋升弹窗
    state.pendingCompanyPhaseModal = null;
    saveToLocal(state);
    render();
    return;
  }
  if (action === 'refresh-talent-pool') {
    const r = runRefreshTalentPool(state);
    if (!r.ok) alert(r.error);
    else saveToLocal(state);
    render();
    return;
  }
  if (action === 'hire-talent') {
    const tid = ev.currentTarget.getAttribute('data-tid');
    const r = runHireFromTalent(state, tid);
    if (!r.ok) alert(r.error);
    else saveToLocal(state);
    render();
    return;
  }
  if (action === 'train') {
    const empId = $('#hr-train')?.value;
    const type = $('#hr-train-type')?.value || 'general';
    const dim = $('#hr-train-dim')?.value;
    const ind = $('#hr-train-industry')?.value;
    const target = type === 'general' ? dim : ind;
    const r = runTrain(state, empId, type, target);
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
  // 添加时间戳参数防止缓存
  const cacheBuster = `?t=${Date.now()}`;
  // 优先从仓库 data/ 加载（单一事实来源）；同目录 stocks-futures.json 仅作可选回退
  const tryUrls = [
    `${origin}${pathBase}/data/investment-sim/stocks-futures.json${cacheBuster}`,
    `../data/investment-sim/stocks-futures.json${cacheBuster}`,
    `./stocks-futures.json${cacheBuster}`,
  ];

  let raw = null;
  let lastError = null;
  for (const u of tryUrls) {
    try {
      const res = await fetch(u, { cache: 'no-store' });
      if (res.ok) {
        raw = await res.json();
        break;
      }
    } catch (e) {
      lastError = e;
    }
  }

  // 如果 fetch 失败，使用内嵌配置作为备用
  if (!raw) {
    console.warn('[投资公司] 无法从服务器加载 stocks-futures.json，使用内嵌默认配置');
    raw = EMBEDDED_CONFIG;
  }

  const s0 = raw.stocks?.[0];
  if (s0 && !('matureYear' in s0)) {
    console.warn(
      '[投资公司] stocks-futures 缺少 matureYear 等字段，成长/成熟与股息会错误。请使用 data/investment-sim/stocks-futures.json 完整表。'
    );
  }

  config = {
    stocks: raw.stocks,
    futures: raw.futures,
    sectors: raw.sectors || [],
  };

  // [调试模式] 每次新开网页都是新游戏，屏蔽存档功能
  // 如需恢复存档，取消下面注释并注释掉 state = createInitialState(1);
  // state = loadFromLocal();
  // if (!state || state.schemaVersion !== SCHEMA_VERSION) {
  //   state = createInitialState(1);
  //   saveToLocal(state);
  // }
  state = createInitialState(1);
  // saveToLocal(state); // 屏蔽自动保存

  if (state.phase === 'opening' && !state.gameOver && !state.victory) {
    runMonthOpening(state);
    // saveToLocal(state); // 屏蔽自动保存
  }
  render();
}

bootstrap();
