import { z } from "zod";

/** 検索のキーワードの最大文字数（V-34・C-90）。前後の空白を除いてから、UTF-16 の単位で数える（他の入力と同じ） */
export const SEARCH_KEYWORD_MAX_LENGTH = 100;

// 前後の空白（全角を含む）を除いた値を返す。空・空白だけは拒否する。記号の無害化は SQL を組む側で行う
export const searchKeywordSchema = z
  .string()
  .trim()
  .min(1, "検索する言葉を入力してください")
  // 文字数は UTF-16 の単位で数える（zod の max はサロゲートペアを1文字と数えるため使わない）
  .refine(
    (value) => value.length <= SEARCH_KEYWORD_MAX_LENGTH,
    `検索する言葉は${SEARCH_KEYWORD_MAX_LENGTH}文字以内で入力してください`,
  );

/**
 * 検索の方式の境目（C-152(2)・ADR-0010・D-3）。語のコードポイント数がこれ以上なら trigram の MATCH、未満なら instr で探す。
 * trigram は3文字の組で索引するため、2文字以下の MATCH はエラーにならずに0件を返す。上限（UTF-16 の単位）とは数え方が違うので別に持つ
 */
export const SEARCH_TRIGRAM_MIN_CODE_POINTS = 3;
