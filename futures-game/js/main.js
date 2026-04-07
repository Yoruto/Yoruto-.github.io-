import { GAME_CONFIG } from "./config.js";
import { createInitialGameState } from "./state.js";
import { reduce } from "./logic.js";
import { createLocalRoomTransport } from "./room.js";
import { mountApp } from "./ui.js";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app");

const transport = createLocalRoomTransport();

let gameState = createInitialGameState();

function dispatch(action) {
  reduce(gameState, action, GAME_CONFIG);
}

function onEnterGame(playerId, soloWithAI = false) {
  gameState = createInitialGameState(GAME_CONFIG, { playerId, soloWithAI });
  reduce(gameState, {
    type: "APPEND_LOG",
    message: GAME_CONFIG.features?.limitOrders
      ? "✨ 提示: 可挂限价单，市价开平；第7天先收盘调价，再按持仓确定交割价，作物走现货池与背包，种子多头付现入背包。背包内种子可点击种植为作物现货；作物现货可点击按现价卖出，现金入账，等量回到公共池。祝交易顺利！"
      : "✨ 提示: 市价开平；第7天先收盘调价，再按持仓确定交割价，作物走现货池与背包，种子多头付现入背包。背包内种子可点击种植为作物现货；作物现货可点击按现价卖出，现金入账，等量回到公共池。祝交易顺利！",
  });
}

/** @type {"start" | "room" | "game"} */
let currentView = "start";

mountApp(root, {
  config: GAME_CONFIG,
  getGameState: () => gameState,
  dispatch,
  transport,
  setCurrentView: (v) => {
    currentView = v;
  },
  getCurrentView: () => currentView,
  onEnterGame,
});
