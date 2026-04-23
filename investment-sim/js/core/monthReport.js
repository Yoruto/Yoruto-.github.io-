import { roundWan } from './state.js';

/**
 * 月结后展示用的月度报告数据（不依赖可复现 RNG，只读 state）。
 * @param {object} params
 * @param {number} params.closedYear
 * @param {number} params.closedMonth
 * @param {object[]|null} params.majorStackSnapshot
 * @param {string} params.minorEventNote
 * @param {object[]} params.settlementResults
 * @param {number} params.dividendTotalWan
 * @param {{ businessId: string, employeeName: string, amountWan: number }[]} [params.dividendBreakdown] 分业务月分红
 * @param {number} params.payrollTotalWan 工资支出
 * @param {number} params.rentTotalWan 租金/物业税支出
 * @param {number} params.companyCashStartWan 月初现金
 * @param {number} params.companyCashEndWan 月末现金
 */
export function buildMonthReportData({
  closedYear,
  closedMonth,
  majorStackSnapshot,
  minorEventNote,
  settlementResults,
  dividendTotalWan,
  dividendBreakdown,
  payrollTotalWan,
  rentTotalWan,
  companyCashStartWan,
  companyCashEndWan,
}) {
  let tradingProfit = 0;
  if (settlementResults && settlementResults.length) {
    tradingProfit = settlementResults.reduce((s, r) => s + (r.profitWan || 0), 0);
  }
  
  // 计算各项收支
  const income = tradingProfit + (dividendTotalWan || 0);
  const expense = (payrollTotalWan || 0) + (rentTotalWan || 0);
  const netChange = income - expense;

  const divMap = new Map();
  for (const d of dividendBreakdown || []) {
    if (d && d.businessId) divMap.set(d.businessId, roundWan(d.amountWan || 0));
  }
  
  return {
    closedYear,
    closedMonth,
    majorStack:
      (majorStackSnapshot || []).map((e) => ({
        id: e.id,
        title: e.title,
        monthsLeft: e.monthsLeft,
        equityC: e.equityC,
        commodityC: e.commodityC,
      })) || [],
    minorEvent: minorEventNote || '（无）',
    rows:
      (settlementResults || []).map((r) => ({
        businessId: r.businessId,
        employeeName: r.employeeName,
        kind: r.kind,
        profitWan: r.profitWan,
        dividendWan: r.kind === 'stock' ? roundWan(divMap.get(r.businessId) || 0) : 0,
        success: r.success,
        P: r.P,
      })) || [],
    dividendBreakdown: (dividendBreakdown || []).map((d) => ({
      businessId: d.businessId,
      employeeName: d.employeeName,
      amountWan: roundWan(d.amountWan || 0),
    })),
    dividendTotalWan: roundWan(dividendTotalWan || 0),
    tradingProfitWan: roundWan(tradingProfit),
    payrollTotalWan: roundWan(payrollTotalWan || 0),
    rentTotalWan: roundWan(rentTotalWan || 0),
    incomeTotalWan: roundWan(income),
    expenseTotalWan: roundWan(expense),
    netChangeWan: roundWan(netChange),
    companyCashStartWan: roundWan(companyCashStartWan || 0),
    companyCashEndWan: roundWan(companyCashEndWan || 0),
    monthTotalWan: roundWan(tradingProfit + (dividendTotalWan || 0)),
  };
}
