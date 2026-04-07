import { GAME_CONFIG } from "./config.js";
import { runSoloAITurns } from "./ai.js";
import { computeDeliveryPriceFromOpenInterest, computeNextPriceFromDailyStats } from "./pricing.js";
import {
  buildEmptyDailyStats,
  buildInitialSpotPool,
  buildSoloAiPlayerIds,
  createPlayerState,
  DEFAULT_PLAYER_ID,
  getActivePlayer,
} from "./state.js";

/**
 * @param {ReturnType<import('./state.js').createInitialGameState>} state
 * @param {string} playerId
 * @param {typeof GAME_CONFIG} config
 */
export function computeEquityForPlayer(state, playerId, config = GAME_CONFIG) {
  const player = state.players[playerId];
  if (!player) return 0;
  let floating = 0;
  for (const comm of config.commodities) {
    const id = comm.id;
    const currPrice = state.prices[id];
    const pos = player.positions[id];
    if (pos.long.qty > 0) {
      floating += (currPrice - pos.long.avgPrice) * pos.long.qty;
    }
    if (pos.short.qty > 0) {
      floating += (pos.short.avgPrice - currPrice) * pos.short.qty;
    }
  }
  return player.cash + floating;
}

/**
 * @param {ReturnType<import('./state.js').createInitialGameState>} state
 * @param {typeof GAME_CONFIG} config
 */
export function computeEquity(state, config = GAME_CONFIG) {
  const id = state.activePlayerId || DEFAULT_PLAYER_ID;
  return computeEquityForPlayer(state, id, config);
}

/**
 * @param {ReturnType<import('./state.js').createInitialGameState>} state
 * @param {string} msg
 * @param {typeof GAME_CONFIG} config
 */
function pushLog(state, msg, config = GAME_CONFIG) {
  const line = `[Day ${state.currentDay}] ${msg}`;
  const next = [line, ...state.logEntries];
  if (next.length > config.rules.maxLogEntries) {
    next.length = config.rules.maxLogEntries;
  }
  state.logEntries = next;
}

function commodityName(config, id) {
  return config.commodities.find((c) => c.id === id)?.name ?? id;
}

/**
 * @param {ReturnType<import('./state.js').createInitialGameState>} state
 * @param {string} commodityId
 * @param {'openLong'|'openShort'|'longClose'|'shortClose'} field
 * @param {number} qty
 */
function bumpDailyStat(state, commodityId, field, qty) {
  const s = state.dailyStats[commodityId];
  if (!s) return;
  s[field] += qty;
}

/**
 * @param {typeof GAME_CONFIG} config
 */
function pricingRules(config) {
  return {
    minMoveRatio: config.rules.minMoveRatio,
    limitMoveRatio: config.rules.limitMoveRatio,
    minPrice: config.rules.minPrice,
  };
}

/**
 * 日终：按当日成交量更新各品种价格并清空 dailyStats。
 * @param {ReturnType<import('./state.js').createInitialGameState>} state
 * @param {typeof GAME_CONFIG} config
 */
function applyEndOfDayPricing(state, config) {
  const rules = pricingRules(config);
  const parts = [];
  for (const comm of config.commodities) {
    const id = comm.id;
    const oldPrice = state.prices[id];
    const stats = state.dailyStats[id];
    const { newPrice, ratioApplied, totalVolume } = computeNextPriceFromDailyStats(oldPrice, stats, rules);
    state.prices[id] = newPrice;
    if (totalVolume === 0) {
      parts.push(`${comm.name} 无成交`);
    } else {
      const pct = (ratioApplied * 100).toFixed(2);
      parts.push(`${comm.name} ${ratioApplied >= 0 ? "+" : ""}${pct}%`);
    }
  }
  state.dailyStats = buildEmptyDailyStats(config.commodities);
  pushLog(state, `📊 收盘调价: ${parts.join("；")}`, config);
}

