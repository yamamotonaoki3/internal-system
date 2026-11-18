// 案件の表示名（S-16・S-17）。
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
