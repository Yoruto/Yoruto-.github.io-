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
 * 收获单块地并加入背包（金苹果/金草莓等）
 * @param {{ cropId: string, daysLeft: number }} plot
 * @param {ReturnType<import('../state.js').createPlayerState>} pl
 * @param {typeof import('../config.js').GAME_CONFIG} config
 */
export function harvestOnePlot(plot, pl, config, yieldMult = 1) {
  const seeds = config.commodities.filter((c) => c.type === "seed");
  const cropId = plot.cropId;
  const seedComm = seeds.find((s) => s.yieldsCropId === cropId);
  const yMin = seedComm && "yieldMin" in seedComm ? seedComm.yieldMin : 1;
  const yMax = seedComm && "yieldMax" in seedComm ? seedComm.yieldMax : yMin;
  let qty = yMin + Math.floor(Math.random() * (yMax - yMin + 1));
  const mult = pl.landLevel > 0 ? 1.2 : 1;
  qty = Math.max(1, Math.floor(qty * mult * yieldMult));
  pl.backpack[cropId] = (pl.backpack[cropId] ?? 0) + qty;
  if (cropId === "apple" && Math.random() < (pl.landLevel > 0 ? 0.15 : 0.1)) {
    pl.backpack.golden_apple = (pl.backpack.golden_apple ?? 0) + 1;
  }
  if (cropId === "strawberry" && Math.random() < 0.1) {
    pl.backpack.golden_strawberry = (pl.backpack.golden_strawberry ?? 0) + 1;
  }
}

/**
 * @param {import('../state.js').ReturnType<import('../state.js').createInitialGameState>} state
 * @param {typeof import('../config.js').GAME_CONFIG} config
 * @returns {-1|0|-2} 本日生长步进：-1 正常；-2 好天气；-0 停滞
 */
function farmGrowthStep(state, config) {
  const le = state.longEvent;
  if (!le || (le.daysLeft ?? 0) <= 0) return -1;
  if (le.kind === "blizzard") return 0;
  if (le.kind === "good_weather") return -2;
  if (le.kind === "bad_weather") return 0;
  return -1;
}

/**
 * @param {import('../state.js').ReturnType<import('../state.js').createInitialGameState>} state
 * @param {typeof import('../config.js').GAME_CONFIG} config
 * @returns {string}
 */
