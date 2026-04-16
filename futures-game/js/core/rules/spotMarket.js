/**
 * 现货池与商店价格（游戏设计.md：现货与期货独立）
 */

/**
 * @param {number} spotPrice
 * @param {typeof import('../config.js').GAME_CONFIG} config
 */
export function shopBuyPrice(spotPrice, config) {
  return Math.max(config.rules.minPrice, Math.round(spotPrice * config.economy.shopBuyRatio * 100) / 100);
}

/**
 * @param {number} spotPrice
 * @param {typeof import('../config.js').GAME_CONFIG} config
 */
export function shopSellPrice(spotPrice, config) {
  return Math.max(config.rules.minPrice, Math.round(spotPrice * config.economy.shopSellRatio * 100) / 100);
}

/**
 * 池子从 oldPool 变为 newPool 后更新现货价。
 * 因子 = -(Δ/原池)×k，新价 = 旧价×(1+因子)
 * @param {import('../state.js').ReturnType<import('../state.js').createInitialGameState>} state
 * @param {string} cropId
 * @param {number} oldPool
 * @param {number} newPool
 * @param {typeof import('../config.js').GAME_CONFIG} config
 */
export function applySpotPriceFromPoolChange(state, cropId, oldPool, newPool, config) {
  const k = config.economy.spotPoolPriceFactor;
  const oldSp = state.spotPrices[cropId];
  if (!Number.isFinite(oldSp) || oldSp <= 0) return;
  if (oldPool <= 0) {
    return;
  }
  const delta = newPool - oldPool;
  const factor = -(delta / oldPool) * k;
  state.spotPrices[cropId] = Math.max(
    config.rules.minPrice,
    Math.round(oldSp * (1 + factor) * 100) / 100
  );
}

/**
 * 商人现货单日购买上限
 * @param {number} poolSize
 * @param {typeof import('../config.js').GAME_CONFIG} config
 */
export function merchantDailyBuyCap(poolSize, config) {
  return Math.max(0, Math.floor(poolSize * config.economy.merchantSpotBuyRatio));
}
