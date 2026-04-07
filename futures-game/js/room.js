/**
 * 房间会话与本地 Transport 模拟。后续可替换为 WebSocket/Firebase 等，保持方法签名一致。
 */

import { normalizePlayerId } from "./state.js";

/**
 * @typedef {{ id: string, displayName: string, ready: boolean }} RoomPlayer
 */

/**
 * @typedef {{
 *   roomId: string,
 *   hostPlayerId: string,
 *   players: RoomPlayer[],
 *   gameStarted: boolean,
 * }} RoomSession
 */

/** @type {Map<string, RoomSession>} */
const registry = new Map();

let nextClientId = 1;

function genRoomId() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * @typedef {{
 *   createRoom: (preferredPlayerId?: string) => RoomSession,
 *   joinRoom: (roomId: string, preferredPlayerId?: string) => { ok: boolean, error?: string, session?: RoomSession },
 *   setReady: (ready: boolean) => void,
 *   hostStartGame: () => { ok: boolean, error?: string },
 *   leaveRoom: () => void,
 *   getSession: () => RoomSession | null,
 *   isHost: () => boolean,
 *   getLocalPlayerId: () => string | null,
 *   onStateChange: (cb: () => void) => () => void,
 * }} RoomTransport
 */

/**
 * 本地内存单例：同一浏览器内创建/加入房间；多标签页可各自持有一个 transport 实例。
 * @returns {RoomTransport}
 */
export function createLocalRoomTransport() {
  /** @type {RoomSession | null} */
  let session = null;
  /** @type {string | null} */
  let localPlayerId = null;
  /** @type {Set<() => void>} */
  const listeners = new Set();

  function notify() {
    listeners.forEach((fn) => fn());
  }

  return {
    createRoom(preferredPlayerId) {
      const roomId = genRoomId();
      const hostId = normalizePlayerId(preferredPlayerId) ?? `p${nextClientId++}`;
      session = {
        roomId,
        hostPlayerId: hostId,
        players: [{ id: hostId, displayName: hostId, ready: false }],
        gameStarted: false,
      };
      localPlayerId = hostId;
      registry.set(roomId, session);
      notify();
      return session;
    },

    joinRoom(roomId, preferredPlayerId) {
      const s = registry.get(roomId.trim());
      if (!s) {
        return { ok: false, error: "房间不存在" };
      }
      if (s.gameStarted) {
        return { ok: false, error: "游戏已开始" };
      }
      const norm = normalizePlayerId(preferredPlayerId);
      let guestId;
      if (norm != null) {
        if (s.players.some((p) => p.id === norm)) {
          return { ok: false, error: "该玩家 ID 已被占用" };
        }
        guestId = norm;
      } else {
        guestId = `p${nextClientId++}`;
        while (s.players.some((p) => p.id === guestId)) {
          guestId = `p${nextClientId++}`;
        }
      }
      s.players.push({ id: guestId, displayName: guestId, ready: false });
      session = s;
      localPlayerId = guestId;
      notify();
      return { ok: true, session: s };
    },

    setReady(ready) {
      if (!session || !localPlayerId) return;
      const p = session.players.find((x) => x.id === localPlayerId);
      if (p) p.ready = !!ready;
      notify();
    },

    hostStartGame() {
      if (!session || !localPlayerId) {
        return { ok: false, error: "未在房间中" };
      }
      if (session.hostPlayerId !== localPlayerId) {
        return { ok: false, error: "仅房主可开始" };
      }
      const allReady = session.players.length > 0 && session.players.every((p) => p.ready);
      if (!allReady) {
        return { ok: false, error: "请等待全员就绪" };
      }
      session.gameStarted = true;
      notify();
      return { ok: true };
    },

    leaveRoom() {
      if (!session || !localPlayerId) {
        session = null;
        localPlayerId = null;
        notify();
        return;
      }
      const rid = session.roomId;
      session.players = session.players.filter((p) => p.id !== localPlayerId);
      if (session.players.length === 0) {
        registry.delete(rid);
      } else if (session.hostPlayerId === localPlayerId) {
        session.hostPlayerId = session.players[0].id;
        session.players[0].displayName = "房主";
      }
      session = null;
      localPlayerId = null;
      notify();
    },

    getSession() {
      return session;
    },

    isHost() {
      return !!(session && localPlayerId && session.hostPlayerId === localPlayerId);
    },

    getLocalPlayerId() {
      return localPlayerId;
    },

    onStateChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
