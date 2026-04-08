import { GAME_CONFIG } from "./config.js";
import { createInitialGameState, cloneGameState } from "./state.js";
import { reduce } from "./logic.js";
import { createLocalRoomTransport } from "./room.js";
import { mountApp } from "./ui.js";
import { useFirebaseRoom } from "./room-mode.js";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app");

let gameState = createInitialGameState();

/** @type {ReturnType<createLocalRoomTransport> | Awaited<ReturnType<typeof import('./room-firebase.js').createFirebaseRoomTransport>> | null} */
let transport = null;

/** @type {(() => void) | null} */
let unsubSharedGame = null;
/** @type {(() => void) | null} */
let unsubIntents = null;
/** @type {Set<string>} */
const processedIntentIds = new Set();

function stopFirebaseGameSync() {
  if (unsubSharedGame) {
    unsubSharedGame();
    unsubSharedGame = null;
  }
  if (unsubIntents) {
    unsubIntents();
    unsubIntents = null;
  }
  processedIntentIds.clear();
}

/**
 * @param {import('./logic.js').GameAction} action
 */
function dispatch(action) {
  if (useFirebaseRoom() && gameState.multiplayerWithBots && transport) {
    const isHost = typeof transport.isHost === "function" && transport.isHost();
    const roomId = typeof transport.getRoomId === "function" ? transport.getRoomId() : null;
    if (roomId && !isHost) {
      const me = transport.getLocalPlayerId?.();
      if (me) {
        void (async () => {
          const mod = await import("./game-sync-firebase.js");
          await mod.addGameIntent(roomId, me, action);
        })();
      }
      return;
    }
  }
  reduce(gameState, action, GAME_CONFIG);
  void hostPushSharedStateIfNeeded();
}

function hostPushSharedStateIfNeeded() {
  if (!useFirebaseRoom() || !gameState.multiplayerWithBots || !transport) return;
  if (typeof transport.isHost !== "function" || !transport.isHost()) return;
  const roomId = transport.getRoomId?.();
  if (!roomId) return;
  void (async () => {
    const mod = await import("./game-sync-firebase.js");
    await mod.writeSharedGameState(roomId, cloneGameState(gameState));
  })();
}

/**
 * @param {string | undefined} playerId
 * @param {boolean} [soloWithAI]
 * @param {{ humanPlayerIds?: string[], multiplayerWithBots?: boolean }} [mp]
 */
function onEnterGame(playerId, soloWithAI = false, mp = {}) {
  const { humanPlayerIds, multiplayerWithBots } = mp;
  gameState = createInitialGameState(GAME_CONFIG, {
    playerId,
    soloWithAI,
    humanPlayerIds,
    multiplayerWithBots,
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
async function beginFirebaseGameSync(renderGame) {
  stopFirebaseGameSync();
  if (!useFirebaseRoom() || !gameState.multiplayerWithBots || !transport) return;
  const roomId = transport.getRoomId?.();
  if (!roomId) return;

  const mod = await import("./game-sync-firebase.js");

  if (transport.isHost?.()) {
    await mod.writeSharedGameState(roomId, cloneGameState(gameState));
    unsubIntents = mod.subscribeIntents(roomId, async (docSnap) => {
      if (processedIntentIds.has(docSnap.id)) return;
      processedIntentIds.add(docSnap.id);
      const data = docSnap.data();
      const playerId = data.playerId;
      const action = data.action;
      if (!playerId || !action) {
        await mod.deleteIntentDoc(docSnap);
        return;
      }
      const localId = transport.getLocalPlayerId?.() ?? null;
      const prev = gameState.activePlayerId;
      gameState.activePlayerId = playerId;
      try {
        reduce(gameState, action, GAME_CONFIG);
      } finally {
        if (localId) gameState.activePlayerId = localId;
      }
      await mod.deleteIntentDoc(docSnap);
      await mod.writeSharedGameState(roomId, cloneGameState(gameState));
      void renderGame();
    });
  } else {
    unsubSharedGame = mod.subscribeSharedGameState(roomId, (remote) => {
      const me = transport.getLocalPlayerId?.();
      gameState = /** @type {typeof gameState} */ (JSON.parse(JSON.stringify(remote)));
      if (me) gameState.activePlayerId = me;
      void renderGame();
    });
  }
}

(async () => {
  if (useFirebaseRoom()) {
    const { createFirebaseRoomTransport } = await import("./room-firebase.js");
    transport = createFirebaseRoomTransport();
  } else {
    transport = createLocalRoomTransport();
  }

  const appApi = mountApp(root, {
    config: GAME_CONFIG,
    getGameState: () => gameState,
    dispatch,
    transport,
    roomBackend: useFirebaseRoom() ? "firebase" : "local",
    setCurrentView: (v) => {
      currentView = v;
    },
    getCurrentView: () => currentView,
    onEnterGame,
    beginFirebaseGameSync,
    stopFirebaseGameSync,
  });
})();
