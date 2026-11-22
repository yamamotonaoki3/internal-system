// 資格を失ったときの、文書ごとの読み込み直しの機能（#338）の公開部分。ほかの機能は、ここだけを通して使う。
export {
  openNoticeStorage,
  takeAccessLossNotice,
  writeAccessLossNotice,
  type AccessLossNoticeKind,
} from "./access-loss-notice";
export { AccessLossBoundary } from "./components/AccessLossBoundary";
export { AccessLossNotice } from "./components/AccessLossNotice";
export {
  getAccessLossReloadState,
  noteDraftsRemain,
  requestAccessLossReload,
  type AccessLossReloadRequest,
  type AccessLossReloadState,
} from "./reload-after-access-loss";
