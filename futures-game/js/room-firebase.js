/**
 * Firestore + 匿名登录实现的 RoomTransport，与 createLocalRoomTransport 方法签名一致。
 * Firebase SDK 使用官方 ESM CDN（版本固定，见下方 import）。
 */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { genRoomId, MAX_ROOM_PLAYERS } from "./room.js";
import { normalizePlayerId } from "./state.js";

const COLLECTION = "rooms";

function getFirebaseApp() {
  if (getApps().length) {
    return getApps()[0];
  }
  return initializeApp(firebaseConfig);
}

/**
 * @param {string} roomId
 * @param {import('firebase/firestore').DocumentData} d
 * @returns {import('./room.js').RoomSession}
 */
function docToSession(roomId, d) {
  const playersRaw = Array.isArray(d.players) ? d.players : [];
  const players = playersRaw.map((p) => ({
    id: String(p.id),
    displayName: String(p.displayName ?? p.id),
    ready: !!p.ready,
  }));
  const nextDayReady = d.nextDayReady && typeof d.nextDayReady === "object" ? { ...d.nextDayReady } : {};
  for (const p of players) {
    if (nextDayReady[p.id] === undefined) nextDayReady[p.id] = false;
  }
  return {
    roomId,
    hostPlayerId: String(d.hostPlayerId ?? ""),
    players,
    gameStarted: !!d.gameStarted,
    nextDayReady,
  };
}

/**
 * @returns {import('./room.js').RoomTransport}
 */
