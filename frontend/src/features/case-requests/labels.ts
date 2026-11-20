// 申請の状態の表示名（S-18 の自分の申請）と、件名の欄の注意の文（申請の画面と、案件の内容の編集〔S-17〕が使う）。
import type { CaseRequestStatus } from "./api/case-request-api";

export const STATUS_LABELS: Readonly<Record<CaseRequestStatus, string>> = {
  pending: "承認待ち",
  approved: "承認済み",
  rejected: "却下",
  withdrawn: "取り下げ済み",
  auto_cancelled: "自動取消",
};

/** 件名の欄の注意の文（件名は参加者以外にも見えるため） */
export const TITLE_CAUTION =
  "件名は参加していない人にも見える場合があります。機密情報を書かないでください";
