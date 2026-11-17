// アカウント管理の機能の公開部分。ほかの機能（退職処理の申請）は、ここだけを通して使う。
export { DeactivateDialog } from "./DeactivateDialog";
export { NotSentError, sendWithReauth } from "./lifecycle-errors";
