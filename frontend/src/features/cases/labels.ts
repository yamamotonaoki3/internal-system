// 案件の表示名（S-16・S-17）。
import { CASE_TODO_TITLE_MAX_LENGTH } from "../../../../shared/case-todo-rules";
import type { CaseAutoRole, CaseStatus } from "./api/case-api";

export const STATUS_LABELS: Readonly<Record<CaseStatus, string>> = {
  active: "進行中",
  closed: "終了",
};

/** 非参加者に出す文（サーバーの 403 の文言と同じ） */
export const PARTICIPANTS_ONLY_TEXT = "参加者だけが見られます（非公開）";

const INACTIVE_MARK = "（無効）";

export const nameWithMark = (item: { name: string; isActive: boolean }) =>
  item.isActive ? item.name : `${item.name}${INACTIVE_MARK}`;

export const participantCountText = (count: number) => `参加者 ${count}人`;

/** 自動参加の人の役割の名前（Q8） */
export const AUTO_ROLE_LABELS: Readonly<Record<CaseAutoRole, string>> = {
  global_admin: "全体管理者",
  department_owner: "担当部署のオーナー",
};

/** 参加者の追加・削除・退出の成功の表示 */
export const PARTICIPANTS_UPDATED_TEXT = "参加者を更新しました";

/** S-17 のやり取り（#148）：終了した案件の帯・投稿できない案内・0件の文 */
export const CASE_CLOSED_BANNER_TEXT =
  "終了した案件・アーカイブ（読み取り専用）";
export const CASE_CANNOT_POST_TEXT =
  "終了した案件のため、投稿・編集・リアクションはできません（読み取り専用）";
export const CONVERSATION_EMPTY_TEXT = "まだやり取りがありません";

/** S-17 の終了・再開（#150）：ボタン・確認のダイアログ・完了の表示 */
export const CASE_STATUS_CHANGE_TEXTS = {
  close: {
    button: "案件を終了",
    title: "案件の終了",
    body: "終了すると、メッセージ・参加者・納期は読み取り専用になります。参加者は、いつでも再開できます。",
    confirm: "終了する",
    done: "案件を終了しました",
  },
  reopen: {
    button: "案件を再開",
    title: "案件の再開",
    body: "再開すると、いまの参加者のまま進行中に戻ります。",
    confirm: "再開する",
    done: "案件を再開しました",
  },
} as const;

/** S-17 の TODO（#149） */
export const CASE_TODO_HEADING = "TODO";
export const CASE_TODO_EMPTY_TEXT = "項目なし";
export const CASE_TODO_DONE_TEXT = "完了";
export const CASE_TODO_LOAD_ERROR_TEXT = "TODOを読み込めませんでした";
export const CASE_TODO_ADDED_TEXT = "TODOを追加しました";
export const CASE_TODO_READ_ONLY_TEXT =
  "終了した案件のため、閲覧のみです（追加・完了・取り消しはできません）";
export const CASE_TODO_NO_ASSIGNEE_TEXT = "担当なし";
export const CASE_TODO_MORE_TEXT = "さらに表示";
export const CASE_TODO_TITLE_ERROR = `題名は1〜${CASE_TODO_TITLE_MAX_LENGTH}文字で入力してください`;

/** 進捗の読み上げ（パーセントは出さない。5-4 AC-4） */
export const todoProgressLabel = (progress: { done: number; total: number }) =>
  `${progress.total}項目中${progress.done}項目が完了`;

/** 無効な人（退職者）の名前。リンクは付けない（5-4 AC-6・C-75） */
export const retiredName = (name: string) => `${name}（退職者）`;