export function createFirebaseRoomTransport() {
  const app = getFirebaseApp();
  const auth = getAuth(app);
  const db = getFirestore(app);

  /** @type {import('./room.js').RoomSession | null} */
  let cachedSession = null;
  /** 含 uid，供写入；getSession 对外仍用 RoomSession */
  /** @type {Array<{ id: string, displayName: string, ready: boolean, uid: string }>} */
  let internalPlayers = [];
  /** @type {string | null} */
  let hostUid = null;
  /** @type {string | null} */
  let currentRoomId = null;
  /** @type {string | null} */
  let localPlayerId = null;
  /** @type {(() => void) | null} */
  let unsub = null;
  /** @type {Set<() => void>} */
  const listeners = new Set();

  let nextClientId = 1;

  /**
   * @param {import('firebase/firestore').DocumentReference} ref
   * @param {string} leavingId
   */
  async function removePlayerAndMaybeDelete(ref, leavingId) {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists) return;
      const data = snap.data();
      let players = Array.isArray(data.players) ? data.players.filter((p) => p.id !== leavingId) : [];
      if (players.length === 0) {
        transaction.delete(ref);
        return;
      }
      const wasHost = String(data.hostPlayerId) === leavingId;
      let newHostPlayerId = String(data.hostPlayerId ?? "");
      let newHostUid = String(data.hostUid ?? "");
      if (wasHost) {
        newHostPlayerId = String(players[0].id);
        newHostUid = String(players[0].uid ?? "");
        players = players.map((p, i) => (i === 0 ? { ...p, displayName: "房主" } : p));
      }
      transaction.update(ref, {
        players,
        hostPlayerId: newHostPlayerId,
        hostUid: newHostUid,
      });
    });
  }

  function notify() {
    listeners.forEach((fn) => fn());
  }

  async function ensureAuth() {
    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }
    return auth.currentUser;
  }

  function detachListener() {
    if (unsub) {
      unsub();
      unsub = null;
    }
  }

  /**
   * @param {string} roomId
   */
  function attachListener(roomId) {
    detachListener();
    const ref = doc(db, COLLECTION, roomId);
    unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists) {
          cachedSession = null;
          internalPlayers = [];
          currentRoomId = null;
          localPlayerId = null;
          hostUid = null;
          notify();
          return;
        }
        const d = snap.data();
        hostUid = d.hostUid ?? null;
        const raw = Array.isArray(d.players) ? d.players : [];
        internalPlayers = raw.map((p) => ({
          id: String(p.id),
          displayName: String(p.displayName ?? p.id),
          ready: !!p.ready,
          uid: String(p.uid ?? ""),
        }));
        cachedSession = docToSession(roomId, d);
        currentRoomId = roomId;
        notify();
      },
      (err) => {
        console.error("Firestore room snapshot error:", err);
        notify();
      }
    );
  }

  function roomRef() {
    if (!currentRoomId) throw new Error("未在房间中");
    return doc(db, COLLECTION, currentRoomId);
  }

  return {
    async createRoom(preferredPlayerId) {
      const user = await ensureAuth();
      const roomId = genRoomId();
      const hostId = normalizePlayerId(preferredPlayerId) ?? `p${nextClientId++}`;
      const ref = doc(db, COLLECTION, roomId);
      const playerRow = {
        id: hostId,
        displayName: hostId,
        ready: false,
        uid: user.uid,
      };
      await setDoc(ref, {
        hostPlayerId: hostId,
        hostUid: user.uid,
        players: [playerRow],
        gameStarted: false,
        nextDayReady: {},
        createdAt: serverTimestamp(),
      });
      localPlayerId = hostId;
      currentRoomId = roomId;
      internalPlayers = [playerRow];
      hostUid = user.uid;
      cachedSession = docToSession(roomId, {
        hostPlayerId: hostId,
        players: [playerRow],
        gameStarted: false,
        nextDayReady: {},
      });
      attachListener(roomId);
      notify();
      return /** @type {import('./room.js').RoomSession} */ (cachedSession);
    },

    async joinRoom(roomId, preferredPlayerId) {
      const rid = roomId.trim();
      if (!rid) {
        return { ok: false, error: "房间不存在" };
      }
      const user = await ensureAuth();
      const ref = doc(db, COLLECTION, rid);

      try {
        await runTransaction(db, async (transaction) => {
          const snap = await transaction.get(ref);
          if (!snap.exists) {
            throw new Error("ROOM_NOT_FOUND");
          }
          const data = snap.data();
          if (data.gameStarted) {
            throw new Error("GAME_STARTED");
          }
          const players = Array.isArray(data.players) ? [...data.players] : [];
          if (players.length >= MAX_ROOM_PLAYERS) {
            throw new Error("FULL");
          }
          const norm = normalizePlayerId(preferredPlayerId);
          let guestId;
          if (norm != null) {
            if (players.some((p) => p.id === norm)) {
              throw new Error("ID_TAKEN");
            }
            guestId = norm;
          } else {
            const base = `g_${user.uid.replace(/[^a-zA-Z0-9]/g, "").slice(0, 14)}`;
            guestId = base;
            let n = 0;
            while (players.some((p) => p.id === guestId)) {
              n += 1;
              guestId = `${base}_${n}`;
            }
          }
          const newPlayer = {
            id: guestId,
            displayName: guestId,
            ready: false,
            uid: user.uid,
          };
          players.push(newPlayer);
          transaction.update(ref, { players });
        });
      } catch (e) {
        const msg = e && typeof e.message === "string" ? e.message : String(e);
        if (msg === "ROOM_NOT_FOUND") return { ok: false, error: "房间不存在" };
        if (msg === "GAME_STARTED") return { ok: false, error: "游戏已开始" };
        if (msg === "FULL") return { ok: false, error: "房间已满" };
        if (msg === "ID_TAKEN") return { ok: false, error: "该玩家 ID 已被占用" };
        console.error(e);
        return { ok: false, error: "加入失败，请检查网络与 Firestore 规则" };
      }

      localPlayerId = null;
      currentRoomId = rid;
      attachListener(rid);

      const snap = await getDoc(ref);
      if (!snap.exists) {
        return { ok: false, error: "房间不存在" };
      }
      const d = snap.data();
      const players = Array.isArray(d.players) ? d.players : [];
      const me = players.find((p) => p.uid === user.uid);
      if (!me) {
        return { ok: false, error: "加入失败" };
      }
      localPlayerId = me.id;
      internalPlayers = players.map((p) => ({
        id: String(p.id),
        displayName: String(p.displayName ?? p.id),
        ready: !!p.ready,
        uid: String(p.uid ?? ""),
      }));
      cachedSession = docToSession(rid, d);
      hostUid = d.hostUid ?? null;
      notify();

      return { ok: true, session: cachedSession };
    },

    async setReady(ready) {
      if (!currentRoomId || !localPlayerId) return;
      await ensureAuth();
      const ref = roomRef();
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(ref);
        if (!snap.exists) return;
        const data = snap.data();
        const players = Array.isArray(data.players) ? [...data.players] : [];
        const idx = players.findIndex((p) => p.id === localPlayerId);
        if (idx < 0) return;
        players[idx] = { ...players[idx], ready: !!ready };
        transaction.update(ref, { players });
      });
    },

    async hostStartGame() {
      if (!currentRoomId || !localPlayerId) {
        return { ok: false, error: "未在房间中" };
      }
      const snap = await getDoc(roomRef());
      if (!snap.exists) return { ok: false, error: "未在房间中" };
      const d = snap.data();
      if (String(d.hostPlayerId) !== localPlayerId) {
        return { ok: false, error: "仅房主可开始" };
      }
      const players = Array.isArray(d.players) ? d.players : [];
      const allReady = players.length > 0 && players.every((p) => !!p.ready);
      if (!allReady) {
        return { ok: false, error: "请等待全员就绪" };
      }
      await updateDoc(roomRef(), { gameStarted: true });
      return { ok: true };
    },

    async leaveRoom() {
      if (!currentRoomId || !localPlayerId) {
        cachedSession = null;
        internalPlayers = [];
        hostUid = null;
        currentRoomId = null;
        localPlayerId = null;
        detachListener();
        notify();
        return;
      }

      const ref = roomRef();
      const leavingId = localPlayerId;

      try {
        await removePlayerAndMaybeDelete(ref, leavingId);
      } catch (e) {
        console.error(e);
      }

      detachListener();
      cachedSession = null;
      internalPlayers = [];
      hostUid = null;
      currentRoomId = null;
      localPlayerId = null;
      notify();
    },

    getSession() {
      return cachedSession;
    },

    isHost() {
      return !!(cachedSession && localPlayerId && cachedSession.hostPlayerId === localPlayerId);
    },

    getLocalPlayerId() {
      return localPlayerId;
    },

    getRoomId() {
      return currentRoomId;
    },

    getHostUid() {
      return hostUid;
    },

    async setNextDayReady(ready) {
      if (!currentRoomId || !localPlayerId) return;
      await ensureAuth();
      await updateDoc(roomRef(), {
        [`nextDayReady.${localPlayerId}`]: !!ready,
      });
    },

    async clearNextDayReady(silent) {
      if (!currentRoomId || !cachedSession) return;
      await ensureAuth();
      /** @type {Record<string, unknown>} */
      const updates = {};
      for (const p of cachedSession.players) {
        updates[`nextDayReady.${p.id}`] = false;
      }
      await updateDoc(roomRef(), updates);
      if (!silent) notify();
    },

    getNextDayProgress(gameState) {
      if (!cachedSession) {
        return { ready: 0, total: 0 };
      }
      const ids = cachedSession.players.map((p) => p.id);
      const total = ids.length;
      let ready = 0;
      for (const id of ids) {
        const pl = gameState.players[id];
        if (pl?.status === "failed" || cachedSession.nextDayReady[id]) {
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
