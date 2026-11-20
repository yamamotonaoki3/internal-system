// 案件の表示名（S-16・S-17）。
import {
  DEFAULT_PUBLICATION_VISIBILITY,
  PUBLICATION_VISIBILITIES,
  type PublicationVisibility,
} from "../../../../shared/attachment-rules";
import { CASE_TODO_TITLE_MAX_LENGTH } from "../../../../shared/case-todo-rules";
import type { AttachmentPublicationConfig } from "../messages";
import type { CaseAutoRole, CaseStatus } from "./api/case-api";

export const STATUS_LABELS: Readonly<Record<CaseStatus, string>> = {
  active: "進行中",
  closed: "終了",
};

/** 非参加者に出す文（サーバーの 403 の文言と同じ） */
export const PARTICIPANTS_ONLY_TEXT = "参加者だけが見られます（非公開）";

/** 表示中に外されたかを確かめる概要の取り直しが失敗したとき（#308）。中身を隠して再試行を出す */
export const CASE_ACCESS_UNVERIFIED_TEXT = "案件の情報を確かめられませんでした";

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
    body: "再開すると、追加した人にも、これまでのメッセージ・TODO・添付が共有されます。外れた人は、この案件の内容を見られなくなります。",
    confirm: "再開する",
    done: "案件を再開しました",
  },
} as const;

/** S-17 の内容の編集（#150 の 150-C）：ボタン・ダイアログ・欄のエラー・完了の表示 */
export const CASE_EDIT_TEXTS = {
  button: "内容を編集",
  title: "案件の内容の編集",
  caseNumber: "案件番号",
  save: "保存",
  cancel: "キャンセル",
  saved: "案件の内容を保存しました",
  formatted: "表記を整えて保存しました",
  titleError: "件名は1〜100文字で入力してください",
  descriptionError: "説明は2000文字以内で入力してください",
  clientError: "取引先を選んでください",
  departmentsError: "担当部署を1つ以上選んでください",
  preparing: "取引先・部署の候補を準備しています",
} as const;

/** S-17 の再開のダイアログ（#150 の 150-B）：参加者の選び直し（決定 Q2・Q5） */
export const CASE_REOPEN_TEXTS = {
  candidates: "再開の後も残す参加者",
  self: "再開する本人",
  searchHint: "名前で探して、再開と同時に参加者に追加できます",
  addedList: "追加する社員",
  next: "確認へ",
  back: "戻る",
  stay: "残る人",
  add: "追加する人",
  leave: "外れる人",
  none: "なし",
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

/** S-17 の TODO の編集・削除（#149 の 149-B）。409 の文言はサーバーと同じ（画面は理由を文言で見分ける） */
export const CASE_TODO_EDIT_TEXTS = {
  edit: "編集",
  delete: "削除",
  editTitle: "TODOの編集",
  save: "保存する",
  cancel: "キャンセル",
  updated: "TODOを更新しました",
  deleteTitle: "TODOの削除",
  deleteConfirm: "削除する",
  deleted: "TODOを削除しました",
  deleteBody: (title: string) => `「${title}」を削除します。`,
  todoDeleted: "このTODOは削除されています",
  todoChanged:
    "ほかの人が変更しました。最新の内容を確かめてから、もう一度操作してください",
  latestLoading: "最新の内容を読み込み中です",
  latestLoadFailed: "最新の内容を読み込めませんでした",
  latestOutOfPage:
    "最新の内容を読み込めませんでした。閉じてから、一覧で確かめてください",
  latest: (title: string, assignee: string) =>
    `最新の内容：${title}／担当：${assignee}`,
  retry: "再試行",
} as const;

/** S-17 の添付ファイル（#148） */
export const CASE_ATTACHMENTS_TEXTS = {
  heading: "添付ファイル",
  loading: "添付ファイルを読み込み中です",
  empty: "添付ファイルはありません",
  loadError: "添付ファイルを読み込めませんでした",
  moreError: "添付ファイルの続きを読み込めませんでした",
  retry: "再試行",
  jump: "元のメッセージへ",
  more: "次のページ",
  changeVisibility: (name: string) => `${name} の公開範囲を変更`,
  visibilityDialogTitle: "公開範囲を変更",
  visibilityGroup: "公開範囲",
  visibilitySubmit: "変更",
  visibilityCancel: "キャンセル",
  visibilityChanged: "公開範囲を変更しました",
} as const;

/** 案件の添付の公開範囲の名前（5-2 AC-8。添付するときの選択・一覧・変更で同じ名前） */
export const PUBLICATION_VISIBILITY_LABELS: Readonly<
  Record<PublicationVisibility, string>
> = {
  participants_only: "参加者限定",
  public_archive: "全社員公開アーカイブで公開できる",
};

/** 公開範囲の選択肢の近くに出す案内（公開できるの選択は即時公開ではない） */
export const PUBLICATION_VISIBILITY_HINT =
  "全社員公開が承認されるまでは、参加者だけが見られます";

export const PUBLICATION_VISIBILITY_OPTIONS = PUBLICATION_VISIBILITIES.map(
  (value) => ({ value, label: PUBLICATION_VISIBILITY_LABELS[value] }),
);

/** 案件の部屋の入力欄に渡す、添付の公開範囲の選択の設定 */
export const CASE_ATTACHMENT_PUBLICATION: AttachmentPublicationConfig = {
  options: PUBLICATION_VISIBILITY_OPTIONS,
  defaultValue: DEFAULT_PUBLICATION_VISIBILITY,
  hint: PUBLICATION_VISIBILITY_HINT,
};

/** 進捗の読み上げ（パーセントは出さない。5-4 AC-4） */
export const todoProgressLabel = (progress: { done: number; total: number }) =>
  `${progress.total}項目中${progress.done}項目が完了`;

/** 終了の確認に出す、未完了の TODO の件数の警告（#309） */
export const closeTodoWarning = (count: number) =>
  `未完了の TODO が ${count} 件あります`;

/** 無効な人（退職者）の名前。リンクは付けない（5-4 AC-6・C-75） */
export const retiredName = (name: string) => `${name}（退職者）`;
