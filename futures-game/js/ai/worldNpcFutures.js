import { futuresTradableCommodities } from "../core/config.js";
import { futuresFeeAmount } from "../core/rules/fees.js";
import { totalMarginLockedForPlayer } from "../core/state.js";

/** 与 ai/index 同逻辑，避免 worldNpcFutures ↔ index 循环依赖 */
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
 * @typedef {{
 *   npcId: string,
 *   gossipLine: string,
 *   actions: ({ type: 'close', commodityId: string, direction: 'long'|'short', qty: number } |
 *     { type: 'open', commodityId: string, direction: 'long'|'short', qty: number })[],
 * }} WorldNpcIntent
 */

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
 * @param {import('../core/state.js').NpcState} npc
 * @param {ReturnType<import('../core/state.js').createInitialGameState>} state
 * @param {string} commodityId
 * @param {'long'|'short'} direction
 * @param {number} qty
 * @param {import('../core/config.js').GAME_CONFIG} config
 */
export function wouldPassRiskForNpc(npc, state, commodityId, direction, qty, config) {
  if (qty <= 0) return false;
  const currentPrice = state.prices[commodityId];
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return false;
  const marginAdd = config.rules.marginRate * currentPrice * qty;
  const fee = futuresFeeAmount(currentPrice * qty, config, state.feePermanentDelta);
  if (npc.cash < marginAdd + fee) return false;
  const tempPos = JSON.parse(JSON.stringify(npc.positions));
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
    npc.cash - marginAdd - fee + totalMarginLockedForPlayer({ positions: tempPos }, config.commodities) + newFloating;
  return newEquity >= config.rules.riskMinEquity;
}

/**
 * @param {ReturnType<import('../core/state.js').createInitialGameState>} state
 * @param {import('../core/state.js').NpcState} npc
 * @param {import('../core/config.js').GAME_CONFIG['commodities'][number]} comm
 * @param {'long'|'short'} direction
 * @param {import('../core/config.js').GAME_CONFIG} config
 */
function maxFeasibleOpenQtyForNpc(state, npc, comm, direction, config) {
  const { id, type } = comm;
  const price = state.prices[id];
  if (price <= 0 || npc.cash <= 0) return 0;
  const mr = config.rules.marginRate;
  let maxQty = Math.floor(npc.cash / (mr * price));
  if (type === "crop" && direction === "short") {
    if (!comm.requiresGemBoard) {
      const spot = state.spotPool[id] ?? 0;
      const cap = Math.floor(0.2 * spot);
      const cur = npc.positions[id].short.qty;
      maxQty = Math.min(maxQty, Math.max(0, cap - cur));
    } else if (npc.gemBoardUnlocked) {
      const cap = npc.cash * config.rules.shortNotionalCapRatio;
      const curShort = npc.positions[id].short.qty * price;
      maxQty = Math.min(maxQty, Math.max(0, Math.floor((cap - curShort) / price)));
    } else {
      maxQty = 0;
    }
  }
  maxQty = Math.floor(maxQty);
  for (let q = maxQty; q >= 1; q--) {
    if (wouldPassRiskForNpc(npc, state, id, direction, q, config)) return q;
  }
  return 0;
}

/**
 * 模拟平仓（仅用于生成当日计划时的资金/持仓推演，不写 state）
 * @param {import('../core/state.js').NpcState} npcSim
 */
function applyVirtualCloseNpc(npcSim, commodityId, direction, qty, state, config) {
  const pos = npcSim.positions[commodityId][direction];
  qty = Math.min(Math.floor(qty), pos.qty);
  if (qty <= 0) return;
  const currPrice = state.prices[commodityId];
  const locked = pos.marginLocked ?? 0;
  const released = pos.qty > 0 ? (locked * qty) / pos.qty : 0;
  const remLocked = locked - released;
  let profit = 0;
  if (direction === "long") {
    profit = (currPrice - pos.avgPrice) * qty;
    const newQty = pos.qty - qty;
    if (newQty === 0) {
      npcSim.positions[commodityId].long = { qty: 0, avgPrice: 0, marginLocked: 0 };
    } else {
      npcSim.positions[commodityId].long = { qty: newQty, avgPrice: pos.avgPrice, marginLocked: remLocked };
    }
  } else {
    profit = (pos.avgPrice - currPrice) * qty;
    const newQty = pos.qty - qty;
    if (newQty === 0) {
      npcSim.positions[commodityId].short = { qty: 0, avgPrice: 0, marginLocked: 0 };
    } else {
      npcSim.positions[commodityId].short = { qty: newQty, avgPrice: pos.avgPrice, marginLocked: remLocked };
    }
  }
  const fee = futuresFeeAmount(currPrice * qty, config, state.feePermanentDelta);
  npcSim.cash += released + profit - fee;
}

/**
 * @param {import('../core/state.js').NpcState} npcSim
 */
function applyVirtualOpenNpc(npcSim, commodityId, direction, qty, state, config) {
  const currentPrice = state.prices[commodityId];
  const marginAdd = config.rules.marginRate * currentPrice * qty;
  const fee = futuresFeeAmount(currentPrice * qty, config, state.feePermanentDelta);
  npcSim.cash -= marginAdd + fee;
  if (direction === "long") {
    const old = npcSim.positions[commodityId].long;
    const newTotal = old.qty + qty;
    const newAvg = (old.qty * old.avgPrice + qty * currentPrice) / newTotal;
    const newMarginLocked = (old.marginLocked ?? 0) + marginAdd;
    npcSim.positions[commodityId].long = { qty: newTotal, avgPrice: newAvg, marginLocked: newMarginLocked };
  } else {
    const old = npcSim.positions[commodityId].short;
    const newTotal = old.qty + qty;
    const newAvg = (old.qty * old.avgPrice + qty * currentPrice) / newTotal;
    const newMarginLocked = (old.marginLocked ?? 0) + marginAdd;
    npcSim.positions[commodityId].short = { qty: newTotal, avgPrice: newAvg, marginLocked: newMarginLocked };
  }
}

