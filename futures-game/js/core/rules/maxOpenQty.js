/**
 * 人类市价开仓：在 reducer 规则下（含手续费、做空上限，不含 AI 风控）的最大可开手数。
 */
import { futuresFeeAmount } from "./fees.js";

/**
 * @param {ReturnType<import('../state.js').createInitialGameState>} state
 * @param {string} playerId
 * @param {string} commodityId
 * @param {'long'|'short'} direction
 * @param {typeof import('../config.js').GAME_CONFIG} config
 * @returns {number}
 */
export function maxOpenMarketQty(state, playerId, commodityId, direction, config) {
  const player = state.players[playerId];
  const comm = config.commodities.find((c) => c.id === commodityId && c.type === "crop");
  if (!player || !comm || player.status === "failed" || player.cash <= 0) return 0;

  const price = state.prices[commodityId];
  if (!Number.isFinite(price) || price <= 0) return 0;

  if (comm.requiresGemBoard && !player.gemBoardUnlocked) return 0;

  const mr = config.rules.marginRate;
  /** 粗略上界（忽略手续费），再逐手用 保证金+fee 收紧 */
  let upper = Math.floor(player.cash / (mr * price));
  if (upper < 1) return 0;

  if (direction === "short") {
    if (!comm.requiresGemBoard) {
      const spot = state.spotPool[commodityId] ?? 0;
      const cap = Math.floor(0.2 * spot);
      const cur = player.positions[commodityId].short.qty;
      upper = Math.min(upper, Math.max(0, cap - cur));
    } else if (player.gemBoardUnlocked) {
      let invVal = 0;
      for (const c of config.commodities.filter((x) => x.type === "crop")) {
        invVal += (player.backpack[c.id] ?? 0) * (state.spotPrices[c.id] ?? 0);
      }
      const cap = (player.cash + invVal) * config.rules.shortNotionalCapRatio;
      const curShort = player.positions[commodityId].short.qty * price;
      upper = Math.min(upper, Math.max(0, Math.floor((cap - curShort) / price)));
    } else {
      return 0;
    }
  }

  if (upper < 1) return 0;

  for (let q = upper; q >= 1; q--) {
    const marginAdd = mr * price * q;
    const fee = futuresFeeAmount(price * q, config, state.feePermanentDelta);
    if (player.cash >= marginAdd + fee) return q;
  }
  return 0;
}
