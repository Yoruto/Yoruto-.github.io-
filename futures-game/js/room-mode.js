/**
 * 房间后端：
 * - 默认：Playroom Kit 联机（跨设备，需 Playroom 大厅）。
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
