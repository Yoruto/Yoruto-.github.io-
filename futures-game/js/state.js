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
  /** @type {Record<string, { long: { qty: number, avgPrice: number }, short: { qty: number, avgPrice: number } }>} */
  const positions = {};
  for (const c of commodities) {
    positions[c.id] = {
      long: { qty: 0, avgPrice: 0 },
      short: { qty: 0, avgPrice: 0 },
    };
  }
  return positions;
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
 * @param {{ playerId?: string, soloWithAI?: boolean }} [options]
 */
export function createInitialGameState(config = GAME_CONFIG, options = {}) {
  const id = normalizePlayerId(options.playerId) ?? DEFAULT_PLAYER_ID;
  const soloWithAI = !!options.soloWithAI;
  /** @type {Record<string, ReturnType<createPlayerState>>} */
  const players = {
    [id]: createPlayerState(config),
  };
  if (soloWithAI) {
    for (const aid of buildSoloAiPlayerIds(id)) {
      players[aid] = createPlayerState(config);
    }
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
    spotPool: { ...state.spotPool },
    players: JSON.parse(JSON.stringify(state.players)),
  };
}
