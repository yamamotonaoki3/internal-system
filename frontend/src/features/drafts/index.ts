// 下書きの端末への一時保存の機能の公開部分。ほかの機能は、ここだけを通して使う。
export { isBlankDraft, roomDraftScope } from "./draft-policy";
export {
  openDraftStorage,
  purgeExpiredDraftsOnStartup,
  removeUserDrafts,
} from "./draft-storage";
export { useDraft } from "./hooks/useDraft";
