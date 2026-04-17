import { GAME_CONFIG, futuresTradableCommodities } from "./config.js";

/** 单机 / 默认操作玩家 id（UI 阶段固定一人） */
export const DEFAULT_PLAYER_ID = "p1";

/** 单人 + 9 名 NPC 式 AI 对手 id */
export function buildSoloAiPlayerIds(humanId) {
  const ids = [];
  let n = 2;
  while (ids.length < 9) {
    const pid = `p${n}`;
    n += 1;
    if (pid === humanId) continue;
    ids.push(pid);
  }
  return ids;
}

export function buildMultiplayerBotIds(humanIds, count = 4) {
  const used = new Set(humanIds);
  const out = [];
  let n = 0;
  while (out.length < count) {
    const id = `mp_bot_${n}`;
    n += 1;
    if (used.has(id)) continue;
    used.add(id);
    out.push(id);
  }
  return out;
}

const PLAYER_ID_MAX_LEN = 32;
const UNSAFE_PLAYER_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function normalizePlayerId(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const cut = s.length > PLAYER_ID_MAX_LEN ? s.slice(0, PLAYER_ID_MAX_LEN) : s;
  if (UNSAFE_PLAYER_KEYS.has(cut)) return null;
  return cut;
}

/**
 * 仅期货可交易品种建持仓槽位
 * @param {typeof GAME_CONFIG.commodities} commodities
 */
export function buildEmptyPositions(commodities) {
  const tradable = futuresTradableCommodities({ commodities });
  /** @type {Record<string, { long: { qty: number, avgPrice: number, marginLocked: number }, short: { qty: number, avgPrice: number, marginLocked: number } }>} */
  const positions = {};
  for (const c of tradable) {
    positions[c.id] = {
      long: { qty: 0, avgPrice: 0, marginLocked: 0 },
      short: { qty: 0, avgPrice: 0, marginLocked: 0 },
    };
  }
  return positions;
}

export function totalMarginLockedForPlayer(player, commodities) {
  const tradable = futuresTradableCommodities({ commodities });
  let sum = 0;
  for (const c of tradable) {
    const p = player.positions[c.id];
    if (!p) continue;
    sum += p.long.marginLocked ?? 0;
    sum += p.short.marginLocked ?? 0;
  }
  return sum;
}

export function buildEmptyBackpack(commodities) {
  /** @type {Record<string, number>} */
  const backpack = {};
  for (const c of commodities) {
    backpack[c.id] = 0;
  }
  return backpack;
}

/**
 * @param {typeof GAME_CONFIG} config
 * @returns {Record<string, number>}
 */
export function buildInitialSpotPool(config = GAME_CONFIG) {
  /** @type {Record<string, number>} */
  const spotPool = {};
  for (const c of config.commodities) {
    if (c.type === "crop" && "initialSpot" in c && typeof c.initialSpot === "number") {
      spotPool[c.id] = Math.max(0, Math.floor(c.initialSpot));
    }
  }
  return spotPool;
}

/** 单机模式对手 AI 初始资金（人类仍为 config.initial.cash） */
export const SOLO_AI_INITIAL_CASH = 500000;

/**
 * @param {typeof GAME_CONFIG} config
 * @param {{ gemBoardUnlocked?: boolean, initialCash?: number }} [options] AI/电脑对手可默认 true，与《游戏设计》NPC 策略一致
 */
export function createPlayerState(config = GAME_CONFIG, options = {}) {
  const backpack = buildEmptyBackpack(config.commodities);
  const seed0 = config.initial.backpack;
  if (seed0 && typeof seed0 === "object") {
    for (const [k, v] of Object.entries(seed0)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0 && k in backpack) {
        backpack[k] = Math.floor(v);
      }
    }
  }
  const cash0 = options.initialCash != null && Number.isFinite(options.initialCash) ? options.initialCash : config.initial.cash;
  return {
    cash: cash0,
    positions: buildEmptyPositions(config.commodities),
    backpack,
    status: /** @type {'playing' | 'failed' | 'eliminated'} */ ("playing"),
    soloAiBailoutUsed: false,
    pendingOrders: /** @type {object[]} */ ([]),
    landLevel: 0,
    gemBoardUnlocked: options.gemBoardUnlocked ?? false,
    /** 纯存储，与背包可同步扩展 */
    warehouse: /** @type {Record<string, number>} */ ({}),
    /** 种植地块 */
    farmPlots: /** @type {{ cropId: string, daysLeft: number, fertilizedNormal?: boolean }[]} */ ([]),
    /** 当日已从商人处买现货数量（按作物） */
    merchantSpotBoughtToday: /** @type {Record<string, number>} */ ({}),
    /** 借贷：{ principal, dueGlobalDay, totalRepay } */
    loans: /** @type {{ id: string, principal: number, dueGlobalDay: number, totalRepay: number }[]> */ ([]),
  };
}

