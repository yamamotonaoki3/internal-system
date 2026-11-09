// カーソル方式の共通部品（ADR-0006）。「最後の(並び替えの値, ID)の組より後」を取るため、OFFSETを使わず、同じ値が続いても重複・欠落しない。
// 使い方：limit+1 件を取得して toPage に渡す。一覧の件数は、この部品の上限（PAGE_LIMIT.max）で切る。
import { eq, gt, lt, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "./app-error";
import { isUlid, type Ulid } from "./ulid";

/** 1ページの件数（C-90・ADR-0006） */
export const PAGE_LIMIT = { message: 50, default: 20, max: 100 } as const;

const MAX_CURSOR_LENGTH = 1024;
// v の文字列の上限。日本語（3バイト）でもエンコード後が MAX_CURSOR_LENGTH に収まる長さ
const MAX_SORT_VALUE_LENGTH = 128;
const CURSOR_CHARS = /^[A-Za-z0-9_\-+/]+={0,2}$/;

// v は並び替えの値（有限の数値か文字列）。
export type CursorPayload = { v: string | number; id: Ulid };

// decode できないカーソルは作らない：作れない値は Error を投げる（呼び出し側の実装の誤り）
export function encodeCursor(payload: CursorPayload): string {
  const { v } = payload;
  if (typeof v === "string" && v.length > MAX_SORT_VALUE_LENGTH)
    throw new Error("カーソルの並び替えの値が長すぎます");
  if (typeof v === "number" && !Number.isFinite(v))
    throw new Error("カーソルの並び替えの値が有限の数ではありません");
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const base64 = btoa(String.fromCharCode(...bytes));
  const encoded = base64
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  if (encoded.length > MAX_CURSOR_LENGTH)
    throw new Error("カーソルが長すぎます");
  return encoded;
}

// 壊れた入力は null。入力値は応答にもログにも出さない
function parseCursor(text: string): CursorPayload | null {
  if (text.length > MAX_CURSOR_LENGTH || !CURSOR_CHARS.test(text)) return null;
  try {
    const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const json = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(binary, (c) => c.charCodeAt(0)),
    );
    const value: unknown = JSON.parse(json);
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return null;
    const { v, id } = value as Record<string, unknown>;
    const validV =
      typeof v === "string" || (typeof v === "number" && Number.isFinite(v));
    if (!validV) return null;
    if (!isUlid(id)) return null;
    return { v, id };
  } catch {
    // base64・UTF-8・JSONとして読めない入力は、壊れたカーソルとして扱う（呼び出し側が422にする）
    return null;
  }
}

export function decodeCursor(text: string): CursorPayload {
  const payload = parseCursor(text);
  if (payload === null)
    throw new AppError("VALIDATION_ERROR", "入力内容を確かめてください", {
      fields: ["cursor"],
    });
  return payload;
}

/** 一覧APIのクエリ（cursor・limit）の検証。validate("query", ...) に渡す */
export function cursorQuerySchema(options: { defaultLimit: number }) {
  return z.object({
    cursor: z
      .string()
      .max(MAX_CURSOR_LENGTH)
      .transform((text, ctx) => {
        const payload = parseCursor(text);
        if (payload === null) {
          ctx.issues.push({ code: "custom", message: "invalid", input: text });
          return z.NEVER;
        }
        return payload;
      })
      .optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(PAGE_LIMIT.max)
      .default(options.defaultLimit),
  });
}

/** (並び替えの値, ID) の組が、カーソルより後ろ（昇順は大きい側、降順は小さい側）の行の条件 */
export function afterCursor(
  cols: { sort: AnyColumn; id: AnyColumn },
  cursor: CursorPayload,
  dir: "asc" | "desc",
): SQL {
  const compare = dir === "asc" ? gt : lt;
  return sql`(${compare(cols.sort, cursor.v)} or (${eq(cols.sort, cursor.v)} and ${compare(cols.id, cursor.id)}))`;
}

/** IDだけで昇順に読む一覧の条件（境界のIDは含めない） */
export function afterId(idColumn: AnyColumn, after: string): SQL {
  if (!isUlid(after))
    throw new AppError("VALIDATION_ERROR", "入力内容を確かめてください", {
      fields: ["after"],
    });
  return gt(idColumn, after);
}

/** 「最後のID以降」の一覧のクエリ（after・limit）の検証。validate("query", ...) に渡す */
export const afterIdQuerySchema = z.object({
  after: z.string().refine(isUlid),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGE_LIMIT.max)
    .default(PAGE_LIMIT.max),
});

/** limit+1 件を取得した結果から、「最後のID以降」の1ページ分と、続きがあるかを作る */
export function toAfterIdPage<T>(
  rows: T[],
  limit: number,
): { items: T[]; hasMore: boolean } {
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}

/** limit+1 件を取得した結果から、1ページ分と次ページのカーソルを作る */
export function toPage<T>(
  rows: T[],
  limit: number,
  toCursor: (row: T) => CursorPayload,
): { items: T[]; nextCursor: string | null } {
  if (rows.length <= limit) return { items: rows, nextCursor: null };
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  if (last === undefined) throw new Error("limit は1以上にしてください");
  return { items, nextCursor: encodeCursor(toCursor(last)) };
}