/**
 * @param {ReturnType<import('./state.js').createInitialGameState>} state
 * @param {typeof GAME_CONFIG} config
 */
function checkOrdersMatch(state, config) {
  const player = getActivePlayer(state);
  for (let i = 0; i < player.pendingOrders.length; i++) {
    const order = player.pendingOrders[i];
    const currentPrice = state.prices[order.commodityId];
    let shouldMatch = false;
    if (order.type === "long" && currentPrice <= order.price) shouldMatch = true;
    if (order.type === "short" && currentPrice >= order.price) shouldMatch = true;
    if (shouldMatch) {
      const comm = config.commodities.find((c) => c.id === order.commodityId);
      const name = comm ? comm.name : order.commodityId;
      if (order.type === "long") {
        bumpDailyStat(state, order.commodityId, "openLong", order.quantity);
        const old = player.positions[order.commodityId].long;
        const newQty = old.qty + order.quantity;
        const newAvg = (old.qty * old.avgPrice + order.quantity * order.price) / newQty;
        player.positions[order.commodityId].long = { qty: newQty, avgPrice: newAvg };
        pushLog(
          state,
          `✅ 挂单成交: ${name} 限价买入开多 ${order.quantity}手 @ ${order.price.toFixed(2)} (触发价${currentPrice.toFixed(2)})`,
          config
        );
      } else {
        bumpDailyStat(state, order.commodityId, "openShort", order.quantity);
        const old = player.positions[order.commodityId].short;
        const newQty = old.qty + order.quantity;
        const newAvg = (old.qty * old.avgPrice + order.quantity * order.price) / newQty;
        player.positions[order.commodityId].short = { qty: newQty, avgPrice: newAvg };
        pushLog(
          state,
          `✅ 挂单成交: ${name} 限价卖出开空 ${order.quantity}手 @ ${order.price.toFixed(2)} (触发价${currentPrice.toFixed(2)})`,
          config
        );
      }
      player.pendingOrders.splice(i, 1);
      i--;
    }
  }
}

/**
 * @param {ReturnType<import('./state.js').createInitialGameState>} state
 * @param {typeof GAME_CONFIG} config
 */
