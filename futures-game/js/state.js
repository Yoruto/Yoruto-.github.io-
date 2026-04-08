import { GAME_CONFIG } from "./config.js";

/** 单机 / 默认操作玩家 id（UI 阶段固定一人） */
export const DEFAULT_PLAYER_ID = "p1";

/** 单机带 AI 时固定 7 名 AI，id 从 p2 起递增并跳过与人类 id 冲突者 */
export function buildSoloAiPlayerIds(humanId) {
  const ids = [];
  let n = 2;
  while (ids.length < 7) {
    const pid = `p${n}`;
    n += 1;
    if (pid === humanId) continue;
    ids.push(pid);
  }
  return ids;
}

/**
 * 多人模式：固定 4 名电脑，id 不与真人冲突。
 * @param {string[]} humanIds
 * @param {number} [count]
 * @returns {string[]}
 */
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

/**
 * @param {string | undefined | null} raw
 * @returns {string | null}
 */
export function normalizePlayerId(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const cut = s.length > PLAYER_ID_MAX_LEN ? s.slice(0, PLAYER_ID_MAX_LEN) : s;
  if (UNSAFE_PLAYER_KEYS.has(cut)) return null;
  return cut;
}

/**
 * @param {typeof GAME_CONFIG.commodities} commodities
 */
export function buildEmptyPositions(commodities) {
  /** @type {Record<string, { long: { qty: number, avgPrice: number, marginLocked: number }, short: { qty: number, avgPrice: number, marginLocked: number } }>} */
  const positions = {};
  for (const c of commodities) {
    positions[c.id] = {
      long: { qty: 0, avgPrice: 0, marginLocked: 0 },
      short: { qty: 0, avgPrice: 0, marginLocked: 0 },
    };
  }
  return positions;
}

/**
 * @param {{ positions: Record<string, { long: { marginLocked?: number }, short: { marginLocked?: number } }> }} player
 * @param {typeof GAME_CONFIG.commodities} commodities
 */
export function totalMarginLockedForPlayer(player, commodities) {
  let sum = 0;
  for (const c of commodities) {
    const p = player.positions[c.id];
    sum += p.long.marginLocked ?? 0;
    sum += p.short.marginLocked ?? 0;
  }
  return sum;
}

/**
 * @param {typeof GAME_CONFIG.commodities} commodities
 * @returns {Record<string, number>}
 */
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

/**
 * @param {typeof GAME_CONFIG} config
 */
export function createPlayerState(config = GAME_CONFIG) {
  return {
    cash: config.initial.cash,
    positions: buildEmptyPositions(config.commodities),
    backpack: buildEmptyBackpack(config.commodities),
    status: /** @type {'playing' | 'failed'} */ ("playing"),
    pendingOrders: /** @type {object[]} */ ([]),
  };
}

/**
 * @param {typeof GAME_CONFIG.commodities} commodities
 * @returns {Record<string, { openLong: number, openShort: number, longClose: number, shortClose: number }>}
 */
export function buildEmptyDailyStats(commodities) {
  /** @type {Record<string, { openLong: number, openShort: number, longClose: number, shortClose: number }>} */
  const dailyStats = {};
  for (const c of commodities) {
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
      players[bid] = createPlayerState(config);
    }
  } else {
    players[id] = createPlayerState(config);
    if (soloWithAI) {
      for (const aid of buildSoloAiPlayerIds(id)) {
        players[aid] = createPlayerState(config);
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

  return {
    prices: { ...config.initial.prices },
    dailyStats: buildEmptyDailyStats(config.commodities),
    currentDay: config.initial.day,
    /** 全局日历天（1 … totalGameDays），不因 7 日轮回重置 */
    globalDay: config.initial.day,
    gameEnded: false,
    /** @type {{ playerId: string, cash: number }[] | null} */
    finalRanking: null,
    nextOrderId: config.initial.nextOrderId,
    logEntries: [],
    activePlayerId: id,
    soloWithAI,
    multiplayerWithBots: multiplayerWithBots && humanPlayerIds.length > 0,
    /** @type {string[]} */
    humanPlayerIds,
    /** @type {string[]} */
    botPlayerIds,
    /** 结算/界面展示用：局内 playerId → 玩家输入或会话中的显示名 */
    playerLabels,
    spotPool: buildInitialSpotPool(config),
    players,
  };
}

/**
 * @param {ReturnType<createInitialGameState>} state
 * @returns {NonNullable<ReturnType<createInitialGameState>['players'][string]>}
 */
export function getActivePlayer(state) {
  const id = state.activePlayerId || DEFAULT_PLAYER_ID;
  const p = state.players[id];
  if (!p) throw new Error(`Missing player ${id}`);
  return p;
}

/**
 * @param {ReturnType<createInitialGameState>} state
 */
export function cloneGameState(state) {
  return {
    prices: { ...state.prices },
    dailyStats: JSON.parse(JSON.stringify(state.dailyStats)),
    currentDay: state.currentDay,
    globalDay: state.globalDay,
    gameEnded: state.gameEnded,
    finalRanking: state.finalRanking ? [...state.finalRanking] : null,
    nextOrderId: state.nextOrderId,
    logEntries: [...state.logEntries],
    activePlayerId: state.activePlayerId,
    soloWithAI: !!state.soloWithAI,
    multiplayerWithBots: !!state.multiplayerWithBots,
    humanPlayerIds: state.humanPlayerIds ? [...state.humanPlayerIds] : [],
    botPlayerIds: state.botPlayerIds ? [...state.botPlayerIds] : [],
    playerLabels: state.playerLabels ? { ...state.playerLabels } : {},
    spotPool: { ...state.spotPool },
    players: JSON.parse(JSON.stringify(state.players)),
  };
}
