/**
 * 房间会话与本地 Transport 模拟（单标签页内存）。
 * nextDayReady 在真联机时需由同步适配器/服务端实现；当前为单进程内存。
 */

import { normalizePlayerId } from "./state.js";

/** 房间内真人玩家上限 */
export const MAX_ROOM_PLAYERS = 4;

/**
 * @typedef {{ id: string, displayName: string, ready: boolean }} RoomPlayer
 */

/**
 * @typedef {{
 *   roomId: string,
 *   hostPlayerId: string,
 *   players: RoomPlayer[],
 *   gameStarted: boolean,
 *   nextDayReady: Record<string, boolean>,
 * }} RoomSession
 */

/** @type {Map<string, RoomSession>} */
const registry = new Map();

let nextClientId = 1;

export function genRoomId() {
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
 *   getRoomId: () => string | null,
 *   getHostUid?: () => string | null,
 *   setNextDayReady: (ready: boolean) => void,
 *   clearNextDayReady: (silent?: boolean) => void,
 *   getNextDayProgress: (gameState: { players: Record<string, { status?: string }> }) => { ready: number, total: number },
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

  /**
   * @param {RoomSession | null} s
   */
  function ensureNextDayReady(s) {
    if (s && !s.nextDayReady) {
      s.nextDayReady = {};
    }
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
        nextDayReady: {},
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
      ensureNextDayReady(s);
      if (s.gameStarted) {
        return { ok: false, error: "游戏已开始" };
      }
      if (s.players.length >= MAX_ROOM_PLAYERS) {
        return { ok: false, error: "房间已满" };
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
      ensureNextDayReady(session);
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

    getRoomId() {
      return session?.roomId ?? null;
    },

    getHostUid() {
      return null;
    },

    setNextDayReady(ready) {
      if (!session || !localPlayerId) return;
      ensureNextDayReady(session);
      session.nextDayReady[localPlayerId] = !!ready;
      notify();
    },

    clearNextDayReady(silent) {
      if (!session) return Promise.resolve();
      ensureNextDayReady(session);
      for (const p of session.players) {
        session.nextDayReady[p.id] = false;
      }
      if (!silent) notify();
      return Promise.resolve();
    },

    getNextDayProgress(gameState) {
      if (!session) {
        return { ready: 0, total: 0 };
      }
      ensureNextDayReady(session);
      const ids = session.players.map((p) => p.id);
      const total = ids.length;
      let ready = 0;
      for (const id of ids) {
        const pl = gameState.players[id];
        if (pl?.status === "failed" || session.nextDayReady[id]) {
          ready += 1;
        }
      }
      return { ready, total };
    },

    onStateChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