/**
 * 每日开盘生成世界 NPC 期货意向（打听消息与过日前执行共用）
 * @param {ReturnType<import('../core/state.js').createInitialGameState>} state
 * @param {import('../core/config.js').GAME_CONFIG} config
 */
export function generateWorldNpcDailyPlans(state, config) {
  const rng = () => Math.random();
  /** @type {Record<string, string>} */
  const gossip = {};
  /** @type {WorldNpcIntent[]} */
  const intents = [];

  for (const npc of state.npcs) {
    /** @type {WorldNpcIntent['actions']} */
    const closeActions = [];

    const commsShuffled = shuffle(futuresTradableCommodities(config), rng);
    for (const comm of commsShuffled) {
      const longQty = npc.positions[comm.id].long.qty;
      const shortQty = npc.positions[comm.id].short.qty;
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
      closeActions.push({ type: "close", commodityId: comm.id, direction: dir, qty });
    }

    const npcSim = /** @type {import('../core/state.js').NpcState} */ ({
      ...npc,
      positions: JSON.parse(JSON.stringify(npc.positions)),
      cash: npc.cash,
      gemBoardUnlocked: npc.gemBoardUnlocked,
    });
    for (const c of closeActions) {
      if (c.type === "close") {
        applyVirtualCloseNpc(npcSim, c.commodityId, c.direction, c.qty, state, config);
      }
    }

    /** @type {WorldNpcIntent['actions']} */
    const actions = [...closeActions];

    const archetype = npc.archetype;
    const tradable = futuresTradableCommodities(config);
    /** @type {{ comm: (typeof tradable)[number], direction: 'long'|'short' } | null} */
    let strategic = null;
    if (archetype === "trend") strategic = pickTrendTrade(state, config);
    else if (archetype === "value") strategic = pickValueTrade(state, config);
    else if (archetype === "spot") strategic = pickSpotTrade(state, config);

    let openedStrategic = false;
    if (strategic) {
      const qty = maxFeasibleOpenQtyForNpc(state, npcSim, strategic.comm, strategic.direction, config);
      if (qty >= 1) {
        actions.push({ type: "open", commodityId: strategic.comm.id, direction: strategic.direction, qty });
        applyVirtualOpenNpc(npcSim, strategic.comm.id, strategic.direction, qty, state, config);
        openedStrategic = true;
      }
    }

    if (archetype === "random" || !openedStrategic) {
      const remaining = new Set(tradable.map((c) => c.id));
      while (remaining.size > 0) {
        const pool = tradable.filter((c) => remaining.has(c.id));
        if (pool.length === 0) break;
        const pick = pool[Math.floor(rng() * pool.length)];
        const direction = rng() < 0.5 ? "short" : "long";
        const qty = maxFeasibleOpenQtyForNpc(state, npcSim, pick, direction, config);
        if (qty >= 1) {
          actions.push({ type: "open", commodityId: pick.id, direction, qty });
          applyVirtualOpenNpc(npcSim, pick.id, direction, qty, state, config);
        }
        remaining.delete(pick.id);
      }
    }

    const nameMap = Object.fromEntries(config.commodities.filter((c) => c.type === "crop").map((c) => [c.id, c.name]));
    const parts = [];
    for (const a of actions) {
      if (a.type === "close") {
        parts.push(`平${a.direction === "long" ? "多" : "空"}${nameMap[a.commodityId] ?? a.commodityId}×${a.qty}`);
      } else {
        parts.push(`开${a.direction === "long" ? "多" : "空"}${nameMap[a.commodityId] ?? a.commodityId}×${a.qty}`);
      }
    }
    const gossipLine =
      parts.length > 0
        ? `今日打算：${parts.join("；")}（收盘前会按市价执行）`
        : "今日暂无期货操作打算。";

    gossip[npc.id] = gossipLine;
    intents.push({ npcId: npc.id, gossipLine, actions });
  }

  state.worldNpcGossipById = gossip;
  state.worldNpcIntents = intents;
}

/**
 * @param {ReturnType<import('../core/state.js').createInitialGameState>} state
 * @param {import('../core/config.js').GAME_CONFIG} config
 * @param {{
 *   openMarketPositionForWorldNpc: typeof import('../core/rules/gameReducer.js').openMarketPositionForWorldNpc,
 *   closePositionForWorldNpc: typeof import('../core/rules/gameReducer.js').closePositionForWorldNpc,
 * }} api
 */
export function executeWorldNpcFuturesTurns(state, config, api) {
  if (!state.worldNpcIntents?.length) return;
  const { openMarketPositionForWorldNpc, closePositionForWorldNpc } = api;
  for (const intent of state.worldNpcIntents) {
    const npc = state.npcs.find((n) => n.id === intent.npcId);
    if (!npc) continue;
    for (const act of intent.actions) {
      if (act.type === "close") {
        closePositionForWorldNpc(state, intent.npcId, act.commodityId, act.direction, act.qty, config, npc.name);
      } else {
        openMarketPositionForWorldNpc(state, intent.npcId, act.commodityId, act.direction, act.qty, config, npc.name);
      }
    }
  }
}
