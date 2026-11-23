// #298 AC-5: 競合（版の衝突・重複）の判定 isConflictError。HTTP ステータスだけでなく、エラーのコード CONFLICT で判定する。
// 後の変更で、サーバーが別のコードの 409（SESSION_USER_MISMATCH）を返すようになるため、409 だけでは競合と見なさない。
// データは架空。期待値は仕様（ステータス 409 かつ コード CONFLICT のときだけ真）から決めている。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { apiClient, isConflictError, type ApiError } from "./api-client";

const apiError = (status: number, code: string): ApiError => ({
  status,
  code,
  message: "[UNIT_TEST_298]メッセージ",
});

describe("#298 AC-5: isConflictError（ApiError の形のエラー）", () => {
  it("#298 AC-5: 409 かつ CONFLICT は真", () => {
    expect(isConflictError(apiError(409, "CONFLICT"))).toBe(true);
  });

  it("#298 AC-5: 409 かつ SESSION_USER_MISMATCH は偽（別の利用者のセッションの食い違いは、競合ではない）", () => {
    expect(isConflictError(apiError(409, "SESSION_USER_MISMATCH"))).toBe(false);
  });

  it.each([
    ["空のコード", ""],
    ["UNKNOWN_ERROR（コードが読めなかったときの値）", "UNKNOWN_ERROR"],
    ["別のコード", "[UNIT_TEST_298]OTHER"],
    ["小文字の conflict（コードの比較は大文字小文字を区別する）", "conflict"],
  ])("#298 AC-5: 409 でコードが %s は偽", (_label, code) => {
    expect(isConflictError(apiError(409, code))).toBe(false);
  });

  it("#298 AC-5: 409 でコードの項目がないエラーは偽", () => {
    expect(
      isConflictError({ status: 409, message: "[UNIT_TEST_298]コードなし" }),
    ).toBe(false);
  });

  it.each([400, 401, 403, 404, 422, 429, 500, 503, 0])(
    "#298 AC-5: ステータスが %i で CONFLICT は偽（ステータスも 409 でなければならない）",
    (status) => {
      expect(isConflictError(apiError(status, "CONFLICT"))).toBe(false);
    },
  );

  it("#298 AC-5: 409 かつ CONFLICT で、fields・追加の項目があっても真", () => {
    expect(
      isConflictError({
        ...apiError(409, "CONFLICT"),
        fields: ["name"],
      }),
    ).toBe(true);
  });
});

describe("#298 AC-5: isConflictError（ApiError でないもの）", () => {
  it.each([
    ["Error", new Error("[UNIT_TEST_298]通信失敗")],
    ["undefined", undefined],
    ["null", null],
    ["文字列 CONFLICT", "CONFLICT"],
    ["文字列 409", "409"],
    ["数値 409", 409],
    ["真偽値", true],
    ["空のオブジェクト", {}],
    ["配列", [409, "CONFLICT"]],
  ])("#298 AC-5: %s は偽（例外を投げない）", (_label, value) => {
    expect(isConflictError(value)).toBe(false);
  });

  it('#298 AC-5: status が文字列の "409" で CONFLICT は偽（ステータスは数値の 409 だけ）', () => {
    expect(
      isConflictError({
        status: "409",
        code: "CONFLICT",
        message: "[UNIT_TEST_298]文字列のステータス",
      }),
    ).toBe(false);
  });
});

describe("#298 AC-5: isConflictError（apiClient が変換した実際のエラー）", () => {
  const server = setupServer(
    http.get("*/api/conflict", () =>
      HttpResponse.json(
        { code: "CONFLICT", message: "[UNIT_TEST_298]競合" },
        { status: 409 },
      ),
    ),
    http.get("*/api/mismatch", () =>
      HttpResponse.json(
        {
          code: "SESSION_USER_MISMATCH",
          message: "[UNIT_TEST_298]別の利用者",
        },
        { status: 409 },
      ),
    ),
    http.get("*/api/plain409", () => new HttpResponse("oops", { status: 409 })),
    http.get("*/api/other", () =>
      HttpResponse.json(
        { code: "CONFLICT", message: "[UNIT_TEST_298]ほかのステータス" },
        { status: 422 },
      ),
    ),
  );

  beforeAll(() => {
    // テスト用の画面の場所と同じドメインにそろえる（別のドメインだと、ブラウザの通信の制限で止められる）
    apiClient.defaults.baseURL = `${window.location.origin}/api`;
    server.listen();
  });
  afterAll(() => server.close());

  const fail = (path: string) =>
    apiClient.get(path).then(
      () => {
        throw new Error("成功してはいけない");
      },
      (e: unknown) => e,
    );

  it("#298 AC-5: 409 CONFLICT の応答は、変換後のエラーで真", async () => {
    expect(isConflictError(await fail("/conflict"))).toBe(true);
  });

  it("#298 AC-5: 409 SESSION_USER_MISMATCH の応答は、変換後のエラーで偽", async () => {
    expect(isConflictError(await fail("/mismatch"))).toBe(false);
  });

  it("#298 AC-5: 本文が JSON でない 409 は、変換後のエラーで偽（コードは UNKNOWN_ERROR になる）", async () => {
    expect(isConflictError(await fail("/plain409"))).toBe(false);
  });

  it("#298 AC-5: CONFLICT でもステータスが 409 でない応答は、変換後のエラーで偽", async () => {
    expect(isConflictError(await fail("/other"))).toBe(false);
  });
});
