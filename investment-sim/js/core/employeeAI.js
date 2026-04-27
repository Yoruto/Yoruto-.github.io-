/**
 * 员工 AI 选股：可复现；排名用"中性"能力(5) + 仅用于排序的 per-stock 确定性噪声。
 */
import { mixUint32, rollMacroC, ymToMonthIndex } from './rng.js';
import { B_STOCK_BP_BY_C, A_BP_BY_ABILITY, NOISE_BP } from './tables.js';

export const AI_STYLES = {
  momentum: { id: 'momentum', name: '追涨杀跌' },
  trend: { id: 'trend', name: '趋势' },
  dividend: { id: 'dividend', name: '高股息保守' },
};

const ABILITY_NEUTRAL = 5;

function stockIdTag(stockId) {
  let h = 0;
  for (let i = 0; i < stockId.length; i++) {
    h = (h * 33 + stockId.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

/**
 * 用于 AI 排序的月收益率（万分比）。
 */
export function computeAiRankReturnBp(gameSeed, monthIndex, cMacro, stock, sectors) {
  const c = Math.max(0, Math.min(4, cMacro | 0));
  const macroBp = B_STOCK_BP_BY_C[c];
  const sec = sectors?.find((s) => s.id === stock.sectorId);
  const sectorBp = sec?.sectorBetaBp ?? 0;
  const stockBp = stock?.betaExtraBp ?? 0;
  const aBp = A_BP_BY_ABILITY[ABILITY_NEUTRAL - 1];
  const h = mixUint32(gameSeed >>> 0, [monthIndex, stockIdTag(stock.id), 0x41495354]);
  const noiseBp = NOISE_BP[h % 256];
  return (macroBp + sectorBp + stockBp + aBp + noiseBp) | 0;
}

export function listingOk(listingYm, year, month) {
  if (!listingYm) return true;
  const [yy, mm] = listingYm.split('-').map(Number);
  if (year !== yy) return year > yy;
  return month >= mm;
}

export function listedStocksForMonth(stocks, year, month) {
  return (stocks || []).filter((s) => listingOk(s.listingYearMonth, year, month));
}

function compound3MonthReturnFromBp(r0, r1, r2) {
  const a = 1 + r0 / 10000;
  const b = 1 + r1 / 10000;
  const c = 1 + r2 / 10000;
  return (a * b * c - 1) * 10000;
}

function std3(a, b, c) {
  const m = (a + b + c) / 3;
  const v = ((a - m) ** 2 + (b - m) ** 2 + (c - m) ** 2) / 3;
  return Math.sqrt(v);
}

/** 从 base=1 连乘到 monthIndex 月末的相对价格 */
export function endPriceAtMonth(gameSeed, monthIndex, stock, sectors) {
  let px = 1;
  for (let t = 0; t <= monthIndex; t++) {
    const cM = rollMacroC(gameSeed, t, 'equity');
    const rBp = computeAiRankReturnBp(gameSeed, t, cM, stock, sectors);
    px *= 1 + rBp / 10000;
  }
  return px;
}

function pickCount(gameSeed, monthIndex, salt) {
  return 2 + (mixUint32(gameSeed >>> 0, [monthIndex, salt, 0x4b]) % 3);
}

function sortStocksByIds(stockIds, list) {
  return [...stockIds].sort((a, b) => a.localeCompare(b));
}

/**
 * 生成 2~4 支、权重合计 10000
 * @param {'momentum'|'trend'|'dividend'} styleId
 */
export function buildAiStockPortfolio(gameSeed, year, month, styleId, stocks, sectors) {
  const monthIndex = ymToMonthIndex(year, month);
  const list = listedStocksForMonth(stocks, year, month);
  if (!list.length) return [];

  const salt = styleId === 'momentum' ? 1 : styleId === 'trend' ? 2 : 3;
  const kWant = pickCount(gameSeed, monthIndex, salt);
  const k = Math.min(kWant, list.length);

  if (styleId === 'momentum') {
    const c0 = rollMacroC(gameSeed, monthIndex, 'equity');
    const c1 = monthIndex >= 1 ? rollMacroC(gameSeed, monthIndex - 1, 'equity') : c0;
    const c2 = monthIndex >= 2 ? rollMacroC(gameSeed, monthIndex - 2, 'equity') : c1;
    const scores = list.map((st) => {
      const r0 = computeAiRankReturnBp(gameSeed, monthIndex, c0, st, sectors);
      const r1 = computeAiRankReturnBp(gameSeed, Math.max(0, monthIndex - 1), c1, st, sectors);
      const r2 = computeAiRankReturnBp(gameSeed, Math.max(0, monthIndex - 2), c2, st, sectors);
      const comp = compound3MonthReturnFromBp(r0, r1, r2);
      return { st, comp };
    });
    scores.sort((a, b) => b.comp - a.comp);
    const top = sortStocksByIds(
      scores.slice(0, k).map((x) => x.st.id),
      list,
    ).map((id) => list.find((s) => s.id === id));
    return equalWeights(top.filter(Boolean), k);
  }

  if (styleId === 'trend') {
    if (monthIndex < 1) {
      const ids = sortStocksByIds(
        list.map((s) => s.id),
        list,
      );
      const picked = ids.slice(0, k).map((id) => list.find((s) => s.id === id));
      return equalWeights(picked, k);
    }
    const terms = Math.min(6, monthIndex);
    const trendScores = list.map((st) => {
      const pCur = endPriceAtMonth(gameSeed, monthIndex, st, sectors);
      let acc = 0;
      for (let d = 1; d <= terms; d++) {
        const mi = monthIndex - d;
        acc += endPriceAtMonth(gameSeed, mi, st, sectors);
      }
      const ma = acc / terms;
      const sc = pCur - ma;
      return { st, ok: pCur > ma, sc };
    });
    const okOnes = trendScores.filter((x) => x.ok);
    const pool = okOnes.length ? okOnes.sort((a, b) => b.sc - a.sc) : trendScores.sort((a, b) => b.sc - a.sc);
    const picked2 = sortStocksByIds(
      pool.slice(0, k).map((x) => x.st.id),
      list,
    ).map((id) => list.find((s) => s.id === id));
    return equalWeights(picked2.filter(Boolean), k);
  }

  // 高股息保守：年股息率 >= 0.02 且派息；按近 3 月 P 的波动 std 升序
  const cands = list.filter((st) => st.paysDividend !== false && (Number(st.dividendRateAnnual) || 0) >= 0.02);
  const work = cands.length ? cands : list;
  const c0 = rollMacroC(gameSeed, monthIndex, 'equity');
  const c1 = monthIndex >= 1 ? rollMacroC(gameSeed, monthIndex - 1, 'equity') : c0;
  const c2 = monthIndex >= 2 ? rollMacroC(gameSeed, monthIndex - 2, 'equity') : c1;
  const scored = work.map((st) => {
    const r0 = computeAiRankReturnBp(gameSeed, monthIndex, c0, st, sectors);
    const r1 = computeAiRankReturnBp(gameSeed, Math.max(0, monthIndex - 1), c1, st, sectors);
    const r2 = computeAiRankReturnBp(gameSeed, Math.max(0, monthIndex - 2), c2, st, sectors);
    const v = std3(r0, r1, r2);
    return { st, v };
  });
  scored.sort((a, b) => a.v - b.v);
  const picked3 = sortStocksByIds(
    scored.slice(0, k).map((x) => x.st.id),
    list,
  ).map((id) => work.find((s) => s.id === id) || list.find((s) => s.id === id));
  return equalWeights(picked3.filter(Boolean), k);
}

function equalWeights(stocks, k) {
  const n = Math.min(stocks.length, k) || 0;
  if (!n) return [];
  const each = Math.floor(10000 / n);
  const rows = [];
  let rem = 10000;
  for (let i = 0; i < n - 1; i++) {
    rows.push({ stockId: stocks[i].id, weightBp: each });
    rem -= each;
  }
  rows.push({ stockId: stocks[n - 1].id, weightBp: rem });
  return rows;
}

export const REBALANCE_INTERVAL_MONTHS = 3;
