/**
 * 房间后端：默认使用 Firestore（跨设备联机，适合 GitHub Pages 正式部署）。
 * 显式使用本地内存（仅同标签页模拟）：URL ?mp=local，或 localStorage futures-game:roomBackend = "local"
 */
export function useFirebaseRoom() {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("mp") === "local") {
      return false;
    }
    if (localStorage.getItem("futures-game:roomBackend") === "local") {
      return false;
    }
  } catch {
    /* ignore */
  }
  return true;
}
