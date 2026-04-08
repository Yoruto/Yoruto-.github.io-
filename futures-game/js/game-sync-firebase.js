/**
 * Firestore 多人游戏状态同步：sharedState/current 存 JSON；intents 队列供非房主提交操作。
 * SDK 版本与 room-firebase.js 一致。
 */

import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  collection,
  query,
  orderBy,
  addDoc,
  deleteDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
import { firebaseConfig } from "./firebase-config.js";

function getDb() {
  if (!getApps().length) {
    initializeApp(firebaseConfig);
  }
  return getFirestore(getApps()[0]);
}

const COLLECTION = "rooms";

/**
 * @param {string} roomId
 * @param {ReturnType<import('./state.js').cloneGameState>} stateObj
 */
export async function writeSharedGameState(roomId, stateObj) {
  const db = getDb();
  const ref = doc(db, COLLECTION, roomId, "sharedState", "current");
  const snap = await getDoc(ref);
  const v = snap.exists ? Number(snap.data()?.version ?? 0) : 0;
  const payload = JSON.stringify(stateObj);
  await setDoc(
    ref,
    {
      payload,
      version: v + 1,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * @param {(state: object, version: number) => void} callback
 * @returns {() => void}
 */
export function subscribeSharedGameState(roomId, callback) {
  const db = getDb();
  const ref = doc(db, COLLECTION, roomId, "sharedState", "current");
  return onSnapshot(ref, (snap) => {
    if (!snap.exists) return;
    const d = snap.data();
    if (!d || typeof d.payload !== "string") return;
    try {
      const state = JSON.parse(d.payload);
      callback(state, Number(d.version ?? 0));
    } catch (e) {
      console.error("subscribeSharedGameState parse error", e);
    }
  });
}

/**
 * @param {string} roomId
 * @param {string} playerId
 * @param {import('./logic.js').GameAction} action
 */
export async function addGameIntent(roomId, playerId, action) {
  const db = getDb();
  const col = collection(db, COLLECTION, roomId, "intents");
  await addDoc(col, {
    playerId,
    action,
    createdAt: serverTimestamp(),
  });
}

/**
 * @param {(doc: import('firebase/firestore').QueryDocumentSnapshot) => void} onAdded
 * @returns {() => void}
 */
export function subscribeIntents(roomId, onAdded) {
  const db = getDb();
  const col = collection(db, COLLECTION, roomId, "intents");
  const q = query(col, orderBy("createdAt", "asc"));
  return onSnapshot(q, (snap) => {
    snap.docChanges().forEach((ch) => {
      if (ch.type === "added") {
        onAdded(/** @type {import('firebase/firestore').QueryDocumentSnapshot} */ (ch.doc));
      }
    });
  });
}

/**
 * @param {import('firebase/firestore').QueryDocumentSnapshot} docSnap
 */
export async function deleteIntentDoc(docSnap) {
  await deleteDoc(docSnap.ref);
}
