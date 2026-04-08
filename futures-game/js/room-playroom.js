/**
 * Playroom Kit 实现的 RoomTransport；支持房间号创建/加入流程。
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
  /** @type {boolean} */
  let skipLobbyMode = false;

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

  /**
   * 设置 Playroom 玩家显示名
   * @param {string} name
   */
  function setPlayroomProfileName(name) {
    try {
      const player = P.myPlayer();
      if (player && player.setProfile) {
        player.setProfile({ name: String(name) });
      }
    } catch (e) {
      console.warn("设置 Playroom profile 失败:", e);
    }
  }

  /**
   * 初始化 Playroom 连接（内部共用）
   * @param {{ skipLobby?: boolean, roomCode?: string, playerName?: string }} options
   */
  async function initConnection(options = {}) {
    await P.insertCoin({
      gameId: config.gameId,
      baseUrl: config.baseUrl,
      maxPlayersPerRoom: MAX_ROOM_PLAYERS,
      skipLobby: options.skipLobby || false,
      roomCode: options.roomCode,
    });
    // 设置玩家显示名
    if (options.playerName) {
      setPlayroomProfileName(options.playerName);
    }
    if (P.isHost()) {
      P.setState("hostPlayerId", P.myPlayer().id, true);
      P.setState("nextDayReady", {}, true);
      P.setState("gameStarted", false, true);
    }
    await P.waitForState("hostPlayerId");
    connected = true;
    skipLobbyMode = !!options.skipLobby;
    rebuildSession();
    onJoinUnsub = P.onPlayerJoin(() => {
      rebuildSession();
      notify();
    });
    // 监听游戏开始状态（非房主用）
    P.onStateChange("gameStarted", (started) => {
      if (started && cachedSession) {
        cachedSession.gameStarted = true;
        notify();
      }
    });
    startPolling();
    notify();
  }

  return {
    async startLobby() {
      await initConnection({ skipLobby: false });
    },

    async createRoom(preferredPlayerId) {
      try {
        await initConnection({ skipLobby: true, playerName: preferredPlayerId });
        // Playroom 自动生成房间码，从 getRoomCode() 获取
        const roomCode = P.getRoomCode();
        return {
          roomId: roomCode || "",
          hostPlayerId: P.myPlayer().id,
          players: [{ id: P.myPlayer().id, displayName: preferredPlayerId || P.myPlayer().id, ready: false }],
          gameStarted: false,
          nextDayReady: {},
        };
      } catch (e) {
        console.error(e);
        throw new Error("创建房间失败: " + (e instanceof Error ? e.message : String(e)));
      }
    },

    async joinRoom(roomId, preferredPlayerId) {
      if (!roomId || typeof roomId !== "string") {
        return { ok: false, error: "请输入房间号" };
      }
      try {
        await initConnection({ skipLobby: true, roomCode: roomId.trim(), playerName: preferredPlayerId });
        return { ok: true, session: rebuildSession() };
      } catch (e) {
        console.error(e);
        const msg = e instanceof Error ? e.message : String(e);
        // 友好错误提示
        if (msg.includes("not found") || msg.includes(" Room ") || msg.includes("exist")) {
          return { ok: false, error: "房间不存在或已关闭" };
        }
        if (msg.includes("full") || msg.includes("maximum")) {
          return { ok: false, error: "房间已满" };
        }
        return { ok: false, error: "加入房间失败: " + msg };
      }
    },

    setReady(ready) {
      // 在房间号模式下，将就绪状态存储在本地缓存中
      if (!connected || !cachedSession) return;
      const me = P.myPlayer().id;
      const p = cachedSession.players.find((x) => x.id === me);
      if (p) p.ready = !!ready;
      // 通知其他玩家（通过 Playroom 状态同步）
      P.setState(`playerReady_${me}`, !!ready, true);
      notify();
    },

    hostStartGame() {
      if (!connected || !cachedSession) {
        return { ok: false, error: "未在房间中" };
      }
      const me = P.myPlayer().id;
      if (cachedSession.hostPlayerId !== me) {
        return { ok: false, error: "仅房主可开始" };
      }
      // 检查全员就绪
      const allReady = cachedSession.players.length > 0 && cachedSession.players.every((p) => p.ready);
      if (!allReady) {
        return { ok: false, error: "请等待全员就绪" };
      }
      // 标记游戏已开始
      cachedSession.gameStarted = true;
      P.setState("gameStarted", true, true);
      notify();
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
