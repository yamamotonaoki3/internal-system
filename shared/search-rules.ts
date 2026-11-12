import { z } from "zod";

/** 検索のキーワードの最大文字数（V-34・C-90）。前後の空白を除いてから、UTF-16 の単位で数える（他の入力と同じ） */
export const SEARCH_KEYWORD_MAX_LENGTH = 100;

// 前後の空白（全角を含む）を除いた値を返す。空・空白だけは拒否する。記号の無害化は SQL を組む側で行う
export const searchKeywordSchema = z
  .string()
  .trim()
  .min(1, "検索する言葉を入力してください")
  .max(
    SEARCH_KEYWORD_MAX_LENGTH,
    `検索する言葉は${SEARCH_KEYWORD_MAX_LENGTH}文字以内で入力してください`,
  );
