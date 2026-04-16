/**
 * 日终期货调价、日历相关辅助（交割仍在 gameReducer 内逐步对齐文档）
 */
import { futuresTradableCommodities, cropCommodities } from "../config.js";
import { buildEmptyDailyStats } from "../state.js";
import {
  computeNextFuturesPriceDesign,
  computeNetDemandFactorFromVolumes,
} from "./pricing.js";

/**
 * @param {import('../state.js').ReturnType<import('../state.js').createInitialGameState>} state
 * @param {typeof import('../config.js').GAME_CONFIG} config
 * @returns {string}
 */
export function applyFuturesEndOfDay(state, config) {
  const tradable = futuresTradableCommodities(config);
  const parts = [];
  for (const c of tradable) {
    const id = c.id;
    const stats = state.dailyStats[id];
    if (!stats) continue;
    const buyVol = stats.openLong + stats.shortClose;
    const sellVol = stats.openShort + stats.longClose;
    const totalVol = stats.openLong + stats.openShort + stats.longClose + stats.shortClose;
    const hist = state.volumeHistory5d[id];
    const avg5 = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : 0;
    const netF = computeNetDemandFactorFromVolumes(buyVol, sellVol, avg5, config);
    const ev = state.eventFactorByCrop[id] ?? 0;
    const spotRef = state.spotPrices[id] ?? state.prices[id];
    const closeToday = state.prices[id];
    const next = computeNextFuturesPriceDesign(closeToday, spotRef, ev, netF, config);
    state.prices[id] = next;
    hist.shift();
    hist.push(totalVol);
    if (!state.futuresPriceHistory[id]) state.futuresPriceHistory[id] = [];
    const fq = state.futuresPriceHistory[id];
    fq.push(next);
    if (fq.length > 7) fq.shift();
    parts.push(`${c.name} ${next.toFixed(2)}`);
  }
  state.dailyStats = buildEmptyDailyStats(config.commodities);
  state.eventFactorByCrop = {};
  return parts.join("；");
}

/**
 * 每周第 1 天扣周利息（首周第 1 天不扣）
 * @param {import('../state.js').ReturnType<import('../state.js').createInitialGameState>} state
 * @param {typeof import('../config.js').GAME_CONFIG} config
 */
export function chargeWeeklyInterestIfNeeded(state, config) {
  if (state.currentDay !== 1 || state.globalWeek <= 1) return;
  const w = config.economy.weeklyInterest;
  for (const pid of Object.keys(state.players)) {
    const pl = state.players[pid];
    if (pl.status !== "playing") continue;
    pl.cash -= w;
  }
}

/**
 * @param {import('../state.js').ReturnType<import('../state.js').createInitialGameState>} state
 * @param {string} msg
 * @param {typeof import('../config.js').GAME_CONFIG} config
 */
export function pushLogLine(state, msg, config) {
  const line = `[W${state.globalWeek} D${state.currentDay}] ${msg}`;
  const next = [line, ...state.logEntries];
  if (next.length > config.rules.maxLogEntries) next.length = config.rules.maxLogEntries;
  state.logEntries = next;
}

/**
 * 种植地块推进与收获
 * @param {import('../state.js').ReturnType<import('../state.js').createInitialGameState>} state
 * @param {typeof import('../config.js').GAME_CONFIG} config
 */
export function progressFarmPlots(state, config) {
  const seeds = config.commodities.filter((c) => c.type === "seed");
  for (const pid of Object.keys(state.players)) {
    const pl = state.players[pid];
    const plots = pl.farmPlots;
    if (!plots?.length) continue;
    const remain = [];
    for (const plot of plots) {
      plot.daysLeft -= 1;
      if (plot.daysLeft > 0) {
        remain.push(plot);
        continue;
      }
      const cropId = plot.cropId;
      const seedComm = seeds.find((s) => s.yieldsCropId === cropId);
      const yMin = seedComm && "yieldMin" in seedComm ? seedComm.yieldMin : 1;
      const yMax = seedComm && "yieldMax" in seedComm ? seedComm.yieldMax : yMin;
      let qty = yMin + Math.floor(Math.random() * (yMax - yMin + 1));
      const mult = pl.landLevel > 0 ? 1.2 : 1;
      qty = Math.max(1, Math.floor(qty * mult));
      pl.backpack[cropId] = (pl.backpack[cropId] ?? 0) + qty;
      if (cropId === "apple" && Math.random() < (pl.landLevel > 0 ? 0.15 : 0.1)) {
        pl.backpack.golden_apple = (pl.backpack.golden_apple ?? 0) + 1;
      }
      if (cropId === "strawberry" && Math.random() < 0.1) {
        pl.backpack.golden_strawberry = (pl.backpack.golden_strawberry ?? 0) + 1;
      }
    }
    pl.farmPlots = remain;
  }
}

/**
 * 简化日事件（第一周后）
 * @param {import('../state.js').ReturnType<import('../state.js').createInitialGameState>} state
 * @param {typeof import('../config.js').GAME_CONFIG} config
 */
export function rollDailyEvents(state, config) {
  if (state.globalWeek < 1) return;
  if (state.globalDay <= 7) return;
  let p = state.dailyEventChance;
  if (Math.random() < p) {
    const crops = cropCommodities(config);
    const pick = crops[Math.floor(Math.random() * crops.length)];
    if (pick) {
      const f = Math.random() * 0.1 - 0.05;
      state.eventFactorByCrop[pick.id] = Math.max(-0.05, Math.min(0.05, f));
    }
    state.dailyEventChance = 0.2;
  } else {
    state.dailyEventChance = Math.min(0.8, p + 0.1);
  }
}