function performDelivery(state, config) {
  pushLog(state, "🔥🔥🔥 【交割日】第7天：按持仓确定交割价，作物现货交割，种子多头付现入背包 🔥🔥🔥", config);

  const rules = pricingRules(config);
  /** @type {Record<string, number>} */
  const deliveryPrice = {};
  for (const comm of config.commodities) {
    const id = comm.id;
    let longSum = 0;
    let shortSum = 0;
    for (const pid of Object.keys(state.players)) {
      const pl = state.players[pid];
      longSum += pl.positions[id].long.qty;
      shortSum += pl.positions[id].short.qty;
    }
    const { newPrice } = computeDeliveryPriceFromOpenInterest(state.prices[id], longSum, shortSum, rules);
    deliveryPrice[id] = newPrice;
    pushLog(
      state,
      `📌 ${comm.name} 交割参考价 ${newPrice.toFixed(2)} (聚合多${longSum} / 空${shortSum})`,
      config
    );
  }

  let deliveryStress = false;
  const cropIds = config.commodities.filter((c) => c.type === "crop").map((c) => c.id);

  for (const id of cropIds) {
    const dPrice = deliveryPrice[id];
    const name = commodityName(config, id);

    const shortPlayers = Object.keys(state.players).filter(
      (pid) => state.players[pid].positions[id].short.qty > 0 && state.players[pid].status === "playing"
    );
    shortPlayers.sort(
      (a, b) => state.players[b].positions[id].short.qty - state.players[a].positions[id].short.qty
    );

    for (const pid of shortPlayers) {
      const pl = state.players[pid];
      const shortQty = pl.positions[id].short.qty;
      const spotRem = state.spotPool[id] ?? 0;
      const backpackAvail = pl.backpack[id] ?? 0;

      if (shortQty > spotRem + backpackAvail) {
        pl.status = "failed";
        deliveryStress = true;
        pushLog(
          state,
          `💀 ${name} 空头 ${shortQty}手：现货不足(池${spotRem}+背包${backpackAvail})，游戏失败`,
          config
        );
        continue;
      }

      const pay = dPrice * shortQty;
      if (pl.cash < pay) {
        pl.status = "failed";
        deliveryStress = true;
        pushLog(state, `💀 ${name} 空头 ${shortQty}手：需付 ${pay.toFixed(2)} 现金不足，游戏失败`, config);
        continue;
      }

      let need = shortQty;
      const useBack = Math.min(need, backpackAvail);
      pl.backpack[id] = backpackAvail - useBack;
      need -= useBack;
      const fromPool = need;
      state.spotPool[id] = spotRem - fromPool;
      pl.cash -= pay;
      pl.positions[id].short = { qty: 0, avgPrice: 0 };
      pushLog(
        state,
        `📦 ${name} 空头交割 ${shortQty}手：背包-${useBack} 池-${fromPool} 付现 ${pay.toFixed(2)}`,
        config
      );
    }
  }

  for (const id of cropIds) {
    const dPrice = deliveryPrice[id];
    const name = commodityName(config, id);

    const longPlayers = Object.keys(state.players).filter(
      (pid) => state.players[pid].positions[id].long.qty > 0 && state.players[pid].status === "playing"
    );
    longPlayers.sort(
      (a, b) => state.players[b].positions[id].long.qty - state.players[a].positions[id].long.qty
    );

    for (const pid of longPlayers) {
      const pl = state.players[pid];
      const longQty = pl.positions[id].long.qty;
      const spotRem = state.spotPool[id] ?? 0;
      const take = Math.min(longQty, spotRem);

      if (take === 0) {
        pl.positions[id].long = { qty: 0, avgPrice: 0 };
        pushLog(state, `📦 ${name} 多头 ${longQty}手：现货池无货，无需付现，头寸了结`, config);
        continue;
      }

      const cost = dPrice * take;
      if (pl.cash < cost) {
        pl.status = "failed";
        deliveryStress = true;
        pushLog(state, `💀 ${name} 多头 应付 ${cost.toFixed(2)} 现金不足，游戏失败`, config);
        continue;
      }

      pl.cash -= cost;
      pl.backpack[id] = (pl.backpack[id] ?? 0) + take;
      state.spotPool[id] = spotRem - take;
      pl.positions[id].long = { qty: 0, avgPrice: 0 };
      pushLog(
        state,
        `📦 ${name} 多头交割 ${take}手 @ ${dPrice.toFixed(2)}，付现 ${cost.toFixed(2)}，现货入背包`,
        config
      );
    }
  }

  const seedComms = config.commodities.filter((c) => c.type === "seed");
  for (const comm of seedComms) {
    const id = comm.id;
    const dPrice = deliveryPrice[id];
    const name = commodityName(config, id);

    for (const pid of Object.keys(state.players)) {
      const pl = state.players[pid];
      const sp = pl.positions[id].short;
      if (sp.qty <= 0) continue;
      const profit = (sp.avgPrice - dPrice) * sp.qty;
      pl.cash += profit;
      pl.positions[id].short = { qty: 0, avgPrice: 0 };
      pushLog(
        state,
        `🌱 ${name} 空头现金结算 ${sp.qty}手 盈亏 ${profit >= 0 ? "+" : ""}${profit.toFixed(2)}`,
        config
      );
    }

    for (const pid of Object.keys(state.players)) {
      const pl = state.players[pid];
      if (pl.status !== "playing") continue;
      const lp = pl.positions[id].long;
      if (lp.qty <= 0) continue;
      const pay = dPrice * lp.qty;
      if (pl.cash < pay) {
        pl.status = "failed";
        deliveryStress = true;
        pushLog(state, `💀 ${name} 多头需付 ${pay.toFixed(2)} 购种，现金不足，游戏失败`, config);
        continue;
      }
      pl.cash -= pay;
      pl.backpack[id] = (pl.backpack[id] ?? 0) + lp.qty;
      pl.positions[id].long = { qty: 0, avgPrice: 0 };
      pushLog(state, `🌱 ${name} 多头付 ${pay.toFixed(2)}，种子×${lp.qty} 入背包`, config);
    }
  }

  for (const pid of Object.keys(state.players)) {
    state.players[pid].pendingOrders = [];
  }

  const wide = deliveryStress ? 10 : 3;
  for (const id of cropIds) {
    const pct = Math.floor(Math.random() * (2 * wide + 1)) - wide;
    const next = Math.max(rules.minPrice, Math.round(state.prices[id] * (1 + pct / 100) * 100) / 100);
    state.prices[id] = next;
    pushLog(state, `📈 ${commodityName(config, id)} 交割后现货价波动 ${pct >= 0 ? "+" : ""}${pct}% → ${next.toFixed(2)}`, config);
  }

  const p = getActivePlayer(state);
  pushLog(state, `🎉 交割流程结束。当前现金 ${p.cash.toFixed(2)}`, config);
}

