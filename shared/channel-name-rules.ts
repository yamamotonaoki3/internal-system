// チャンネルの作成申請（#131。2-2 AC-4・AC-13）の入力規則の定義元。バックエンドの検証と画面の入力チェックが、ここを参照する。
// サーバー側の検証は省略しない。重複判定の比較キーは department-rules.ts の channelNameKey を使う（定義を増やさない）。
import { z } from "zod";

/** チャンネル名の最大文字数（UTF-16 の単位。2-2 AC-13） */
export const CHANNEL_NAME_MAX_LENGTH = 50;
/** チャンネルの説明の最大文字数（2-2 AC-13） */
export const CHANNEL_DESCRIPTION_MAX_LENGTH = 500;
/** 却下の理由の最大文字数（2-2 AC-4） */
export const REJECT_REASON_MAX_LENGTH = 200;

const FULL_WIDTH_OFFSET = 0xfee0;

/**
 * 全角の英数字・「－」・「＿」を半角にし、前後の空白（全角空白を含む）を除く（C-121 の確定）。
 * NFKC は行わない：半角カナ・丸数字・全角記号は変えない（使えない文字として検証で拒否する）。
 */
export function formatChannelName(raw: string): string {
  return raw
    .trim()
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - FULL_WIDTH_OFFSET),
    )
    .replace(/－/g, "-")
    .replace(/＿/g, "_");
}

// 使える文字：ひらがな U+3041–3096、カタカナ U+30A1–30FA、長音符、漢字、「々」「〆」、半角英数字、「-」「_」（C-117・C-120）
// 漢字は利用者の決定により CJK 統合漢字とその拡張だけ（Unicode の Unified_Ideograph）。互換漢字・部首は見た目が同じ別の文字のため不可
const NAME_CHARACTERS =
  /^[ぁ-ゖァ-ヺー\p{Unified_Ideograph}々〆A-Za-z0-9_-]+$/u;

/** 整形したあとの名前を返す。1〜50 文字で、使える文字だけ */
export const channelRequestNameSchema = z
  .string()
  .transform(formatChannelName)
  .pipe(
    z
      .string()
      .min(1)
      // 文字数は UTF-16 の単位で数える（このバージョンの zod の max は 𠮷 を 1 文字と数え、26 個が通ってしまうため使わない）
      .refine((value) => value.length <= CHANNEL_NAME_MAX_LENGTH)
      .regex(NAME_CHARACTERS),
  );

export const channelRequestDescriptionSchema = z
  .string()
  .refine((value) => value.length <= CHANNEL_DESCRIPTION_MAX_LENGTH);

/** 前後の空白を除いたあとで 1〜200 文字 */
export const rejectReasonSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => value.length <= REJECT_REASON_MAX_LENGTH);
