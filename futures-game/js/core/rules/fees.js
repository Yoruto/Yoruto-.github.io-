/**
 * 期货手续费：成交额 × 0.5%，上下限 1～500（可叠加永久修正）
 */

/**
 * @param {number} turnover 成交额（正）
 * @param {typeof import('../config.js').GAME_CONFIG} config
 * @param {number} [feeDeltaPermanent] 永久下调/上调累加（如 -0.001）
 */
export function futuresFeeAmount(turnover, config, feeDeltaPermanent = 0) {
  const r = config.rules.futuresFeeRate + (feeDeltaPermanent || 0);
  const raw = turnover * Math.max(0, r);
  return Math.min(
    config.rules.futuresFeeMax,
    Math.max(config.rules.futuresFeeMin, Math.round(raw * 100) / 100)
  );
}