/**
 * 终局：按现价强制卖出所有玩家背包中的作物（种子保留）。
 * @param {ReturnType<import('./state.js').createInitialGameState>} state
 * @param {typeof GAME_CONFIG} config
 */
function liquidateAllCropsForAllPlayers(state, config) {
  const cropIds = config.commodities.filter((c) => c.type === "crop").map((c) => c.id);
  for (const pid of Object.keys(state.players)) {
    const pl = state.players[pid];
    for (const cropId of cropIds) {
      const qty = Math.floor(pl.backpack[cropId] ?? 0);
      if (qty <= 0) continue;
      const price = state.prices[cropId];
      const proceeds = price * qty;
      pl.backpack[cropId] = 0;
      state.spotPool[cropId] = (state.spotPool[cropId] ?? 0) + qty;
      pl.cash += proceeds;
      pushLog(
        state,
        `🏁 终局清盘 ${pid} 卖出 ${commodityName(config, cropId)} ×${qty} @ ${price.toFixed(2)} → +${proceeds.toFixed(2)}`,
        config
      );
    }
  }
}

/**
 * @param {ReturnType<import('./state.js').createInitialGameState>} state
 * @param {typeof GAME_CONFIG} config
 */
function forceEndGame(state, config) {
  liquidateAllCropsForAllPlayers(state, config);
  const rows = Object.keys(state.players)
    .map((playerId) => ({ playerId, cash: state.players[playerId].cash }))
    .sort((a, b) => b.cash - a.cash);
  state.finalRanking = rows;
  state.gameEnded = true;
  pushLog(state, `🏁 第 ${config.rules.totalGameDays} 天交割完成，作物已强制卖出，按现金结算排名。`, config);
}

/**
 * @param {ReturnType<import('./state.js').createInitialGameState>} state
 * @param {typeof GAME_CONFIG} config
 */
function nextDayInternal(state, config) {
  if (state.gameEnded) return;
  const totalDays = config.rules.totalGameDays ?? 28;
  if (state.currentDay === config.rules.cycleDays) {
    applyEndOfDayPricing(state, config);
    performDelivery(state, config);
    if (state.globalDay === totalDays) {
      forceEndGame(state, config);
      return;
    }
    state.currentDay = 1;
    state.globalDay += 1;
    pushLog(state, "🌾 新轮回开启 第1天，市场价格延续昨日收盘价，祝您好运！", config);
    return;
  }
  applyEndOfDayPricing(state, config);
  state.currentDay += 1;
  state.globalDay += 1;
  if (config.features?.limitOrders) {
    checkOrdersMatch(state, config);
  }
  pushLog(state, `⏩ 进入第 ${state.currentDay} 天`, config);
}