export function applyFuturesEndOfDay(state, config) {
  const tradable = futuresTradableCommodities(config);
  const keepBars = Math.max(7, Math.floor(config.rules?.chartHistoryBars ?? 120));
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
    if (!state.futuresOpenHistory) state.futuresOpenHistory = {};
    if (!state.futuresOpenHistory[id]) state.futuresOpenHistory[id] = [];
    if (!state.futuresVolumeHistory) state.futuresVolumeHistory = {};
    if (!state.futuresVolumeHistory[id]) state.futuresVolumeHistory[id] = [];
    if (!state.futuresChartGlobalDays) state.futuresChartGlobalDays = {};
    if (!state.futuresChartGlobalDays[id]) state.futuresChartGlobalDays[id] = [];
    const fo = state.futuresOpenHistory[id];
    const fv = state.futuresVolumeHistory[id];
    const fg = state.futuresChartGlobalDays[id];
    fo.push(closeToday);
    fq.push(next);
    fv.push(totalVol);
    fg.push(state.globalDay);
    if (fo.length > keepBars) fo.shift();
    if (fq.length > keepBars) fq.shift();
    if (fv.length > keepBars) fv.shift();
    if (fg.length > keepBars) fg.shift();
    if (!state.spotPriceHistory) state.spotPriceHistory = {};
    if (!state.spotPriceHistory[id]) state.spotPriceHistory[id] = [];
    const sq = state.spotPriceHistory[id];
    sq.push(state.spotPrices[id] ?? next);
    if (sq.length > keepBars) sq.shift();
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
 * 长事件：每日结束时减天数
 * @param {import('../state.js').ReturnType<import('../state.js').createInitialGameState>} state
 */
export function tickLongEvent(state) {
  const le = state.longEvent;
  if (!le || le.daysLeft == null) return;
  le.daysLeft -= 1;
  if (le.daysLeft <= 0) {
    state.longEvent = null;
  }
}

/**
 * 新周开始（周滚动后 day=1）时尝试触发长事件；与《游戏设计》优先于日事件
 * @param {import('../state.js').ReturnType<import('../state.js').createInitialGameState>} state
 * @param {typeof import('../config.js').GAME_CONFIG} config
 */
export function tryRollLongEventOnNewWeek(state, config) {
  if (state.globalWeek < 4) return;
  if (state.longEvent && (state.longEvent.daysLeft ?? 0) > 0) return;
  let p = state.longEventChance ?? 0.25;
  if (Math.random() < p) {
    const roll = Math.random();
    let kind = "good_weather";
    let daysLeft = 5 + Math.floor(Math.random() * 6);
    if (roll < 0.3) {
      const sub = Math.random();
      if (sub < 0.5) {
        kind = "good_weather";
        daysLeft = 5 + Math.floor(Math.random() * 6);
      } else {
        kind = "fee_down";
        daysLeft = 5 + Math.floor(Math.random() * 6);
        state.feePermanentDelta = (state.feePermanentDelta ?? 0) - 0.001;
      }
    } else if (roll < 0.6) {
      const sub = Math.random();
      if (sub < 0.3) {
        kind = "bad_weather";
        daysLeft = 5 + Math.floor(Math.random() * 6);
      } else if (sub < 0.8) {
        kind = "fee_up";
        daysLeft = 5 + Math.floor(Math.random() * 6);
        state.feePermanentDelta = (state.feePermanentDelta ?? 0) + 0.001;
      } else {
        kind = "blizzard";
        daysLeft = 2 + Math.floor(Math.random() * 4);
      }
    } else {
      kind = Math.random() < 0.5 ? "broad_rise" : "broad_fall";
      daysLeft = 2 + Math.floor(Math.random() * 6);
    }
    state.longEvent = { kind, daysLeft, payload: {} };
    state.longEventChance = 0.25;
    pushLogLine(state, `🌤️ 长事件开始: ${kind}（${daysLeft} 天），本日不触发普通日事件`, config);
  } else {
    state.longEventChance = Math.min(1, p + 0.25);
  }
}

/**
 * 种植地块推进与收获
 * @param {import('../state.js').ReturnType<import('../state.js').createInitialGameState>} state
 * @param {typeof import('../config.js').GAME_CONFIG} config
 */
export function progressFarmPlots(state, config) {
  const step = farmGrowthStep(state, config);
  for (const pid of Object.keys(state.players)) {
    const pl = state.players[pid];
    const plots = pl.farmPlots;
    if (!plots?.length) continue;
    const remain = [];
    for (const plot of plots) {
      if (step === 0) {
        remain.push(plot);
        continue;
      }
      plot.daysLeft += step;
      if (plot.daysLeft > 0) {
        remain.push(plot);
        continue;
      }
      const ymult =
        state.longEvent?.kind === "bad_weather" && (state.longEvent.daysLeft ?? 0) > 0 ? 0.7 : 1;
      harvestOnePlot(plot, pl, config, ymult);
    }
    pl.farmPlots = remain;
  }
}

/**
 * 日事件（第一周后）；长事件存续期间不抽日事件
 * @param {import('../state.js').ReturnType<import('../state.js').createInitialGameState>} state
 * @param {typeof import('../config.js').GAME_CONFIG} config
 */
export function rollDailyEvents(state, config) {
  if (state.globalWeek < 1) return;
  if (state.globalDay <= 7) return;
  if (state.longEvent && (state.longEvent.daysLeft ?? 0) > 0) return;

  let p = state.dailyEventChance;
  if (Math.random() >= p) {
    state.dailyEventChance = Math.min(0.8, p + 0.1);
    return;
  }
  state.dailyEventChance = 0.2;

  const crops = cropCommodities(config);
  const pickRandomCrop = () => crops[Math.floor(Math.random() * crops.length)];
  const r = Math.random();
  if (r < 0.3) {
    const sub = Math.random();
    if (sub < 0.5) {
      const s = config.commodities.find((c) => c.type === "seed");
      if (s) {
        const pl = state.players[state.activePlayerId || "p1"];
        if (pl) pl.backpack[s.id] = (pl.backpack[s.id] ?? 0) + 1;
        pushLogLine(state, "📦 社区赠送：种子 +1", config);
      }
    } else {
      const pick = pickRandomCrop();
      if (pick) {
        const pl = state.players[state.activePlayerId || "p1"];
        if (pl) pl.backpack[pick.id] = (pl.backpack[pick.id] ?? 0) + 3;
        pushLogLine(state, `🌾 大丰收：${pick.name} +3`, config);
      }
    }
  } else if (r < 0.6) {
    const sub = Math.random();
    if (sub < 0.5) {
      const pick = pickRandomCrop();
      if (pick) {
        state.eventFactorByCrop[pick.id] = -0.03;
        pushLogLine(state, `🐛 生长不良：${pick.name} 市场承压`, config);
      }
    } else if (sub < 0.75) {
      const pl = state.players[state.activePlayerId || "p1"];
      if (pl) {
        const cropIds = crops.map((c) => c.id);
        for (const id of cropIds) {
          const w = pl.warehouse?.[id] ?? 0;
          if (w > 0) {
            const steal = Math.min(w, Math.max(1, Math.floor(w * 0.1)));
            pl.warehouse[id] = w - steal;
            pushLogLine(state, `🥷 仓库失窃：${id} -${steal}`, config);
            break;
          }
        }
      }
    } else {
      const pick = pickRandomCrop();
      if (pick) {
        state.eventFactorByCrop[pick.id] = -0.05;
        pushLogLine(state, `💀 颗粒无收预期：${pick.name}`, config);
      }
    }
  } else {
    const sub = Math.random();
    if (sub < 0.3) {
      pushLogLine(state, "🏪 商店传闻：今日可留意金化肥/松露（占位）", config);
    } else if (sub < 0.8) {
      const pick = pickRandomCrop();
      if (pick) {
        const f = (Math.random() * 0.1 - 0.05) * 1.5;
        state.eventFactorByCrop[pick.id] = Math.max(-0.05, Math.min(0.05, f));
        pushLogLine(state, `📈📉 单品种波动：${pick.name}`, config);
      }
    } else {
      const pick = pickRandomCrop();
      if (pick) {
        state.eventFactorByCrop[pick.id] = Math.random() < 0.5 ? 0.1 : -0.1;
        pushLogLine(state, `🎯 涨跌停传闻：${pick.name}`, config);
      }
    }
  }

  const pick = pickRandomCrop();
  if (pick && state.eventFactorByCrop[pick.id] == null) {
    const f = Math.random() * 0.1 - 0.05;
    state.eventFactorByCrop[pick.id] = Math.max(-0.05, Math.min(0.05, f));
  }
}
