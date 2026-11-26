// ログイン・セッションの機能の公開部分。ほかの機能は、ここだけを通して使う。
export type { SessionInfo } from "./api/auth-api";
export { authKeys } from "./api/query-keys";
export { DraftCleanupNotice } from "./components/DraftCleanupNotice";
export { LogoutFailureNotice } from "./components/LogoutFailureNotice";
export { useSession } from "./hooks/useSession";
export { useReauth } from "./hooks/useReauth";
export { useSignedInUserId } from "./hooks/useSignedInUserId";
export { installUserSwitchGuard, publishSession } from "./user-switch-guard";
export {
  expectedUserIdFor,
  getDocumentUserId,
  installDocumentUser,
} from "./document-user";
export {
  confirmSessionUserAfterMismatch,
  createSessionUserMismatchHandler,
  type SessionUserOutcome,
} from "./session-user-mismatch-handler";