/**
 * @param {ReturnType<import('./state.js').createInitialGameState>} state
 * @param {string} playerId
 * @param {string} commodityId
 * @param {'long'|'short'} direction
 * @param {number} qty
 * @param {typeof GAME_CONFIG} config
 * @param {string} [actorLabel] 日志前缀（如 AI 玩家 id）
 */
export function openMarketPositionForPlayer(state, playerId, commodityId, direction, qty, config, actorLabel) {
  if (state.gameEnded) {
    pushLog(state, "❌ 游戏已结束", config);
    return;
  }
  const player = state.players[playerId];
  if (!player) return;
  if (player.status === "failed") {
    pushLog(state, actorLabel ? `[${actorLabel}] ❌ 已失败，无法交易` : "❌ 已失败，无法交易", config);
    return;
  }
  if (qty <= 0 || !Number.isFinite(qty)) {
    pushLog(state, actorLabel ? `[${actorLabel}] ❌ 数量无效` : "❌ 数量无效", config);
    return;
  }
  qty = Math.floor(qty);
  if (qty === 0) return;

  const currentPrice = state.prices[commodityId];
  const tempPos = JSON.parse(JSON.stringify(player.positions));
  if (direction === "long") {
    const old = tempPos[commodityId].long;
    const newTotalQty = old.qty + qty;
    const newAvg = (old.qty * old.avgPrice + qty * currentPrice) / newTotalQty;
    tempPos[commodityId].long = { qty: newTotalQty, avgPrice: newAvg };
  } else {
    const old = tempPos[commodityId].short;
    const newTotalQty = old.qty + qty;
    const newAvg = (old.qty * old.avgPrice + qty * currentPrice) / newTotalQty;
    tempPos[commodityId].short = { qty: newTotalQty, avgPrice: newAvg };
  }

  let newFloating = 0;
  for (const c of config.commodities) {
    const pid = c.id;
    const pnow = state.prices[pid];
    const lp = tempPos[pid].long;
    if (lp.qty > 0) newFloating += (pnow - lp.avgPrice) * lp.qty;
    const sp = tempPos[pid].short;
    if (sp.qty > 0) newFloating += (sp.avgPrice - pnow) * sp.qty;
  }
  const newEquity = player.cash + newFloating;
  if (newEquity < config.rules.riskMinEquity) {
    pushLog(
      state,
      actorLabel
        ? `[${actorLabel}] ⚠️ 风控拦截: 开仓后预计资产 ${newEquity.toFixed(2)} 过低, 禁止开仓`
        : `⚠️ 风控拦截: 开仓后预计资产 ${newEquity.toFixed(2)} 过低, 禁止开仓`,
      config
    );
    return;
  }

  const tag = actorLabel ? `[${actorLabel}] ` : "";
  if (direction === "long") {
    bumpDailyStat(state, commodityId, "openLong", qty);
    const old = player.positions[commodityId].long;
    const newTotal = old.qty + qty;
    const newAvg = (old.qty * old.avgPrice + qty * currentPrice) / newTotal;
    player.positions[commodityId].long = { qty: newTotal, avgPrice: newAvg };
    pushLog(
      state,
      `${tag}🎯 市价开多 ${commodityName(config, commodityId)} ${qty}手 @ ${currentPrice.toFixed(2)}`,
      config
    );
  } else {
    bumpDailyStat(state, commodityId, "openShort", qty);
    const old = player.positions[commodityId].short;
    const newTotal = old.qty + qty;
    const newAvg = (old.qty * old.avgPrice + qty * currentPrice) / newTotal;
    player.positions[commodityId].short = { qty: newTotal, avgPrice: newAvg };
    pushLog(
      state,
      `${tag}🎯 市价开空 ${commodityName(config, commodityId)} ${qty}手 @ ${currentPrice.toFixed(2)}`,
      config
    );
  }
}

