// 案件（#146）の件名・説明・納期の規則の定義元。バックエンドの検証と画面の入力チェックが、ここを参照する。
// サーバー側の検証は省略しない。「納期が今日以降」の判定は、サーバーが jstDateOf で行う（画面も同じ関数で事前に確かめる）。
import { z } from "zod";

/** 件名の最大文字数（UTF-16 の単位。C-90） */
export const CASE_TITLE_MAX_LENGTH = 100;
/** 説明の最大文字数（C-90） */
export const CASE_DESCRIPTION_MAX_LENGTH = 2000;

const FULL_WIDTH_OFFSET = 0xfee0;
// ハイフン類（U+2010〜2015・マイナス記号・全角ハイフン・小さいハイフン）。長音符「ー」と波ダッシュは含めない
const HYPHENS = /[‐-―−－﹣]/g;

/**
 * 件名の整形（C-121・C-144 の案）：全角の英数字を半角にし、ハイフン類を「-」にし、
 * 連続する空白（全角空白を含む）を半角の空白1つにして、前後の空白を除く。かなは変えない。
 */
export function formatCaseTitle(raw: string): string {
  return raw
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - FULL_WIDTH_OFFSET),
    )
    .replace(HYPHENS, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** 整形したあとの件名を返す。1〜100 文字 */
export const caseTitleSchema = z
  .string()
  .transform(formatCaseTitle)
  .pipe(
    z
      .string()
      .min(1)
      // 文字数は UTF-16 の単位で数える（zod の max はサロゲートペアを1文字と数えるため使わない）
      .refine((value) => value.length <= CASE_TITLE_MAX_LENGTH),
  );

export const caseDescriptionSchema = z
  .string()
  .refine((value) => value.length <= CASE_DESCRIPTION_MAX_LENGTH);

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 日本時間（UTC＋9時間）の日付。date は YYYY-MM-DD、yymmdd は案件番号の採番（146-B）で使う */
export function jstDateOf(now: Date): {
  date: string;
  year: number;
  yymmdd: string;
} {
  const date = new Date(now.getTime() + JST_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
  return {
    date,
    year: Number(date.slice(0, 4)),
    yymmdd: date.slice(2).replace(/-/g, ""),
  };
}

function isRealDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined)
    return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/** 納期：YYYY-MM-DD の形で、実在する日付 */
export const caseDueDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealDate);

/** 納期が日本時間の今日より前か（YYYY-MM-DD は文字列の順が日付の順と同じ） */
export function isDueDateBeforeToday(dueDate: string, now: Date): boolean {
  return dueDate < jstDateOf(now).date;
}

/**
 * 案件番号の検索で、ハイフンとして取り除く文字（#155 の利用者の決定）：
 * 「-」・全角のハイフン（U+FF0D）・長音符（U+30FC）・マイナス記号（U+2212）・ハイフン（U+2010）・エンダッシュ（U+2013）・エムダッシュ（U+2014）。
 * 件名の整形の HYPHENS とは対象が違う（U+2015 などは決定に入っていないため含めない）
 */
const CASE_NUMBER_SEARCH_HYPHENS = /[-－ー−‐–—]/g;
/** 半角に直す全角の英数字 */
const FULL_WIDTH_ALPHANUMERIC = /[０-９Ａ-Ｚａ-ｚ]/g;

/**
 * 案件番号の検索のキー（C-117・C-120・#155 の利用者の決定）：前後の空白（全角を含む）を除き、全角の英数字を半角に直し、
 * ハイフンにあたる文字を位置に依らず除き、英字を大文字にする。途中の空白は全角・半角とも保つ（途中に空白のある語は番号に一致させない）。
 * NFKC は使わない（途中の全角の空白まで変わるため）。空になったら、番号では探さない
 */
export function caseNumberSearchKey(term: string): string {
  return term
    .trim()
    .replace(FULL_WIDTH_ALPHANUMERIC, (char) =>
      String.fromCharCode(char.charCodeAt(0) - FULL_WIDTH_OFFSET),
    )
    .replace(CASE_NUMBER_SEARCH_HYPHENS, "")
    .replace(/[a-z]/g, (char) => char.toUpperCase());
}
