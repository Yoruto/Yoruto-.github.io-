import { executeWorldNpcFuturesTurns } from "../ai/worldNpcFutures.js";
import { runBotTurns, runSoloAITurns } from "../ai/index.js";
import {
  closePositionForPlayer,
  closePositionForWorldNpc,
  openMarketPositionForPlayer,
  openMarketPositionForWorldNpc,
  reduce,
} from "./rules/gameReducer.js";
import { createLocalSyncAdapter } from "./sync/LocalSyncAdapter.js";

/**
 * 单局会话门面：统一 dispatch / subscribe；AI 仅在过日前运行于会话层，不写入 reducer。
 *
 * @param {object} opts
 * @param {() => object} opts.getState
 * @param {import('./config.js').GAME_CONFIG} opts.config
 * @param {import('./sync/LocalSyncAdapter.js').SyncAdapter} [opts.syncAdapter]
 */
export function createGameSession({ getState, config, syncAdapter = createLocalSyncAdapter() }) {
  /** @type {Set<() => void>} */
  const listeners = new Set();

  const aiApi = {
    openMarketPositionForPlayer,
    closePositionForPlayer,
  };

  const worldNpcApi = {
    openMarketPositionForWorldNpc,
    closePositionForWorldNpc,
  };

  /**
   * @param {import('./rules/gameReducer.js').GameAction} action
   */
  function applyAction(action) {
    const state = getState();
    if (action.type === "NEXT_DAY") {
      executeWorldNpcFuturesTurns(state, config, worldNpcApi);
      if (state.multiplayerWithBots && state.botPlayerIds?.length) {
        runBotTurns(state, config, aiApi, state.botPlayerIds);
      } else {
        runSoloAITurns(state, config, aiApi);
      }
    }
    reduce(state, action, config);
    for (const fn of listeners) fn();
  }

  const dispatch = syncAdapter.wrapDispatch(applyAction);

  return {
    getState,
    getConfig: () => config,
    dispatch,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
