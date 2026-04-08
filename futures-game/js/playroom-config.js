/**
 * Playroom Kit：开发者后台创建游戏后获得的 gameId；baseUrl 用于生成房间分享链接。
 * @see https://docs.joinplayroom.com/api-reference/js/insertCoin
 *
 * 本项目使用的 API（与 node_modules/playroomkit/types.d.ts 一致）：
 * insertCoin, getState, setState, waitForState, onPlayerJoin, getRoomCode, isHost,
 * myPlayer, getParticipants, leaveRoom, RPC.register / RPC.call。
 * 房间状态变化用 getState 轮询同步；SDK 无 onStateSet / onStateChange。
 */
export const PLAYROOM_CONFIG = {
  gameId: "8NSSrlYRLqvJ5Cx759Va",
  baseUrl: "https://futuresfarmer.playroom.gg",
};
