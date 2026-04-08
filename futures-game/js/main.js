import { GAME_CONFIG } from "./config.js";
import { createInitialGameState, cloneGameState } from "./state.js";
import { reduce } from "./logic.js";
import { createLocalRoomTransport } from "./room.js";
import { createPlayroomRoomTransport } from "./room-playroom.js";
import { mountApp } from "./ui.js";
import { useLocalRoom } from "./room-mode.js";
import { PLAYROOM_CONFIG } from "./playroom-config.js";
import * as playroomSync from "./game-sync-playroom.js";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app");

let gameState = createInitialGameState();

/** @type {ReturnType<createLocalRoomTransport> | ReturnType<createPlayroomRoomTransport> | null} */
let transport = null;

function isPlayroomTransport() {
  return transport != null && typeof transport.startLobby === "function";
}

/** @type {(() => void) | null} */
let unsubSharedGame = null;
/** @type {(() => void) | null} */
let unsubIntents = null;
/** @type {(() => void) | null} */
let unsubHostRpc = null;

const appRender = {
  /** @type {() => void | Promise<void>} */
  renderGame: () => {},
};

playroomSync.setPlayroomSyncContext({
  getGameState: () => gameState,
  setGameState: (s) => {
    gameState = s;
  },
  getTransport: () => transport,
  getConfig: () => GAME_CONFIG,
  reduce: (s, a) => {
    reduce(s, a, GAME_CONFIG);
  },
  cloneGameState,
  renderGame: () => void appRender.renderGame(),
});

if (typeof globalThis.Playroom !== "undefined") {
  unsubHostRpc = playroomSync.registerHostIntentRpc();
}

function stopOnlineGameSync() {
  if (unsubSharedGame) {
    unsubSharedGame();
    unsubSharedGame = null;
  }
  if (unsubIntents) {
    unsubIntents();
    unsubIntents = null;
  }
}

/**
 * @param {import('./logic.js').GameAction} action
 */
function dispatch(action) {
  if (isPlayroomTransport() && gameState.multiplayerWithBots && transport) {
    const isHost = typeof transport.isHost === "function" && transport.isHost();
    const roomId = typeof transport.getRoomId === "function" ? transport.getRoomId() : null;
    if (roomId && !isHost) {
      const me = transport.getLocalPlayerId?.();
      if (me) {
        void (async () => {
          await playroomSync.addGameIntent(roomId, me, action);
        })();
      }
      return;
    }
  }
  reduce(gameState, action, GAME_CONFIG);
  void hostPushSharedStateIfNeeded();
}

function hostPushSharedStateIfNeeded() {
  if (!isPlayroomTransport() || !gameState.multiplayerWithBots || !transport) return;
  if (typeof transport.isHost !== "function" || !transport.isHost()) return;
  const roomId = transport.getRoomId?.();
  if (!roomId) return;
  void (async () => {
    await playroomSync.writeSharedGameState(roomId, cloneGameState(gameState));
  })();
}

/**
 * @param {string | undefined} playerId
 * @param {boolean} [soloWithAI]
 * @param {{ humanPlayerIds?: string[], multiplayerWithBots?: boolean, playerLabels?: Record<string, string> }} [mp]
 */
function onEnterGame(playerId, soloWithAI = false, mp = {}) {
  const { humanPlayerIds, multiplayerWithBots, playerLabels } = mp;
  gameState = createInitialGameState(GAME_CONFIG, {
    playerId,
    soloWithAI,
    humanPlayerIds,
    multiplayerWithBots,
    playerLabels,
  });
  reduce(gameState, {
    type: "APPEND_LOG",
    message: GAME_CONFIG.features?.limitOrders
      ? "✨ 提示: 可挂限价单，市价开平；第7天交割：作物缺货按交割价10倍赔偿，各类先扣款后若现金<0才失败。背包内种子可种植为作物现货；作物现货可按现价卖出，等量回公共池。祝交易顺利！"
      : "✨ 提示: 市价开平；第7天交割：作物缺货按交割价10倍赔偿，各类先扣款后若现金<0才失败。背包内种子可种植为作物现货；作物现货可按现价卖出，等量回公共池。祝交易顺利！",
  });
}

/** @type {"start" | "room" | "game"} */
let currentView = "start";

/**
 * @param {() => void | Promise<void>} renderGame
 */
async function beginOnlineGameSync(renderGame) {
  stopOnlineGameSync();
  if (!isPlayroomTransport() || !gameState.multiplayerWithBots || !transport) return;
  const roomId = transport.getRoomId?.();
  if (!roomId) return;

  if (transport.isHost?.()) {
    await playroomSync.writeSharedGameState(roomId, cloneGameState(gameState));
    unsubIntents = playroomSync.subscribeIntents(roomId, () => {});
  } else {
    unsubSharedGame = playroomSync.subscribeSharedGameState(roomId, (remote) => {
      const me = transport.getLocalPlayerId?.();
      gameState = /** @type {typeof gameState} */ (JSON.parse(JSON.stringify(remote)));
      if (me) gameState.activePlayerId = me;
      void renderGame();
    });
  }
}

(async () => {
  /** @type {'local'|'playroom'} */
  let backend;
  if (useLocalRoom()) {
    backend = "local";
    transport = createLocalRoomTransport();
  } else if (typeof globalThis.Playroom !== "undefined") {
    backend = "playroom";
    transport = createPlayroomRoomTransport(globalThis.Playroom, PLAYROOM_CONFIG);
  } else {
    console.error("Playroom Kit 未加载，请检查 index.html 中的 multiplayer.full.umd.js。已回退为本地房间模式。");
    backend = "local";
    transport = createLocalRoomTransport();
  }

  const appApi = mountApp(root, {
    config: GAME_CONFIG,
    getGameState: () => gameState,
    dispatch,
    transport,
    roomBackend: backend,
    setCurrentView: (v) => {
      currentView = v;
    },
    getCurrentView: () => currentView,
    onEnterGame,
    beginOnlineGameSync,
    stopOnlineGameSync,
  });

  appRender.renderGame = () => appApi.renderGame();
})();