/**
 * @param {ReturnType<import('./state.js').createInitialGameState>} state
 * @param {typeof GAME_CONFIG} config
 */
function openMarketPosition(state, commodityId, direction, qty, config) {
  openMarketPositionForPlayer(state, state.activePlayerId || DEFAULT_PLAYER_ID, commodityId, direction, qty, config);
}

/**
 * @param {ReturnType<import('./state.js').createInitialGameState>} state
 * @param {string} playerId
 * @param {string} commodityId
 * @param {'long'|'short'} direction
 * @param {number} qty
 * @param {typeof GAME_CONFIG} config
 * @param {string} [actorLabel]
 */
export function closePositionForPlayer(state, playerId, commodityId, direction, qty, config, actorLabel) {
  if (state.gameEnded) {
    pushLog(state, "❌ 游戏已结束", config);
    return;
  }
  const player = state.players[playerId];
  if (!player) return;
  if (player.status === "failed") {
    pushLog(state, actorLabel ? `[${actorLabel}] ❌ 已失败，无法平仓` : "❌ 已失败，无法平仓", config);
    return;
  }
  const pos = player.positions[commodityId][direction];
  if (pos.qty === 0) {
    pushLog(state, actorLabel ? `[${actorLabel}] 无${direction === "long" ? "多单" : "空单"}可平` : `无${direction === "long" ? "多单" : "空单"}可平`, config);
    return;
  }
  if (qty <= 0 || !Number.isFinite(qty)) return;
  qty = Math.min(Math.floor(qty), pos.qty);
  if (qty === 0) return;

  const currPrice = state.prices[commodityId];
  let profit = 0;
  const tag = actorLabel ? `[${actorLabel}] ` : "";
  if (direction === "long") {
    bumpDailyStat(state, commodityId, "longClose", qty);
    profit = (currPrice - pos.avgPrice) * qty;
    const newQty = pos.qty - qty;
    if (newQty === 0) {
      player.positions[commodityId].long = { qty: 0, avgPrice: 0 };
    } else {
      player.positions[commodityId].long = { qty: newQty, avgPrice: pos.avgPrice };
    }
  } else {
    bumpDailyStat(state, commodityId, "shortClose", qty);
    profit = (pos.avgPrice - currPrice) * qty;
    const newQty = pos.qty - qty;
    if (newQty === 0) {
      player.positions[commodityId].short = { qty: 0, avgPrice: 0 };
    } else {
      player.positions[commodityId].short = { qty: newQty, avgPrice: pos.avgPrice };
    }
  }
  player.cash += profit;
  pushLog(
    state,
    `${tag}💸 平仓 ${direction === "long" ? "多单" : "空单"} ${commodityName(config, commodityId)} ${qty}手，盈亏: ${profit >= 0 ? `+${profit.toFixed(2)}` : `${profit.toFixed(2)}`}`,
    config
  );
}

/**
 * @param {ReturnType<import('./state.js').createInitialGameState>} state
 * @param {typeof GAME_CONFIG} config
 */
function closePosition(state, commodityId, direction, qty, config) {
  closePositionForPlayer(state, state.activePlayerId || DEFAULT_PLAYER_ID, commodityId, direction, qty, config);
}

/**
 * @param {ReturnType<import('./state.js').createInitialGameState>} state
 * @param {typeof GAME_CONFIG} config
 */
function placeLimitOrder(state, commodityId, direction, price, qty, config) {
  if (state.gameEnded) {
    pushLog(state, "❌ 游戏已结束", config);
    return;
  }
  const player = getActivePlayer(state);
  if (player.status === "failed") {
    pushLog(state, "❌ 已失败，无法挂单", config);
    return;
  }
  if (isNaN(price) || price <= 0 || isNaN(qty) || qty <= 0) {
    pushLog(state, "❌ 挂单价格/数量无效", config);
    return;
  }
  qty = Math.floor(qty);
  if (qty === 0) return;
  const order = {
    id: state.nextOrderId++,
    commodityId,
    type: direction,
    price,
    quantity: qty,
  };
  player.pendingOrders.push(order);
  pushLog(
    state,
    `📌 挂单成功: ${commodityName(config, commodityId)} ${direction === "long" ? "买入开多" : "卖出开空"} ${qty}手 @ ${price.toFixed(2)}`,
    config
  );
}

