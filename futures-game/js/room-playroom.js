/**
 * Playroom Kit 实现的 RoomTransport；需先 await startLobby()（insertCoin）再使用。
 */

import { MAX_ROOM_PLAYERS } from "./room.js";

/**
 * @param {typeof globalThis.Playroom} P
 * @param {{ gameId: string, baseUrl: string }} config
 * @returns {import('./room.js').RoomTransport & { startLobby: () => Promise<void> }}
 */
export function createPlayroomRoomTransport(P, config) {
  /** @type {import('./room.js').RoomSession | null} */
  let cachedSession = null;
  let connected = false;
  /** @type {(() => void) | null} */
  let pollTimer = null;
  /** @type {(() => void) | null} */
  let onJoinUnsub = null;
  /** @type {Set<() => void>} */
  const listeners = new Set();

  function notify() {
    listeners.forEach((fn) => fn());
  }

  function getParticipantsList() {
    const rec = P.getParticipants();
    if (!rec || typeof rec !== "object") return [];
    return Object.values(rec);
  }

  function rebuildSession() {
    if (!connected) {
      cachedSession = null;
      return null;
    }
    const roomId = P.getRoomCode() ?? "";
    const hostPlayerId = String(P.getState("hostPlayerId") ?? "");
    const parts = getParticipantsList();
    const sorted = [...parts].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const players = sorted.slice(0, MAX_ROOM_PLAYERS).map((p) => {
      let prof;
      try {
        prof = p.getProfile();
      } catch {
        prof = null;
      }
      const name = prof && prof.name ? String(prof.name) : String(p.id);
      return {
        id: String(p.id),
        displayName: name,
        ready: true,
      };
    });
    const nextDayReady = {};
    const merged = P.getState("nextDayReady");
    const g = merged && typeof merged === "object" ? merged : {};
    for (const pl of players) {
      nextDayReady[pl.id] = !!g[pl.id];
    }
    cachedSession = {
      roomId,
      hostPlayerId,
      players,
      gameStarted: true,
      nextDayReady,
    };
    return cachedSession;
  }

  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(() => {
      rebuildSession();
      notify();
    }, 250);
  }

  function stopPolling() {
    if (pollTimer != null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  return {
    async startLobby() {
      await P.insertCoin({
        gameId: config.gameId,
        baseUrl: config.baseUrl,
        maxPlayersPerRoom: MAX_ROOM_PLAYERS,
      });
      if (P.isHost()) {
        P.setState("hostPlayerId", P.myPlayer().id, true);
        P.setState("nextDayReady", {}, true);
      }
      await P.waitForState("hostPlayerId");
      connected = true;
      rebuildSession();
      onJoinUnsub = P.onPlayerJoin(() => {
        rebuildSession();
        notify();
      });
      startPolling();
      notify();
    },

    createRoom(_preferredPlayerId) {
      void _preferredPlayerId;
      throw new Error("请使用 Playroom 联机按钮");
    },

    joinRoom(_roomId, _preferredPlayerId) {
      void _roomId;
      void _preferredPlayerId;
      return { ok: false, error: "请使用 Playroom 联机按钮" };
    },

    setReady(_ready) {
      void _ready;
    },

    hostStartGame() {
      return { ok: true };
    },

    leaveRoom() {
      stopPolling();
      if (onJoinUnsub) {
        onJoinUnsub();
        onJoinUnsub = null;
      }
      try {
        P.myPlayer().leaveRoom();
      } catch (e) {
        console.error(e);
      }
      connected = false;
      cachedSession = null;
      notify();
    },

    getSession() {
      if (!connected) return null;
      return rebuildSession();
    },

    isHost() {
      return connected && P.isHost();
    },

    getLocalPlayerId() {
      if (!connected) return null;
      try {
        return P.myPlayer().id;
      } catch {
        return null;
      }
    },

    getRoomId() {
      if (!connected) return null;
      return P.getRoomCode() ?? null;
    },

    getHostUid() {
      return null;
    },

    async setNextDayReady(ready) {
      if (!connected) return;
      const me = P.myPlayer().id;
      const cur = P.getState("nextDayReady");
      const next = cur && typeof cur === "object" ? { ...cur } : {};
      next[me] = !!ready;
      P.setState("nextDayReady", next, true);
      rebuildSession();
      notify();
    },

    async clearNextDayReady(silent) {
      if (!connected || !cachedSession) return;
      if (!P.isHost()) return;
      const o = {};
      for (const p of cachedSession.players) {
        o[p.id] = false;
      }
      P.setState("nextDayReady", o, true);
      rebuildSession();
      if (!silent) notify();
    },

    getNextDayProgress(gameState) {
      const s = cachedSession ?? rebuildSession();
      if (!s) {
        return { ready: 0, total: 0 };
      }
      const ids = s.players.map((p) => p.id);
      const total = ids.length;
      let ready = 0;
      for (const id of ids) {
        const pl = gameState.players[id];
        if (pl?.status === "failed" || s.nextDayReady[id]) {
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
