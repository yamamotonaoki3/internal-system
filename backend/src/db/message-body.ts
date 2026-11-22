// 本文の保存の表し方（#270・C-205）。本文のない投稿（添付だけの投稿）は、本文の列に見えない目印を保存する（migration を足さない。利用者の決定1）。
// 目印を知っているのはこのファイルだけ。API・画面は本文なしを空文字でやり取りし、目印を外へ出さない。
// 本文を読む処理を足すときは fromStoredBody を通し、SQL で目印を比べるときは storedBodyIsEmpty を使う（目印の値を直接書かない）。
import { sql, type SQL } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";
import { isBlankMessageBody } from "../../../shared/message-rules";

/** 本文なしの目印（半角の空白1文字）。空白だけの入力は空と同じ意味なので（#201 U-2）、利用者の入力と意味が重ならない */
const EMPTY_BODY_MARKER = " " as const;

/** API の本文 → DB の本文。空白だけなら目印、それ以外は送られたまま（前後の空白は削らない） */
export function toStoredBody(body: string): string {
  return isBlankMessageBody(body) ? EMPTY_BODY_MARKER : body;
}

/** DB の本文が目印（本文なし）か。目印と完全に等しいときだけ真 */
export function isStoredEmptyBody(stored: string): boolean {
  return stored === EMPTY_BODY_MARKER;
}

/** DB の本文 → API の本文。目印だけを空文字にする */
export function fromStoredBody(stored: string): string {
  return isStoredEmptyBody(stored) ? "" : stored;
}

/**
 * 投稿・返信の書き込みの守り：本文なし（目印）で添付がなければ、DB に送る前に止める（呼び出し側の誤り。成功に見せない）。
 * 本文なしでも、batch の結び付けの件数の確かめ（attachment.repository.ts の bindAttachments）で、添付が1件以上結び付くことは守られる
 */
export function assertBodyOrAttachments(
  storedBody: string,
  attachmentIds: readonly string[] | undefined,
): void {
  if (isStoredEmptyBody(storedBody) && (attachmentIds ?? []).length === 0)
    throw new Error("本文も添付もない投稿は作れません");
}

/** SQL の断片：本文の列が目印か（値はパラメータで渡す） */
export function storedBodyIsEmpty(column: SQL | AnyColumn): SQL {
  return sql`${column} = ${EMPTY_BODY_MARKER}`;
}
