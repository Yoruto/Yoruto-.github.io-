/**
 * 联机同步适配器：本地单机为透传；未来可在此目录增加 Host/Client 实现，
 * 在 wrapDispatch 中插入校验、intent 队列或状态广播。
 */

/**
 * @typedef {{
 *   wrapDispatch: <T>(dispatch: (action: T) => void) => (action: T) => void
 * }} SyncAdapter
 */

/**
 * @returns {SyncAdapter}
 */
export function createLocalSyncAdapter() {
  return {
    /**
     * @template T
     * @param {(action: T) => void} dispatch
     * @returns {(action: T) => void}
     */
    wrapDispatch(dispatch) {
      return dispatch;
    },
  };
}
