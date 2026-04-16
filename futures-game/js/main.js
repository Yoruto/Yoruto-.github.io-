import { GAME_CONFIG } from "./config.js";
import { createGameSession } from "./core/GameSession.js";
import { createLocalRoomTransport } from "./room.js";
import { createInitialGameState } from "./state.js";
import { mountApp } from "./presentation/ui.js";
import { isRoomModeAllowed } from "./room-mode.js";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app");

/** @type {ReturnType<typeof createInitialGameState>} */
let gameState = createInitialGameState();

const session = createGameSession({
  getState: () => gameState,
  config: GAME_CONFIG,
});

const transport = createLocalRoomTransport();

const appRender = {
  /** @type {() => void | Promise<void>} */
  renderGame: () => {},
};

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
  session.dispatch({
    type: "APPEND_LOG",
    message: GAME_CONFIG.features?.limitOrders
      ? "✨ 提示: 可挂限价单，市价开平；第7天交割：作物缺货按交割价10倍赔偿，各类先扣款后若现金<0才失败。背包内种子可种植为作物现货；作物现货可按现价卖出，等量回公共池。祝交易顺利！"
      : "✨ 提示: 市价开平；第7天交割：作物缺货按交割价10倍赔偿，各类先扣款后若现金<0才失败。背包内种子可种植为作物现货；作物现货可按现价卖出，等量回公共池。祝交易顺利！",
  });
}

/** @type {"start" | "room" | "game"} */
let currentView = "start";

const roomModeAllowed = isRoomModeAllowed(GAME_CONFIG.features);

const appApi = mountApp(root, {
  config: GAME_CONFIG,
  getGameState: () => gameState,
  dispatch: session.dispatch,
  transport,
  roomModeEnabled: roomModeAllowed,
  setCurrentView: (v) => {
    currentView = v;
  },
  getCurrentView: () => currentView,
  onEnterGame,
});

appRender.renderGame = () => appApi.renderGame();