export function buildEmptyDailyStats(commodities) {
  const tradable = futuresTradableCommodities({ commodities });
  /** @type {Record<string, { openLong: number, openShort: number, longClose: number, shortClose: number }>} */
  const dailyStats = {};
  for (const c of tradable) {
    dailyStats[c.id] = {
      openLong: 0,
      openShort: 0,
      longClose: 0,
      shortClose: 0,
    };
  }
  return dailyStats;
}

/**
 * @param {typeof GAME_CONFIG} config
 */
function buildEmptyVolumeHistory(config) {
  const tradable = futuresTradableCommodities(config);
  /** @type {Record<string, number[]>} */
  const history = {};
  for (const c of tradable) {
    history[c.id] = [0, 0, 0, 0, 0];
  }
  return history;
}

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   archetype: 'random'|'trend'|'value'|'spot',
 *   cash: number,
 *   stock: Record<string, number>,
 *   gemBoardUnlocked: boolean,
 *   positions: ReturnType<buildEmptyPositions>,
 * }} NpcState
 */

export function createDefaultNpcs(config) {
  /** @type {NpcState[]} */
  const npcs = [];
  const archetypes = /** @type {NpcState['archetype'][]} */ (["random", "random", "trend", "trend", "value", "value", "spot", "spot", "random"]);
  const names = ["阿农", "巴奇", "凯西", "蒂姆", "伊芙", "弗兰", "盖尔", "赫达", "艾克"];
  const crops = config.commodities.filter((c) => c.type === "crop");
  for (let i = 0; i < 9; i++) {
    /** @type {Record<string, number>} */
    const stock = {};
    for (const c of crops) {
      stock[c.id] = 10 + ((i * 37 + c.id.length * 13) % 41);
    }
    npcs.push({
      id: `npc_${i + 1}`,
      name: names[i] ?? `NPC${i + 1}`,
      archetype: archetypes[i] ?? "random",
      cash: 100000,
      stock,
      gemBoardUnlocked: true,
      positions: buildEmptyPositions(config.commodities),
    });
  }
  return npcs;
}

/**
 * @param {typeof GAME_CONFIG} [config]
 * @param {{
 *   playerId?: string,
 *   soloWithAI?: boolean,
 *   multiplayerWithBots?: boolean,
 *   humanPlayerIds?: string[],
 *   playerLabels?: Record<string, string>,
 * }} [options]
 */
