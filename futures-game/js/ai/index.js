import { futuresTradableCommodities } from "../core/config.js";
import { futuresFeeAmount } from "../core/rules/fees.js";
import { getEffectiveRiskMinEquity } from "../core/rules/riskEquity.js";
import { buildSoloAiPlayerIds, totalMarginLockedForPlayer } from "../core/state.js";

/** rng 大于等于该值则跳过平仓尝试（提高平仓意愿则增大此值） */
const BOT_CLOSE_SKIP_THRESHOLD = 0.45;
/** random  archetype 补位开仓每日最多尝试次数 */
const BOT_MAX_FILL_OPENS_RANDOM = 2;
/** 其它 archetype 补位开仓每日最多尝试次数 */
const BOT_MAX_FILL_OPENS_OTHER = 3;

/**
 * @param {ReturnType<import('../core/state.js').createInitialGameState>} state
 * @param {string} playerId
 */
function getArchetypeForBot(state, playerId) {
  if (state.soloWithAI) {
    const soloIds = buildSoloAiPlayerIds(state.activePlayerId || "p1");
    const idx = soloIds.indexOf(playerId);
    if (idx >= 0) {
      const types = /** @type {const} */ ([
        "random",
        "random",
        "trend",
        "trend",
        "value",
        "value",
        "spot",
        "spot",
        "random",
      ]);
      return types[idx] ?? "random";
    }
  }
  return "random";
}

/**
 * @param {ReturnType<import('../core/state.js').createInitialGameState>} state
 * @param {typeof import('../core/config.js').GAME_CONFIG} config
 */
function pickTrendTrade(state, config) {
  const tradable = futuresTradableCommodities(config);
  for (const comm of tradable) {
    const h = state.futuresPriceHistory[comm.id] ?? [];
    if (h.length < 3) continue;
    const p0 = h[h.length - 3];
    const p1 = h[h.length - 2];
    const p2 = h[h.length - 1];
    if (p0 < p1 && p1 < p2) return { comm, direction: /** @type {const} */ ("long") };
    if (p0 > p1 && p1 > p2) return { comm, direction: /** @type {const} */ ("short") };
  }
  return null;
}

/**
 * @param {ReturnType<import('../core/state.js').createInitialGameState>} state
 * @param {typeof import('../core/config.js').GAME_CONFIG} config
 */
function pickValueTrade(state, config) {
  const tradable = futuresTradableCommodities(config);
  /** @type {{ comm: (typeof tradable)[number], direction: 'long'|'short' } | null} */
  let best = null;
  let bestAbs = 0;
  for (const comm of tradable) {
    const h = state.futuresPriceHistory[comm.id] ?? [];
    if (h.length < 2) continue;
    const arr = h.slice(-5);
    const avg = arr.reduce((x, y) => x + y, 0) / arr.length;
    const p = state.prices[comm.id];
    if (!avg || avg <= 0) continue;
    const dev = (p - avg) / avg;
    if (Math.abs(dev) > bestAbs && Math.abs(dev) >= 0.05) {
      bestAbs = Math.abs(dev);
      best = { comm, direction: dev > 0 ? "short" : "long" };
    }
  }
  return best;
}

/**
 * @param {ReturnType<import('../core/state.js').createInitialGameState>} state
 * @param {typeof import('../core/config.js').GAME_CONFIG} config
 */
function pickSpotTrade(state, config) {
  const tradable = futuresTradableCommodities(config);
  /** @type {{ comm: (typeof tradable)[number], direction: 'long'|'short' } | null} */
  let best = null;
  let bestAbs = 0;
  for (const comm of tradable) {
    const pool = state.spotPool[comm.id] ?? 0;
    const snap = state.spotPoolSnapshot?.[comm.id] ?? pool;
    const delta = pool - snap;
    if (Math.abs(delta) > bestAbs) {
      bestAbs = Math.abs(delta);
      best = { comm, direction: delta > 0 ? "short" : "long" };
    }
  }
  return best && bestAbs > 0 ? best : null;
}

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
 * @param {ReturnType<import('../core/state.js').createInitialGameState>} state
 * @param {string} playerId
 * @param {string} commodityId
 * @param {'long'|'short'} direction
 * @param {number} qty
 * @param {import('../core/config.js').GAME_CONFIG} config
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
  return newEquity >= getEffectiveRiskMinEquity(state, config, playerId);
}

/**
 * @param {ReturnType<import('../core/state.js').createInitialGameState>} state
 * @param {string} playerId
 * @param {import('../core/config.js').GAME_CONFIG['commodities'][number]} comm
 * @param {'long'|'short'} direction
 * @param {import('../core/config.js').GAME_CONFIG} config
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
 * @param {ReturnType<import('../core/state.js').createInitialGameState>} state
 * @param {import('../core/config.js').GAME_CONFIG} config
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
      if (rng() >= BOT_CLOSE_SKIP_THRESHOLD) continue;
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

    const archetype = getArchetypeForBot(state, aiId);
    const tradable = futuresTradableCommodities(config);

    /** @type {{ comm: (typeof tradable)[number], direction: 'long'|'short' } | null} */
    let strategic = null;
    if (archetype === "trend") strategic = pickTrendTrade(state, config);
    else if (archetype === "value") strategic = pickValueTrade(state, config);
    else if (archetype === "spot") strategic = pickSpotTrade(state, config);

    let openedStrategic = false;
    if (strategic) {
      const qty = maxFeasibleOpenQty(state, aiId, strategic.comm, strategic.direction, config);
      if (qty >= 1) {
        openMarketPositionForPlayer(state, aiId, strategic.comm.id, strategic.direction, qty, config, aiId);
        openedStrategic = true;
      }
    }

    if (archetype === "random" || !openedStrategic) {
      const maxFillOpens = archetype === "random" ? BOT_MAX_FILL_OPENS_RANDOM : BOT_MAX_FILL_OPENS_OTHER;
      const remaining = new Set(tradable.map((c) => c.id));
      let fillAttempts = 0;
      while (remaining.size > 0 && fillAttempts < maxFillOpens) {
        fillAttempts += 1;
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
}

/**
 * @param {ReturnType<import('../core/state.js').createInitialGameState>} state
 * @param {import('../core/config.js').GAME_CONFIG} config
 * @param {{ openMarketPositionForPlayer: Function, closePositionForPlayer: Function }} api
 */
export function runSoloAITurns(state, config, api) {
  if (!state.soloWithAI) return;
  const humanId = state.activePlayerId || "p1";
  runBotTurns(state, config, api, buildSoloAiPlayerIds(humanId));
}
