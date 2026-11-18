// 案件の TODO（#149）の題名の規則の定義元。バックエンドの検証と画面の入力チェックが、ここを参照する。サーバー側の検証は省略しない。
// 整形は件名と同じ規則（C-121）なので formatCaseTitle を使う。上限は C-90 の TODO の定めで、件名の上限とは変更理由が別のため別の定数にする。
import { z } from "zod";
import { formatCaseTitle } from "./case-rules";

/** 題名の最大文字数（UTF-16 の単位。C-90） */
export const CASE_TODO_TITLE_MAX_LENGTH = 100;

/** 整形したあとの題名を返す。1〜100 文字 */
export const caseTodoTitleSchema = z
  .string()
  .transform(formatCaseTitle)
  .pipe(
    z
      .string()
      .min(1)
      // 文字数は UTF-16 の単位で数える（zod の max はサロゲートペアを1文字と数えるため使わない）
      .refine((value) => value.length <= CASE_TODO_TITLE_MAX_LENGTH),
  );
