// #201 AC-3: cursor.ts の入力検証の境界（ミューテーションで生き残った分岐）。振る舞い（受理・拒否・例外の有無・422の fields）で確かめる。
// 入力値の文言は見ない。データは架空。
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  cursorQuerySchema,
  decodeCursor,
  encodeCursor,
  toPage,
} from "./cursor";
import { handleError, handleNotFound } from "./error-handler";
import { validate } from "./validation";

const ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const fromJson = (json: string) => toBase64Url(new TextEncoder().encode(json));
const schema = cursorQuerySchema({ defaultLimit: 7 });
const accepted = (cursor: string) => schema.safeParse({ cursor }).success;
const rejectsDecode = (cursor: string) => {
  try {
    decodeCursor(cursor);
  } catch (e) {
    return (e as { code?: string }).code === "VALIDATION_ERROR";
  }
  return false;
};
// JSON.stringify は制御文字を \u0001（6バイト）にする。120個＋ASCII6個で JSON は 768 バイト＝base64 でちょうど1024文字
const sortValueOfLength = (ascii: number) =>
  `${"\u0001".repeat(120)}${"a".repeat(ascii)}`;

describe("#201 AC-3 cursorQuerySchema", () => {
  it("#201 AC-3: cursor・limit を省くと、指定した既定の limit になる", () => {
    expect(schema.parse({})).toEqual({ limit: 7 });
  });

  it.each([
    ["1", true],
    ["100", true],
    ["0", false],
    ["101", false],
  ])("#201 AC-3: limit=%s の受理は %s", (limit, ok) => {
    expect(schema.safeParse({ limit }).success).toBe(ok);
  });

  it("#201 AC-3: 正しい cursor は {v, id} に直して受け取る", () => {
    const text = encodeCursor({ v: "x", id: ID });
    expect(schema.parse({ cursor: text }).cursor).toEqual({ v: "x", id: ID });
  });

  it("#201 AC-3: 壊れた cursor は validate を通すと422で、fields は cursor だけ", async () => {
    const app = new Hono()
      .get("/x", validate("query", schema), (c) => c.json({}))
      .onError(handleError)
      .notFound(handleNotFound);
    const response = await app.request("/x?cursor=!!");
    expect(response.status).toBe(422);
    expect(((await response.json()) as { fields: string[] }).fields).toEqual([
      "cursor",
    ]);
  });
});

describe("#201 AC-3 cursor の長さの境界", () => {
  it("#201 AC-3: エンコード後がちょうど1024文字のカーソルは作れて、読み戻せる", () => {
    const payload = { v: sortValueOfLength(6), id: ID };
    const text = encodeCursor(payload);
    expect(text).toHaveLength(1024);
    expect(decodeCursor(text)).toEqual(payload);
    expect(accepted(text)).toBe(true);
  });

  it("#201 AC-3: エンコード後が1024文字を超えるカーソルは作れない（Error）", () => {
    expect(() => encodeCursor({ v: sortValueOfLength(7), id: ID })).toThrow(
      Error,
    );
  });

  it("#201 AC-3: 1024文字を超える入力は、中身が正しい JSON でも拒否する", () => {
    const text = fromJson(`{"v":"a","id":"${ID}"}${" ".repeat(900)}`);
    expect(text.length).toBeGreaterThan(1024);
    expect(rejectsDecode(text)).toBe(true);
    expect(accepted(text)).toBe(false);
  });

  it("#201 AC-3: 並び替えの値の文字列は128文字まで作れ、129文字からは作れない", () => {
    expect(() => encodeCursor({ v: "a".repeat(128), id: ID })).not.toThrow();
    expect(() => encodeCursor({ v: "a".repeat(129), id: ID })).toThrow(Error);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "#201 AC-3: 並び替えの値が有限でない数(%s)のカーソルは作れない（Error）",
    (v) => {
      expect(() => encodeCursor({ v, id: ID })).toThrow(Error);
    },
  );
});

describe("#201 AC-3 cursor のエンコードと復号", () => {
  it.each([0, 1, 2, 3, 4, 5, 6])(
    "#201 AC-3: 文字列が%s文字でも、= を含まず、読み戻せる（パディングの0・1・2個）",
    (length) => {
      const payload = { v: "a".repeat(length), id: ID };
      const text = encodeCursor(payload);
      expect(text).not.toContain("=");
      expect(decodeCursor(text)).toEqual(payload);
    },
  );

  it("#201 AC-3: 数値・日本語の並び替えの値も読み戻せる", () => {
    for (const v of [0, -3.5, 1700000000000, "テスト太郎"])
      expect(decodeCursor(encodeCursor({ v, id: ID }))).toEqual({ v, id: ID });
  });
});

describe("#201 AC-3 cursor の拒否", () => {
  const valid = encodeCursor({ v: "x", id: ID });

  it.each([
    ["先頭に空白", ` ${valid}`],
    ["末尾に空白", `${valid} `],
    ["途中に改行", `${valid.slice(0, 4)}\n${valid.slice(4)}`],
    ["使えない文字", `${valid}!`],
    ["先頭に使えない文字", `*${valid}`],
    ["= が3個", `${valid}===`],
    ["空文字", ""],
  ])("#201 AC-3: %s のカーソルは拒否する", (_label, text) => {
    expect(rejectsDecode(text)).toBe(true);
    expect(accepted(text)).toBe(false);
  });

  it("#201 AC-3: 不正な UTF-8 を含むカーソルは、置き換え文字に直さず拒否する", () => {
    const encoder = new TextEncoder();
    const text = toBase64Url(
      Uint8Array.from([
        ...encoder.encode('{"v":"'),
        0xff,
        ...encoder.encode(`","id":"${ID}"}`),
      ]),
    );
    expect(rejectsDecode(text)).toBe(true);
    expect(accepted(text)).toBe(false);
  });

  it.each([
    ["有限でない数（1e999）", `{"v":1e999,"id":"${ID}"}`],
    ["v が真偽値", `{"v":true,"id":"${ID}"}`],
    ["v がない", `{"id":"${ID}"}`],
    ["id が ULID でない", `{"v":"x","id":"abc"}`],
    ["id がない", `{"v":"x"}`],
    ["配列", `["x","${ID}"]`],
    ["null", "null"],
    ["文字列", `"x"`],
    ["JSON でない", "not json"],
  ])("#201 AC-3: 中身が%sのカーソルは拒否する", (_label, json) => {
    expect(rejectsDecode(fromJson(json))).toBe(true);
    expect(accepted(fromJson(json))).toBe(false);
  });
});

describe("#201 AC-3 toPage", () => {
  it("#201 AC-3: limit が0で行がある（呼び出しの誤り）ときは、カーソルを作らず Error を投げる", () => {
    expect(() => toPage([1], 0, () => ({ v: "x", id: ID }))).toThrow(Error);
  });
});
