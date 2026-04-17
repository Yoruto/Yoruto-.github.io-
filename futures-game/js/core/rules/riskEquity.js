import { buildSoloAiPlayerIds, DEFAULT_PLAYER_ID } from "../state.js";

/**
 * 开仓后权益下限：单机对手用 soloAiRiskMinEquity，其余用 riskMinEquity。
 * @param {ReturnType<import('../state.js').createInitialGameState>} state
 * @param {import('../config.js').GAME_CONFIG} config
 * @param {string} playerId
 */
export function getEffectiveRiskMinEquity(state, config, playerId) {
  const human = state.activePlayerId || DEFAULT_PLAYER_ID;
  if (state.soloWithAI) {
    const solo = buildSoloAiPlayerIds(human);
    if (solo.includes(playerId) && playerId !== human) {
      const s = config.rules.soloAiRiskMinEquity;
      if (s != null && Number.isFinite(s)) return s;
    }
  }
  return config.rules.riskMinEquity;
}
