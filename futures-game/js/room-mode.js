/** 设为 "1" 时与 ?rooms=1 等效，用于本地调试房间/联机 */
export const ENABLE_ROOMS_STORAGE_KEY = "futures-game:enableRooms";

/**
 * 开发用：URL `?rooms=1` 或 localStorage `futures-game:enableRooms` = "1" 时允许房间模式，
 * 无需改配置发版。
 */
export function roomsDevOverrideEnabled() {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("rooms") === "1") {
      return true;
    }
    if (localStorage.getItem(ENABLE_ROOMS_STORAGE_KEY) === "1") {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * 是否允许创建/加入房间及 Playroom 联机（与 {@link useLocalRoom} 独立：后者仅选择本地内存后端）。
 * @param {import('./config.js').GAME_CONFIG['features']} [features]
 */
export function isRoomModeAllowed(features) {
  if (features?.roomAndOnline) return true;
  return roomsDevOverrideEnabled();
}

/**
 * 房间后端（需 {@link isRoomModeAllowed} 为真时入口才可用）：
 * - Playroom Kit 跨设备联机：`features.roomAndOnline` 或开发覆盖 `?rooms=1` / `enableRooms`，且非 `useLocalRoom()`。
 * - 显式本地内存（仅同标签页模拟）：URL ?mp=local，或 localStorage futures-game:roomBackend = "local"
 */
export function useLocalRoom() {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("mp") === "local") {
      return true;
    }
    if (localStorage.getItem("futures-game:roomBackend") === "local") {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** 使用 Playroom 在线联机（非本地内存模式） */
export function usePlayroomOnline() {
  return !useLocalRoom();
}
