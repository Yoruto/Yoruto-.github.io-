/**
 * 日终按当日成交量推导次日价格（纯函数，无副作用）。
 */

/**
 * @typedef {{
 *   openLong: number,
 *   openShort: number,
 *   longClose: number,
 *   shortClose: number,
 * }} DailyCommodityStats
 */

/**
 * @param {number} oldPrice
 * @param {DailyCommodityStats} stats
 * @param {{ minMoveRatio: number, limitMoveRatio: number, minPrice: number }} rules
 * @returns {{ newPrice: number, ratioRaw: number, ratioApplied: number, totalVolume: number }}
 */
export function computeNextPriceFromDailyStats(oldPrice, stats, rules) {
  const { openLong, openShort, longClose, shortClose } = stats;
  const totalVolume = openLong + openShort + longClose + shortClose;
  if (totalVolume === 0 || !Number.isFinite(oldPrice) || oldPrice <= 0) {
    const p = Number.isFinite(oldPrice) ? Math.max(rules.minPrice, Math.round(oldPrice * 100) / 100) : rules.minPrice;
    return { newPrice: p, ratioRaw: 0, ratioApplied: 0, totalVolume: 0 };
  }

  const netLong = openLong + Math.max(0, shortClose - longClose);
  const netShort = openShort + Math.max(0, longClose - shortClose);
  const ratioRaw = (netLong - netShort) / totalVolume;

  let ratioApplied = ratioRaw;
  if (Math.abs(ratioApplied) < rules.minMoveRatio) {
    ratioApplied = 0;
  } else {
    const cap = rules.limitMoveRatio;
    ratioApplied = Math.max(-cap, Math.min(cap, ratioApplied));
  }

  let newPrice = oldPrice * (1 + ratioApplied);
  newPrice = Math.max(rules.minPrice, newPrice);
  newPrice = Math.round(newPrice * 100) / 100;

  return { newPrice, ratioRaw, ratioApplied, totalVolume };
}

/**
 * 交割回合：按持仓多空总量推导交割价（与日终调价同一套比例与涨跌停规则）。
 * @param {number} oldPrice
 * @param {number} longQty
 * @param {number} shortQty
 * @param {{ minMoveRatio: number, limitMoveRatio: number, minPrice: number }} rules
 * @returns {{ newPrice: number, ratioRaw: number, ratioApplied: number, totalVolume: number }}
 */
export function computeDeliveryPriceFromOpenInterest(oldPrice, longQty, shortQty, rules) {
  const L = longQty || 0;
  const S = shortQty || 0;
  const totalVolume = L + S;
  if (totalVolume === 0 || !Number.isFinite(oldPrice) || oldPrice <= 0) {
    const p = Number.isFinite(oldPrice) ? Math.max(rules.minPrice, Math.round(oldPrice * 100) / 100) : rules.minPrice;
    return { newPrice: p, ratioRaw: 0, ratioApplied: 0, totalVolume: 0 };
  }

  const ratioRaw = (L - S) / totalVolume;

  let ratioApplied = ratioRaw;
  if (Math.abs(ratioApplied) < rules.minMoveRatio) {
    ratioApplied = 0;
  } else {
    const cap = rules.limitMoveRatio;
    ratioApplied = Math.max(-cap, Math.min(cap, ratioApplied));
  }

  let newPrice = oldPrice * (1 + ratioApplied);
  newPrice = Math.max(rules.minPrice, newPrice);
  newPrice = Math.round(newPrice * 100) / 100;

  return { newPrice, ratioRaw, ratioApplied, totalVolume };
}