/**
 * @param {ReturnType<import('./state.js').createInitialGameState>} state
 * @param {typeof GAME_CONFIG} config
 */
function cancelOrder(state, orderId, config) {
  if (state.gameEnded) {
    pushLog(state, "❌ 游戏已结束", config);
    return;
  }
  const player = getActivePlayer(state);
  const idx = player.pendingOrders.findIndex((o) => o.id === orderId);
  if (idx !== -1) {
    const removed = player.pendingOrders[idx];
    player.pendingOrders.splice(idx, 1);
    pushLog(
      state,
      `🗑️ 撤单: ${commodityName(config, removed.commodityId)} ${removed.type === "long" ? "多单挂单" : "空单挂单"}`,
      config
    );
  }
}

/**
 * 背包作物现货：按现价卖出变现，等量实物回到公共现货池。
 * @param {ReturnType<import('./state.js').createInitialGameState>} state
 * @param {string} cropId
 * @param {number} qty
 * @param {typeof GAME_CONFIG} config
 */
function sellCropSpotFromBackpack(state, cropId, qty, config) {
  if (state.gameEnded) {
    pushLog(state, "❌ 游戏已结束", config);
    return;
  }
  const player = getActivePlayer(state);
  if (player.status === "failed") {
    pushLog(state, "❌ 已失败，无法卖出现货", config);
    return;
  }
  if (qty <= 0 || !Number.isFinite(qty)) {
    pushLog(state, "❌ 数量无效", config);
    return;
  }
  qty = Math.floor(qty);
  if (qty === 0) return;

  const cropComm = config.commodities.find((c) => c.id === cropId);
  if (!cropComm || cropComm.type !== "crop") {
    pushLog(state, "❌ 仅作物现货可卖出至池", config);
    return;
  }

  const have = player.backpack[cropId] ?? 0;
  if (have < qty) {
    pushLog(state, `❌ 现货不足 (持有 ${have})`, config);
    return;
  }

  const price = state.prices[cropId];
  const proceeds = price * qty;
  player.backpack[cropId] = have - qty;
  state.spotPool[cropId] = (state.spotPool[cropId] ?? 0) + qty;
  player.cash += proceeds;
  pushLog(
    state,
    `🏛️ 卖出现货 ${commodityName(config, cropId)} ×${qty} @ ${price.toFixed(2)} → +${proceeds.toFixed(2)}，${qty} 单位回公共池`,
    config
  );
}

/**
 * @param {ReturnType<import('./state.js').createInitialGameState>} state
 * @param {string} seedId
 * @param {number} qty
 * @param {typeof GAME_CONFIG} config
 */
function useSeed(state, seedId, qty, config) {
  if (state.gameEnded) {
    pushLog(state, "❌ 游戏已结束", config);
    return;
  }
  const player = getActivePlayer(state);
  if (player.status === "failed") {
    pushLog(state, "❌ 已失败，无法使用种子", config);
    return;
  }
  if (qty <= 0 || !Number.isFinite(qty)) {
    pushLog(state, "❌ 使用数量无效", config);
    return;
  }
  qty = Math.floor(qty);
  if (qty === 0) return;

  const seedComm = config.commodities.find((c) => c.id === seedId);
  if (!seedComm || seedComm.type !== "seed" || !("yieldsCropId" in seedComm) || !seedComm.yieldsCropId) {
    pushLog(state, "❌ 不是可种植的种子", config);
    return;
  }
  const cropId = seedComm.yieldsCropId;
  const cropComm = config.commodities.find((c) => c.id === cropId);
  if (!cropComm || cropComm.type !== "crop") {
    pushLog(state, "❌ 种子配置错误", config);
    return;
  }

  const have = player.backpack[seedId] ?? 0;
  if (have < qty) {
    pushLog(state, `❌ 种子不足 (持有 ${have})`, config);
    return;
  }

  player.backpack[seedId] = have - qty;
  player.backpack[cropId] = (player.backpack[cropId] ?? 0) + qty;
  pushLog(
    state,
    `🌱 使用 ${commodityName(config, seedId)} ×${qty} → 获得 ${commodityName(config, cropId)} 现货 ×${qty}`,
    config
  );
}

