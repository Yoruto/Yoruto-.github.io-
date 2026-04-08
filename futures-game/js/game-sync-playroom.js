/**
 * Playroom 多人同步：全局 setState 存共享 JSON；非房主通过 RPC 提交 intent。
 */

const SHARED_KEY = "sharedGamePayload";
const RPC_NAME = "futuresGameIntent";

/** @type {null | Parameters<typeof setPlayroomSyncContext>[0]} */
let rpcCtx = null;

/**
 * @param {{
 *   getGameState: () => import('./state.js').GameState,
 *   setGameState: (s: import('./state.js').GameState) => void,
 *   getTransport: () => import('./room.js').RoomTransport | null,
 *   getConfig: () => import('./config.js').GAME_CONFIG,
 *   reduce: (s: import('./state.js').GameState, a: import('./logic.js').GameAction) => void,
 *   cloneGameState: typeof import('./state.js').cloneGameState,
 *   renderGame: () => void | Promise<void>,
 * }} ctx
 */
export function setPlayroomSyncContext(ctx) {
  rpcCtx = ctx;
}

function pr() {
  const P = globalThis.Playroom;
  if (!P) throw new Error("Playroom Kit 未加载");
  return P;
}

/**
 * @param {string} _roomId
 * @param {ReturnType<import('./state.js').cloneGameState>} stateObj
 */
export async function writeSharedGameState(_roomId, stateObj) {
  pr().setState(SHARED_KEY, JSON.stringify(stateObj), true);
}

/**
 * @param {(state: object) => void} callback
 * @returns {() => void}
 */
export function subscribeSharedGameState(_roomId, callback) {
  let last = /** @type {string | null} */ (null);
  const tick = () => {
    const raw = pr().getState(SHARED_KEY);
    if (typeof raw !== "string" || raw === last) return;
    last = raw;
    try {
      const state = JSON.parse(raw);
      callback(state, 0);
    } catch (e) {
      console.error("subscribeSharedGameState parse error", e);
    }
  };
  tick();
  const id = setInterval(tick, 120);
  return () => clearInterval(id);
}

/**
 * @param {string} _roomId
 * @param {string} playerId
 * @param {import('./logic.js').GameAction} action
 */
export async function addGameIntent(_roomId, playerId, action) {
  await pr().RPC.call(RPC_NAME, { playerId, action }, pr().RPC.Mode.HOST);
}

/**
 * 在页面加载后、insertCoin 之前调用一次（宿主处理 intent）。
 * @returns {() => void}
 */
export function registerHostIntentRpc() {
  const P = pr();
  return P.RPC.register(RPC_NAME, async (payload) => {
    if (!rpcCtx) return;
    const data = payload && typeof payload === "object" ? payload : {};
    const playerId = data.playerId;
    const action = data.action;
    if (!playerId || !action) return;

    const transport = rpcCtx.getTransport();
    if (!transport || typeof transport.isHost !== "function" || !transport.isHost()) {
      return;
    }

    const gameState = rpcCtx.getGameState();
    const localId = transport.getLocalPlayerId?.() ?? null;
    const prev = gameState.activePlayerId;
    gameState.activePlayerId = playerId;
    try {
      rpcCtx.reduce(gameState, action);
    } finally {
      if (localId) gameState.activePlayerId = localId;
    }
    await writeSharedGameState("", rpcCtx.cloneGameState(gameState));
    void rpcCtx.renderGame();
  });
}

export async function deleteIntentDoc() {
  /* RPC 无需删除文档 */
}

/**
 * Firestore 版在主机侧订阅 intents；Playroom 使用全局 RPC，此处返回空清理函数。
 * @returns {() => void}
 */
export function subscribeIntents(_roomId, _onAdded) {
  void _roomId;
  void _onAdded;
  return () => {};
}