export function createInitialGameState(config = GAME_CONFIG, options = {}) {
  const id = normalizePlayerId(options.playerId) ?? DEFAULT_PLAYER_ID;
  const soloWithAI = !!options.soloWithAI;
  const multiplayerWithBots = !!options.multiplayerWithBots;
  const rawHumans = options.humanPlayerIds;
  /** @type {string[]} */
  let humanPlayerIds = [];
  if (multiplayerWithBots && Array.isArray(rawHumans) && rawHumans.length > 0) {
    humanPlayerIds = rawHumans.map((x) => normalizePlayerId(x) ?? String(x)).filter(Boolean);
  }
  /** @type {string[]} */
  let botPlayerIds = [];
  /** @type {Record<string, ReturnType<createPlayerState>>} */
  const players = {};

  if (multiplayerWithBots && humanPlayerIds.length > 0) {
    for (const hid of humanPlayerIds) {
      players[hid] = createPlayerState(config);
    }
    botPlayerIds = buildMultiplayerBotIds(humanPlayerIds);
    for (const bid of botPlayerIds) {
      players[bid] = createPlayerState(config, { gemBoardUnlocked: true });
    }
  } else {
    players[id] = createPlayerState(config);
    if (soloWithAI) {
      for (const aid of buildSoloAiPlayerIds(id)) {
        players[aid] = createPlayerState(config, { gemBoardUnlocked: true, initialCash: SOLO_AI_INITIAL_CASH });
      }
    }
    humanPlayerIds = [];
    botPlayerIds = [];
  }

  /** @type {Record<string, string>} */
  const playerLabels = {};
  const fromOpt = options.playerLabels && typeof options.playerLabels === "object" ? options.playerLabels : {};
  for (const pid of Object.keys(players)) {
    const lab = fromOpt[pid];
    playerLabels[pid] = lab != null && String(lab).trim() !== "" ? String(lab).trim() : pid;
  }

  const totalDays = config.economy.totalWeeks * config.economy.cycleDays;

  /** @type {Record<string, number>} */
  const spotPrices = { ...config.initial.spotPrices };
  /** @type {Record<string, number>} */
  const futuresPrices = { ...config.initial.futuresPrices };

  return {
    prices: { ...futuresPrices },
    spotPrices,
    dailyStats: buildEmptyDailyStats(config.commodities),
    currentDay: config.initial.day,
    globalDay: config.initial.day,
    globalWeek: 1,
    dayInWeek: 1,
    debt: config.initial.debt,
    gameEnded: false,
    /** @type {{ playerId: string, cash: number }[] | null} */
    finalRanking: null,
    endReason: /** @type {'debt'|'time'|'elimination'|null} */ (null),
    nextOrderId: config.initial.nextOrderId,
    logEntries: [],
    activePlayerId: id,
    soloWithAI,
    multiplayerWithBots: multiplayerWithBots && humanPlayerIds.length > 0,
    humanPlayerIds,
    botPlayerIds,
    playerLabels,
    spotPool: buildInitialSpotPool(config),
    players,
    /** 全局 NPC（9 人） */
    npcs: createDefaultNpcs(config),
    /** 永久手续费修正（累加） */
    feePermanentDelta: 0,
    /** 日事件概率累加（0~1） */
    dailyEventChance: 0.2,
    /** 长事件概率累加 */
    longEventChance: 0.25,
    /** 长事件状态 */
    longEvent: /** @type {null | { kind: string, daysLeft: number, payload?: object }} */ (null),
    /** 当日各作物事件因子（-0.05~0.05） */
    eventFactorByCrop: /** @type {Record<string, number>} */ ({}),
    /** 5 日滚动成交量（每作物 5 槽） */
    volumeHistory5d: buildEmptyVolumeHistory(config),
    /** 期货价历史（最近 N 日收盘，每作物；N 由 rules.chartHistoryBars 控制） */
    futuresPriceHistory: /** @type {Record<string, number[]>} */ ({}),
    /** 与 futuresPriceHistory 同序：当日开盘（日终调价前价） */
    futuresOpenHistory: /** @type {Record<string, number[]>} */ ({}),
    /** 与 futuresPriceHistory 同序：当日合约成交量合计 */
    futuresVolumeHistory: /** @type {Record<string, number[]>} */ ({}),
    /** 与 futuresPriceHistory 同序：对应 globalDay（用于 K 线时间轴） */
    futuresChartGlobalDays: /** @type {Record<string, number[]>} */ ({}),
    /** 现货价历史（最近 N 日，每作物，UI 走势） */
    spotPriceHistory: /** @type {Record<string, number[]>} */ ({}),
    /** 上一日现货池快照（用于计算因子） */
    spotPoolSnapshot: { ...buildInitialSpotPool(config) },
    totalGameDays: totalDays,
    /** NPC 打听消息最近一条（展示用） */
    lastGossip: /** @type {string | null} */ (null),
    /** 世界 NPC 当日期货意向文案（打听消息） */
    worldNpcGossipById: /** @type {Record<string, string>} */ ({}),
    /** 世界 NPC 当日待执行期货步骤（见 ai/worldNpcFutures.js） */
    worldNpcIntents: /** @type {null | object[]} */ (null),
  };
}

export function getActivePlayer(state) {
  const pid = state.activePlayerId || DEFAULT_PLAYER_ID;
  const p = state.players[pid];
  if (!p) throw new Error(`Missing player ${pid}`);
  return p;
}

export function cloneGameState(state) {
  return JSON.parse(JSON.stringify(state));
}