/**
 * @param {ReturnType<import('./state.js').createInitialGameState>} state
 * @param {typeof GAME_CONFIG} config
 */
function resetGame(state, config) {
  state.prices = { ...config.initial.prices };
  state.dailyStats = buildEmptyDailyStats(config.commodities);
  state.currentDay = config.initial.day;
  state.globalDay = config.initial.day;
  state.gameEnded = false;
  state.finalRanking = null;
  state.nextOrderId = config.initial.nextOrderId;
  state.logEntries = [];
  const pid = state.activePlayerId;
  state.spotPool = buildInitialSpotPool(config);
  if (state.soloWithAI) {
    /** @type {Record<string, ReturnType<createPlayerState>>} */
    const players = { [pid]: createPlayerState(config) };
    for (const aid of buildSoloAiPlayerIds(pid)) {
      players[aid] = createPlayerState(config);
    }
    state.players = players;
  } else {
    state.players = {
      [pid]: createPlayerState(config),
    };
  }
  pushLog(state, "🔄 游戏已重置。初始资金10万，新一轮周期开始！", config);
}

/**
 * @typedef {object} GameAction
 * @property {'RESET'|'NEXT_DAY'|'OPEN_MARKET'|'CLOSE'|'PLACE_LIMIT'|'CANCEL_ORDER'|'APPEND_LOG'|'USE_SEED'|'SELL_CROP_SPOT'} type
 * @property {string} [commodityId]
 * @property {'long'|'short'} [direction]
 * @property {number} [qty]
 * @property {number} [price]
 * @property {number} [orderId]
 * @property {string} [message]
 * @property {string} [seedId]
 */

/**
 * 纯逻辑入口：根据 action 更新 state（就地修改，调用方可先 clone）。
 * @param {ReturnType<import('./state.js').createInitialGameState>} state
 * @param {GameAction} action
 * @param {typeof GAME_CONFIG} [config]
 */
export function reduce(state, action, config = GAME_CONFIG) {
  switch (action.type) {
    case "RESET":
      resetGame(state, config);
      break;
    case "NEXT_DAY":
      runSoloAITurns(state, config, {
        openMarketPositionForPlayer,
        closePositionForPlayer,
      });
      nextDayInternal(state, config);
      break;
    case "OPEN_MARKET":
      openMarketPosition(state, action.commodityId, action.direction, action.qty, config);
      break;
    case "CLOSE":
      closePosition(state, action.commodityId, action.direction, action.qty, config);
      break;
    case "PLACE_LIMIT":
      if (config.features?.limitOrders) {
        placeLimitOrder(state, action.commodityId, action.direction, action.price, action.qty, config);
      }
      break;
    case "CANCEL_ORDER":
      if (config.features?.limitOrders) {
        cancelOrder(state, action.orderId, config);
      }
      break;
    case "APPEND_LOG":
      if (action.message) pushLog(state, action.message, config);
      break;
    case "USE_SEED":
      if (action.seedId != null && action.qty != null) {
        useSeed(state, action.seedId, action.qty, config);
      }
      break;
    case "SELL_CROP_SPOT":
      if (action.commodityId != null && action.qty != null) {
        sellCropSpotFromBackpack(state, action.commodityId, action.qty, config);
      }
      break;
    default:
      break;
  }
  return state;
}
