import { futuresTradableCommodities, GAME_CONFIG } from "../config.js";
import { futuresFeeAmount } from "./fees.js";
import {
  applyFuturesEndOfDay,
  chargeWeeklyInterestIfNeeded,
  progressFarmPlots,
  rollDailyEvents,
} from "./marketDay.js";
import { computeNextPriceFromDailyStats } from "./pricing.js";
import { applySpotPriceFromPoolChange, merchantDailyBuyCap, shopBuyPrice, shopSellPrice } from "./spotMarket.js";
import {
  buildEmptyDailyStats,
  buildInitialSpotPool,
  buildMultiplayerBotIds,
  buildSoloAiPlayerIds,
  createDefaultNpcs,
  createPlayerState,
  DEFAULT_PLAYER_ID,
  getActivePlayer,
  totalMarginLockedForPlayer,
} from "../state.js";

/**
 * @param {ReturnType<import('./state.js').createInitialGameState>} state
 * @param {string} playerId
 * @param {typeof GAME_CONFIG} config
 */
export function computeEquityForPlayer(state, playerId, config = GAME_CONFIG) {
  const player = state.players[playerId];
  if (!player) return 0;
  let floating = 0;
  for (const comm of futuresTradableCommodities(config)) {
    const id = comm.id;
    const currPrice = state.prices[id];
    const pos = player.positions[id];
    if (!pos) continue;
    if (pos.long.qty > 0) {
      floating += (currPrice - pos.long.avgPrice) * pos.long.qty;
    }
    if (pos.short.qty > 0) {
      floating += (pos.short.avgPrice - currPrice) * pos.short.qty;
    }
  }
  return player.cash + totalMarginLockedForPlayer(player, config.commodities) + floating;
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
 * 日终：设计文档期货调价 + 清空当日统计
 * @param {ReturnType<import('./state.js').createInitialGameState>} state
 * @param {typeof GAME_CONFIG} config
 */
function applyEndOfDayPricing(state, config) {
  const summary = applyFuturesEndOfDay(state, config);
  pushLog(state, `📊 收盘期货: ${summary}`, config);
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
      if (!comm || comm.type !== "crop") {
        pushLog(state, `❌ 挂单无效: 种子不参与期货交易，已忽略 ${order.commodityId}`, config);
        player.pendingOrders.splice(i, 1);
        i--;
        continue;
      }
      const name = comm ? comm.name : order.commodityId;
      const marginAdd = config.rules.marginRate * order.price * order.quantity;
      if (player.cash < marginAdd) {
        pushLog(
          state,
          `❌ 挂单无法成交: ${name} 现金不足以支付保证金 (需 ${marginAdd.toFixed(2)})`,
          config
        );
        continue;
      }
      if (order.type === "long") {
        bumpDailyStat(state, order.commodityId, "openLong", order.quantity);
        const old = player.positions[order.commodityId].long;
        const newQty = old.qty + order.quantity;
        const newAvg = (old.qty * old.avgPrice + order.quantity * order.price) / newQty;
        const newMarginLocked = (old.marginLocked ?? 0) + marginAdd;
        player.cash -= marginAdd;
        player.positions[order.commodityId].long = { qty: newQty, avgPrice: newAvg, marginLocked: newMarginLocked };
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
        const newMarginLocked = (old.marginLocked ?? 0) + marginAdd;
        player.cash -= marginAdd;
        player.positions[order.commodityId].short = { qty: newQty, avgPrice: newAvg, marginLocked: newMarginLocked };
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
 * @param {Record<string, number>} settlementPrices 当日收盘期货价
 */
function performDelivery(state, config, settlementPrices) {
  pushLog(state, "🔥🔥🔥 【交割日】按收盘期货价实物交割；缺货按商店价强制补货 🔥🔥🔥", config);

  const cropIds = futuresTradableCommodities(config).map((c) => c.id);

  for (const id of cropIds) {
    const dPrice = settlementPrices[id] ?? state.prices[id];
    const spot = state.spotPrices[id] ?? dPrice;
    const buyPx = shopBuyPrice(spot, config);
    const name = commodityName(config, id);

    const shortPlayers = Object.keys(state.players).filter((pid) => {
      const pl = state.players[pid];
      return pl.positions[id]?.short.qty > 0 && pl.status === "playing";
    });
    shortPlayers.sort(
      (a, b) => state.players[b].positions[id].short.qty - state.players[a].positions[id].short.qty
    );

    for (const pid of shortPlayers) {
      const pl = state.players[pid];
      const shortQty = pl.positions[id].short.qty;
      const poolBefore = state.spotPool[id] ?? 0;
      const backpackAvail = pl.backpack[id] ?? 0;
      let need = shortQty;
      const useBack = Math.min(need, backpackAvail);
      pl.backpack[id] = backpackAvail - useBack;
      need -= useBack;
      const fromPool = Math.min(need, poolBefore);
      state.spotPool[id] = poolBefore - fromPool;
      need -= fromPool;
      const delivered = useBack + fromPool;
      const deficit = shortQty - delivered;
      let payDelivered = dPrice * delivered;
      let payDeficit = 0;
      if (deficit > 0) {
        payDeficit = buyPx * deficit;
      }
      const shortMargin = pl.positions[id].short.marginLocked ?? 0;
      pl.cash += shortMargin - payDelivered - payDeficit;
      pl.positions[id].short = { qty: 0, avgPrice: 0, marginLocked: 0 };
      applySpotPriceFromPoolChange(state, id, poolBefore, state.spotPool[id] ?? 0, config);
      pushLog(
        state,
        `📦 ${name} 空头 ${shortQty}手 结算价 ${dPrice.toFixed(2)}；缺货 ${deficit} 按商店买价 ${buyPx.toFixed(2)} 补`,
        config
      );
      checkBankruptDoc(pl, state, config, pid);
    }

    const longPlayers = Object.keys(state.players).filter((pid) => {
      const pl = state.players[pid];
      return pl.positions[id]?.long.qty > 0 && pl.status === "playing";
    });
    longPlayers.sort(
      (a, b) => state.players[b].positions[id].long.qty - state.players[a].positions[id].long.qty
    );

    for (const pid of longPlayers) {
      const pl = state.players[pid];
      const longQty = pl.positions[id].long.qty;
      const poolBefore = state.spotPool[id] ?? 0;
      const take = Math.min(longQty, poolBefore);
      const longMargin = pl.positions[id].long.marginLocked ?? 0;
      pl.positions[id].long = { qty: 0, avgPrice: 0, marginLocked: 0 };
      if (take === 0) {
        pl.cash += longMargin;
        pushLog(state, `📦 ${name} 多头 ${longQty}手：池无货，保证金退回`, config);
        checkBankruptDoc(pl, state, config, pid);
        continue;
      }
      const cost = dPrice * take;
      pl.cash += longMargin - cost;
      pl.backpack[id] = (pl.backpack[id] ?? 0) + take;
      state.spotPool[id] = poolBefore - take;
      applySpotPriceFromPoolChange(state, id, poolBefore, state.spotPool[id] ?? 0, config);
      if (pl.cash < 0) {
        forceSellCropsAtShopSell(pl, state, config);
      }
      pushLog(state, `📦 ${name} 多头 ${take}手 @ ${dPrice.toFixed(2)} 付 ${cost.toFixed(2)}`, config);
      checkBankruptDoc(pl, state, config, pid);
    }
  }

  for (const pid of Object.keys(state.players)) {
    state.players[pid].pendingOrders = [];
  }

  const p = getActivePlayer(state);
  pushLog(state, `🎉 交割完成。当前现金 ${p.cash.toFixed(2)}`, config);
}

/**
 * @param {ReturnType<import('./state.js').createInitialGameState>['players'][string]} pl
 */
function checkBankruptDoc(pl, state, config, playerId) {
  let inv = 0;
  for (const c of config.commodities.filter((x) => x.type === "crop")) {
    const q = pl.backpack[c.id] ?? 0;
    const sp = state.spotPrices[c.id] ?? 0;
    inv += q * shopBuyPrice(sp, config);
  }
  const nw = pl.cash + inv;
  if (nw < 0) {
    pl.status = "eliminated";
    pushLog(state, `💀 ${playerId} 净资产 ${nw.toFixed(2)} < 0，破产`, config);
  }
}

/**
 * 多头现金不足时按商店卖价强制卖出现货
 */
function forceSellCropsAtShopSell(pl, state, config) {
  const crops = config.commodities.filter((c) => c.type === "crop");
  for (const c of crops) {
    if (pl.cash >= 0) break;
    let q = Math.floor(pl.backpack[c.id] ?? 0);
    const sp = state.spotPrices[c.id] ?? state.prices[c.id];
    const px = shopSellPrice(sp, config);
    while (q > 0 && pl.cash < 0) {
      const poolBefore = state.spotPool[c.id] ?? 0;
      pl.backpack[c.id] = q - 1;
      state.spotPool[c.id] = poolBefore + 1;
      pl.cash += px;
      applySpotPriceFromPoolChange(state, c.id, poolBefore, state.spotPool[c.id] ?? 0, config);
      q--;
    }
  }
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
      const sp = state.spotPrices[cropId] ?? state.prices[cropId];
      const px = shopSellPrice(sp, config);
      const proceeds = px * qty;
      pl.backpack[cropId] = 0;
      const poolBefore = state.spotPool[cropId] ?? 0;
      state.spotPool[cropId] = poolBefore + qty;
      applySpotPriceFromPoolChange(state, cropId, poolBefore, state.spotPool[cropId] ?? 0, config);
      pl.cash += proceeds;
      pushLog(
        state,
        `🏁 终局清盘 ${pid} 卖出 ${commodityName(config, cropId)} ×${qty} @ ${px.toFixed(2)} → +${proceeds.toFixed(2)}`,
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
  state.endReason = "time";
  pushLog(state, `🏁 第 ${state.totalGameDays} 天届满，作物已按商店价强制卖出。`, config);
}

/**
 * @param {ReturnType<import('./state.js').createInitialGameState>} state
 * @param {typeof GAME_CONFIG} config
 */
function syncWeekFields(state, config) {
  const cd = config.economy.cycleDays;
  state.globalWeek = Math.ceil(state.globalDay / cd);
  state.dayInWeek = ((state.globalDay - 1) % cd) + 1;
}

function nextDayInternal(state, config) {
  if (state.gameEnded) return;
  processLoanDue(state, config);
  progressFarmPlots(state, config);
  rollDailyEvents(state, config);
  const totalDays = state.totalGameDays ?? config.economy.totalWeeks * config.economy.cycleDays;
  const cycle = config.economy.cycleDays;

  for (const pid of Object.keys(state.players)) {
    state.players[pid].merchantSpotBoughtToday = {};
  }

  if (state.currentDay === cycle) {
    const settlementPrices = { ...state.prices };
    performDelivery(state, config, settlementPrices);
    applyEndOfDayPricing(state, config);
    if (state.globalDay >= totalDays) {
      forceEndGame(state, config);
      return;
    }
    state.currentDay = 1;
    state.globalDay += 1;
    syncWeekFields(state, config);
    if (state.globalWeek >= 2) {
      chargeWeeklyInterestIfNeeded(state, config);
      pushLog(state, `📌 本周利息 ${config.economy.weeklyInterest} / 人`, config);
    }
    pushLog(state, "🌾 新周第1天。", config);
    return;
  }

  applyEndOfDayPricing(state, config);
  state.currentDay += 1;
  state.globalDay += 1;
  syncWeekFields(state, config);
  if (config.features?.limitOrders) {
    checkOrdersMatch(state, config);
  }
  pushLog(state, `⏩ 进入第 ${state.currentDay} 天 (总第${state.globalDay}天)`, config);
}

/**
 * @param {ReturnType<import('./state.js').createInitialGameState>} state
 * @param {string} playerId
 * @param {string} commodityId
 * @param {'long'|'short'} direction
 * @param {number} qty
 * @param {typeof GAME_CONFIG} config
 * @param {string} [actorLabel] 日志前缀（如 AI 玩家 id）
 * 注：风控（riskMinEquity）仅对 `state.botPlayerIds` 中的 AI 生效，人类玩家不拦截。
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

  const commMeta = config.commodities.find((c) => c.id === commodityId);
  if (!commMeta || commMeta.type !== "crop") {
    pushLog(state, actorLabel ? `[${actorLabel}] ❌ 种子不参与期货交易` : "❌ 种子不参与期货交易", config);
    return;
  }

  const currentPrice = state.prices[commodityId];
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    pushLog(state, actorLabel ? `[${actorLabel}] ❌ 价格无效` : "❌ 价格无效", config);
    return;
  }

  const commMetaFull = config.commodities.find((c) => c.id === commodityId);
  if (commMetaFull?.requiresGemBoard && !player.gemBoardUnlocked) {
    pushLog(state, actorLabel ? `[${actorLabel}] ❌ 需先开通创业板` : "❌ 需先开通创业板", config);
    return;
  }
  if (direction === "short" && commMetaFull && !commMetaFull.requiresGemBoard) {
    const spot = state.spotPool[commodityId] ?? 0;
    const cap = Math.floor(0.2 * spot);
    const cur = player.positions[commodityId].short.qty;
    if (qty + cur > cap) {
      pushLog(state, actorLabel ? `[${actorLabel}] ❌ 超出公共池20%卖空上限` : "❌ 超出公共池20%卖空上限", config);
      return;
    }
  }
  if (direction === "short" && commMetaFull?.requiresGemBoard && player.gemBoardUnlocked) {
    let invVal = 0;
    for (const c of config.commodities.filter((x) => x.type === "crop")) {
      invVal += (player.backpack[c.id] ?? 0) * (state.spotPrices[c.id] ?? 0);
    }
    const cap =
      (player.cash + invVal) * config.rules.shortNotionalCapRatio;
    const notional = currentPrice * qty;
    if (notional > cap + 1e-6) {
      pushLog(state, actorLabel ? `[${actorLabel}] ❌ 超出做空名义上限` : "❌ 超出做空名义上限", config);
      return;
    }
  }

  const marginAdd = config.rules.marginRate * currentPrice * qty;
  const fee = futuresFeeAmount(currentPrice * qty, config, state.feePermanentDelta);
  if (player.cash < marginAdd + fee) {
    pushLog(
      state,
      actorLabel
        ? `[${actorLabel}] ❌ 现金不足，需保证金+手续费 ${(marginAdd + fee).toFixed(2)}`
        : `❌ 现金不足，需保证金+手续费 ${(marginAdd + fee).toFixed(2)}`,
      config
    );
    return;
  }

  const isBot = state.botPlayerIds?.includes(playerId) ?? false;
  if (isBot) {
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
    const tempPlayer = { positions: tempPos };
    const newMarginTotal = totalMarginLockedForPlayer(tempPlayer, config.commodities);
    const newEquity = player.cash - marginAdd - fee + newMarginTotal + newFloating;
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
  }

  const tag = actorLabel ? `[${actorLabel}] ` : "";
  player.cash -= marginAdd + fee;
  if (direction === "long") {
    bumpDailyStat(state, commodityId, "openLong", qty);
    const old = player.positions[commodityId].long;
    const newTotal = old.qty + qty;
    const newAvg = (old.qty * old.avgPrice + qty * currentPrice) / newTotal;
    const newMarginLocked = (old.marginLocked ?? 0) + marginAdd;
    player.positions[commodityId].long = { qty: newTotal, avgPrice: newAvg, marginLocked: newMarginLocked };
    pushLog(
      state,
      `${tag}🎯 市价开多 ${commodityName(config, commodityId)} ${qty}手 @ ${currentPrice.toFixed(2)} 手续费${fee.toFixed(2)}`,
      config
    );
  } else {
    bumpDailyStat(state, commodityId, "openShort", qty);
    const old = player.positions[commodityId].short;
    const newTotal = old.qty + qty;
    const newAvg = (old.qty * old.avgPrice + qty * currentPrice) / newTotal;
    const newMarginLocked = (old.marginLocked ?? 0) + marginAdd;
    player.positions[commodityId].short = { qty: newTotal, avgPrice: newAvg, marginLocked: newMarginLocked };
    pushLog(
      state,
      `${tag}🎯 市价开空 ${commodityName(config, commodityId)} ${qty}手 @ ${currentPrice.toFixed(2)} 手续费${fee.toFixed(2)}`,
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
  const locked = pos.marginLocked ?? 0;
  const released = pos.qty > 0 ? (locked * qty) / pos.qty : 0;
  const remLocked = locked - released;
  const tag = actorLabel ? `[${actorLabel}] ` : "";
  if (direction === "long") {
    bumpDailyStat(state, commodityId, "longClose", qty);
    profit = (currPrice - pos.avgPrice) * qty;
    const newQty = pos.qty - qty;
    if (newQty === 0) {
      player.positions[commodityId].long = { qty: 0, avgPrice: 0, marginLocked: 0 };
    } else {
      player.positions[commodityId].long = { qty: newQty, avgPrice: pos.avgPrice, marginLocked: remLocked };
    }
  } else {
    bumpDailyStat(state, commodityId, "shortClose", qty);
    profit = (pos.avgPrice - currPrice) * qty;
    const newQty = pos.qty - qty;
    if (newQty === 0) {
      player.positions[commodityId].short = { qty: 0, avgPrice: 0, marginLocked: 0 };
    } else {
      player.positions[commodityId].short = { qty: newQty, avgPrice: pos.avgPrice, marginLocked: remLocked };
    }
  }
  const fee = futuresFeeAmount(currPrice * qty, config, state.feePermanentDelta);
  player.cash += released + profit - fee;
  pushLog(
    state,
    `${tag}💸 平仓 ${direction === "long" ? "多单" : "空单"} ${commodityName(config, commodityId)} ${qty}手，盈亏 ${profit >= 0 ? `+${profit.toFixed(2)}` : `${profit.toFixed(2)}`} 手续费${fee.toFixed(2)}`,
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
  const limComm = config.commodities.find((c) => c.id === commodityId);
  if (!limComm || limComm.type !== "crop") {
    pushLog(state, "❌ 种子不参与期货挂单", config);
    return;
  }
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

  const sp = state.spotPrices[cropId] ?? state.prices[cropId];
  const px = shopSellPrice(sp, config);
  const proceeds = px * qty;
  const poolBefore = state.spotPool[cropId] ?? 0;
  player.backpack[cropId] = have - qty;
  state.spotPool[cropId] = poolBefore + qty;
  applySpotPriceFromPoolChange(state, cropId, poolBefore, state.spotPool[cropId] ?? 0, config);
  player.cash += proceeds;
  pushLog(
    state,
    `🏛️ 卖出现货 ${commodityName(config, cropId)} ×${qty} 商店卖价 ${px.toFixed(2)} → +${proceeds.toFixed(2)}`,
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
  if ("requiresGemBoard" in seedComm && seedComm.requiresGemBoard && !player.gemBoardUnlocked) {
    pushLog(state, "❌ 该种子需开通创业板后再种植", config);
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

  const growDays = "growDays" in seedComm ? seedComm.growDays : 2;
  player.backpack[seedId] = have - qty;
  for (let i = 0; i < qty; i++) {
    player.farmPlots.push({ cropId, daysLeft: growDays });
  }
  pushLog(
    state,
    `🌱 种植 ${commodityName(config, seedId)} ×${qty}，约 ${growDays} 天成熟`,
    config
  );
}

/**
 * @param {ReturnType<import('./state.js').createInitialGameState>} state
 * @param {typeof GAME_CONFIG} config
 */
function resetGame(state, config) {
  const labelsBackup = state.playerLabels && typeof state.playerLabels === "object" ? { ...state.playerLabels } : {};
  state.prices = { ...config.initial.futuresPrices };
  state.spotPrices = { ...config.initial.spotPrices };
  state.dailyStats = buildEmptyDailyStats(config.commodities);
  state.currentDay = config.initial.day;
  state.globalDay = config.initial.day;
  state.globalWeek = 1;
  state.dayInWeek = 1;
  state.debt = config.initial.debt;
  state.gameEnded = false;
  state.finalRanking = null;
  state.endReason = null;
  state.nextOrderId = config.initial.nextOrderId;
  state.logEntries = [];
  const pid = state.activePlayerId;
  state.spotPool = buildInitialSpotPool(config);
  state.spotPoolSnapshot = { ...buildInitialSpotPool(config) };
  state.totalGameDays = config.economy.totalWeeks * config.economy.cycleDays;
  state.feePermanentDelta = 0;
  state.dailyEventChance = 0.2;
  state.longEventChance = 0.25;
  state.longEvent = null;
  state.eventFactorByCrop = {};
  state.futuresPriceHistory = {};
  state.volumeHistory5d = {};
  for (const c of futuresTradableCommodities(config)) {
    state.volumeHistory5d[c.id] = [0, 0, 0, 0, 0];
  }
  state.npcs = createDefaultNpcs(config);
  if (state.multiplayerWithBots && state.humanPlayerIds?.length) {
    const humans = state.humanPlayerIds;
    const bots =
      state.botPlayerIds && state.botPlayerIds.length > 0 ? state.botPlayerIds : buildMultiplayerBotIds(humans);
    state.botPlayerIds = bots;
    /** @type {Record<string, ReturnType<createPlayerState>>} */
    const players = {};
    for (const hid of humans) {
      players[hid] = createPlayerState(config);
    }
    for (const bid of bots) {
      players[bid] = createPlayerState(config);
    }
    state.players = players;
  } else if (state.soloWithAI) {
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
  /** @type {Record<string, string>} */
  state.playerLabels = {};
  for (const pkey of Object.keys(state.players)) {
    state.playerLabels[pkey] = labelsBackup[pkey] ?? pkey;
  }
  pushLog(state, "🔄 游戏已重置。初始资金10万，债务200万，52周周期。", config);
}

function unlockGemBoard(state, config) {
  const pl = getActivePlayer(state);
  const cost = config.economy.gemBoardCost;
  if (pl.gemBoardUnlocked) {
    pushLog(state, "已开通创业板", config);
    return;
  }
  if (pl.cash < cost) {
    pushLog(state, `❌ 开通创业板需 ${cost} 现金`, config);
    return;
  }
  pl.cash -= cost;
  pl.gemBoardUnlocked = true;
  pushLog(state, `✅ 已开通创业板（-${cost}）`, config);
}

function upgradeLand(state, config) {
  const pl = getActivePlayer(state);
  const cost = config.economy.landUpgradeCost;
  if (pl.cash < cost) {
    pushLog(state, `❌ 升级土地需 ${cost}`, config);
    return;
  }
  pl.cash -= cost;
  pl.landLevel = (pl.landLevel ?? 0) + 1;
  pushLog(state, `🌾 土地升级至 Lv.${pl.landLevel}（产量+20%，金苹果概率提升）`, config);
}

/**
 * 从商人处买现货（受每日 10% 池上限）
 */
function merchantBuySpot(state, cropId, qty, config) {
  const pl = getActivePlayer(state);
  const crop = config.commodities.find((c) => c.id === cropId && c.type === "crop");
  if (!crop) return;
  qty = Math.floor(qty);
  if (qty <= 0) return;
  const pool = state.spotPool[cropId] ?? 0;
  const cap = merchantDailyBuyCap(pool, config);
  const bought = pl.merchantSpotBoughtToday[cropId] ?? 0;
  if (bought + qty > cap) {
    pushLog(state, `❌ 超过商人今日购买上限（剩余 ${cap - bought}）`, config);
    return;
  }
  const sp = state.spotPrices[cropId] ?? state.prices[cropId];
  const px = shopBuyPrice(sp, config);
  const total = px * qty;
  if (pl.cash < total) {
    pushLog(state, "❌ 现金不足", config);
    return;
  }
  const poolBefore = pool;
  if (pool < qty) {
    pushLog(state, "❌ 商人现货不足", config);
    return;
  }
  pl.cash -= total;
  pl.backpack[cropId] = (pl.backpack[cropId] ?? 0) + qty;
  state.spotPool[cropId] = pool - qty;
  pl.merchantSpotBoughtToday[cropId] = bought + qty;
  applySpotPriceFromPoolChange(state, cropId, poolBefore, state.spotPool[cropId] ?? 0, config);
  pushLog(state, `🏪 商人购现货 ${commodityName(config, cropId)} ×${qty} @ ${px.toFixed(2)}`, config);
}

function takeLoan(state, tier, config) {
  const pl = getActivePlayer(state);
  const gw = state.globalWeek ?? 1;
  const packs =
    tier === "50w"
      ? { principal: 500000, repay: 560000, minWeek: 10 }
      : tier === "100w"
        ? { principal: 1000000, repay: 1100000, minWeek: 25 }
        : { principal: 100000, repay: 115000, minWeek: 0 };
  if (gw < packs.minWeek) {
    pushLog(state, "❌ 该档借贷尚未开放", config);
    return;
  }
  pl.cash += packs.principal;
  pl.loans.push({
    id: `L${state.nextOrderId++}`,
    principal: packs.principal,
    dueGlobalDay: state.globalDay + 7,
    totalRepay: packs.repay,
  });
  pushLog(state, `🏦 借贷到账 ${packs.principal}，${7} 日内需还 ${packs.repay}`, config);
}

function processLoanDue(state, config) {
  for (const pid of Object.keys(state.players)) {
    const pl = state.players[pid];
    if (!pl.loans?.length) continue;
    const kept = [];
    for (const L of pl.loans) {
      if (L.dueGlobalDay > state.globalDay) {
        kept.push(L);
        continue;
      }
      if (pl.cash >= L.totalRepay) {
        pl.cash -= L.totalRepay;
        pushLog(state, `✅ 借贷已还 ${L.totalRepay}`, config);
      } else {
        const owed = L.totalRepay - pl.cash;
        pl.cash = 0;
        pushLog(state, `⚠️ 借贷未还清，尚欠 ${owed.toFixed(2)}（可次日处理）`, config);
        kept.push({ ...L, totalRepay: owed });
      }
    }
    pl.loans = kept;
  }
}

/**
 * @typedef {object} GameAction
 * @property {'RESET'|'NEXT_DAY'|'OPEN_MARKET'|'CLOSE'|'PLACE_LIMIT'|'CANCEL_ORDER'|'APPEND_LOG'|'USE_SEED'|'SELL_CROP_SPOT'|'UNLOCK_GEM_BOARD'|'UPGRADE_LAND'|'MERCHANT_BUY_SPOT'|'TAKE_LOAN'} type
 * @property {string} [commodityId]
 * @property {'long'|'short'} [direction]
 * @property {number} [qty]
 * @property {number} [price]
 * @property {number} [orderId]
 * @property {string} [message]
 * @property {string} [seedId]
 * @property {'10w'|'50w'|'100w'} [tier]
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
    case "UNLOCK_GEM_BOARD":
      unlockGemBoard(state, config);
      break;
    case "UPGRADE_LAND":
      upgradeLand(state, config);
      break;
    case "MERCHANT_BUY_SPOT":
      if (action.commodityId != null && action.qty != null) {
        merchantBuySpot(state, action.commodityId, action.qty, config);
      }
      break;
    case "TAKE_LOAN":
      takeLoan(state, action.tier ?? "10w", config);
      break;
    default:
      break;
  }
  return state;
}
