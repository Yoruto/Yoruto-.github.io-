import { futuresTradableCommodities } from "../core/config.js";
import { futuresFeeAmount } from "../core/rules/fees.js";
import { buildSoloAiPlayerIds, totalMarginLockedForPlayer } from "../core/state.js";

/**
 * @param {unknown[]} array
 * @param {() => number} rng
 */
function shuffle(array, rng) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/**
 * @param {ReturnType<import('./state.js').createInitialGameState>} state
 * @param {string} playerId
 * @param {string} commodityId
 * @param {'long'|'short'} direction
 * @param {number} qty
 * @param {import('./config.js').GAME_CONFIG} config
 */
function wouldPassRisk(state, playerId, commodityId, direction, qty, config) {
  const player = state.players[playerId];
  if (!player || qty <= 0) return false;
  const currentPrice = state.prices[commodityId];
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return false;
  const marginAdd = config.rules.marginRate * currentPrice * qty;
  const fee = futuresFeeAmount(currentPrice * qty, config, state.feePermanentDelta);
  if (player.cash < marginAdd + fee) return false;
  const tempPos = JSON.parse(JSON.stringify(player.positions));
  if (direction === "long") {
    const old = tempPos[commodityId].long;
    const newTotalQty = old.qty + qty;
    const newAvg = (old.qty * old.avgPrice + qty * currentPrice) / newTotalQty;
    const newMarginLocked = (old.marginLocked ?? 0) + marginAdd;
    tempPos[commodityId].long = { qty: newTotalQty, avgPrice: newAvg, marginLocked: newMarginLocked };
  } else {
    const old = tempPos[commodityId].short;
    const newTotalQty = old.qty + qty;
    const newAvg = (old.qty * old.avgPrice + qty * currentPrice) / newTotalQty;
    const newMarginLocked = (old.marginLocked ?? 0) + marginAdd;
    tempPos[commodityId].short = { qty: newTotalQty, avgPrice: newAvg, marginLocked: newMarginLocked };
  }
  let newFloating = 0;
  for (const c of futuresTradableCommodities(config)) {
    const pid = c.id;
    const pnow = state.prices[pid];
    const lp = tempPos[pid].long;
    if (lp.qty > 0) newFloating += (pnow - lp.avgPrice) * lp.qty;
    const sp = tempPos[pid].short;
    if (sp.qty > 0) newFloating += (sp.avgPrice - pnow) * sp.qty;
  }
  const newEquity =
    player.cash - marginAdd - fee + totalMarginLockedForPlayer({ positions: tempPos }, config.commodities) + newFloating;
  return newEquity >= config.rules.riskMinEquity;
}

/**
 * @param {ReturnType<import('./state.js').createInitialGameState>} state
 * @param {string} playerId
 * @param {import('./config.js').GAME_CONFIG['commodities'][number]} comm
 * @param {'long'|'short'} direction
 * @param {import('./config.js').GAME_CONFIG} config
 */
function maxFeasibleOpenQty(state, playerId, comm, direction, config) {
  const { id, type } = comm;
  const price = state.prices[id];
  const player = state.players[playerId];
  if (!player || price <= 0 || player.cash <= 0) return 0;
  const mr = config.rules.marginRate;
  let maxQty = Math.floor(player.cash / (mr * price));
  if (type === "crop" && direction === "short") {
    if (!comm.requiresGemBoard) {
      const spot = state.spotPool[id] ?? 0;
      const cap = Math.floor(0.2 * spot);
      const cur = player.positions[id].short.qty;
      maxQty = Math.min(maxQty, Math.max(0, cap - cur));
    } else if (player.gemBoardUnlocked) {
      let invVal = 0;
      for (const c of config.commodities.filter((x) => x.type === "crop")) {
        invVal += (player.backpack[c.id] ?? 0) * (state.spotPrices[c.id] ?? 0);
      }
      const cap = (player.cash + invVal) * config.rules.shortNotionalCapRatio;
      const curShort = player.positions[id].short.qty * price;
      maxQty = Math.min(maxQty, Math.max(0, Math.floor((cap - curShort) / price)));
    } else {
      maxQty = 0;
    }
  }
  maxQty = Math.floor(maxQty);
  for (let q = maxQty; q >= 1; q--) {
    if (wouldPassRisk(state, playerId, id, direction, q, config)) return q;
  }
  return 0;
}

/**
 * @param {ReturnType<import('./state.js').createInitialGameState>} state
 * @param {import('./config.js').GAME_CONFIG} config
 * @param {{ openMarketPositionForPlayer: Function, closePositionForPlayer: Function }} api
 * @param {string[]} botPlayerIds
 */
export function runBotTurns(state, config, api, botPlayerIds) {
  if (!botPlayerIds.length) return;
  const { openMarketPositionForPlayer, closePositionForPlayer } = api;
  const rng = () => Math.random();

  for (const aiId of botPlayerIds) {
    const player = state.players[aiId];
    if (!player || player.status !== "playing") continue;

    /** @type {Record<string, boolean>} */
    const closed = {};

    const commsShuffled = shuffle(futuresTradableCommodities(config), rng);
    for (const comm of commsShuffled) {
      if (closed[comm.id]) continue;
      const longQty = player.positions[comm.id].long.qty;
      const shortQty = player.positions[comm.id].short.qty;
      if (longQty === 0 && shortQty === 0) continue;
      if (rng() >= 0.35) continue;
      /** @type {'long'|'short'} */
      let dir;
      if (longQty > 0 && shortQty > 0) {
        dir = rng() < 0.5 ? "long" : "short";
      } else if (longQty > 0) {
        dir = "long";
      } else {
        dir = "short";
      }
      const qty = dir === "long" ? longQty : shortQty;
      closePositionForPlayer(state, aiId, comm.id, dir, qty, config, aiId);
      closed[comm.id] = true;
    }

    const tradable = futuresTradableCommodities(config);
    const remaining = new Set(tradable.map((c) => c.id));
    while (remaining.size > 0) {
      const pool = tradable.filter((c) => remaining.has(c.id));
      if (pool.length === 0) break;
      const pick = pool[Math.floor(rng() * pool.length)];

      const direction = rng() < 0.5 ? "short" : "long";
      const qty = maxFeasibleOpenQty(state, aiId, pick, direction, config);
      if (qty >= 1) {
        openMarketPositionForPlayer(state, aiId, pick.id, direction, qty, config, aiId);
      }
      remaining.delete(pick.id);
    }
  }
}

/**
 * @param {ReturnType<import('./state.js').createInitialGameState>} state
 * @param {import('./config.js').GAME_CONFIG} config
 * @param {{ openMarketPositionForPlayer: Function, closePositionForPlayer: Function }} api
 */
export function runSoloAITurns(state, config, api) {
  if (!state.soloWithAI) return;
  const humanId = state.activePlayerId || "p1";
  runBotTurns(state, config, api, buildSoloAiPlayerIds(humanId));
}
