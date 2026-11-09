// #201 AC-3: 一覧のクエリの422（after と cursor の同時指定・after 不正）の応答の形が、validate() が返す既存の422の形と一致すること。
// 基準：同じルートで、validate() の通常の経路（limit=0）が返す422。キーの集合・fields の型（重複のない文字列の配列）・入力値を含まないこと、を比べる。
// 方針：振る舞い（status・code・応答の形）で確かめ、文言の完全一致は使わない。データは架空（testuser_msgshape_、[UNIT_TEST]）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest, insertReadyUser } from "../../test/api-request";
import {
  insertDepartmentWithChannels,
  insertMember,
  type SeededDepartment,
} from "../../test/department-fixtures";
import { ZERO_ID, cleanupMessageScenario } from "../../test/message-fixtures";
import { encodeCursor } from "../lib/cursor";

let dept: SeededDepartment;
let token: string;

const get = (query: string) =>
  apiRequest("GET", `/api/rooms/${dept.dedicatedChannelId}/messages${query}`, {
    token,
  });

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  dept = await insertDepartmentWithChannels("メッセージ形");
  const user = await insertReadyUser("testuser_msgshape_001", dept.id);
  token = user.token;
  await insertMember(dept.dedicatedChannelId, user.userId);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupMessageScenario();
});

type ErrorBody = Record<string, unknown> & { fields?: unknown };

async function errorBodyOf(query: string) {
  const response = await get(query);
  expect(response.status).toBe(422);
  return (await response.json()) as ErrorBody;
}

describe("#201 AC-3 422 の fields の形（validate() の既存の形と一致）", () => {
  const cursor = encodeCursor({ v: ZERO_ID, id: ZERO_ID });

  it.each([
    ["after と cursor の同時指定", `?after=${ZERO_ID}&cursor=${cursor}`],
    ["壊れた after", "?after=broken"],
  ])(
    "#201 AC-3: %s の422は、validate() の通常の422と同じキーを持ち、fields は重複のない文字列の配列",
    async (_label, query) => {
      const reference = await errorBodyOf("?limit=0");
      const body = await errorBodyOf(query);
      expect(body.code).toBe("VALIDATION_ERROR");
      expect(Object.keys(body).sort()).toEqual(Object.keys(reference).sort());
      expect(Array.isArray(body.fields)).toBe(true);
      const fields = body.fields as unknown[];
      expect(fields.length).toBeGreaterThan(0);
      for (const field of fields) expect(typeof field).toBe("string");
      expect(new Set(fields).size).toBe(fields.length);
    },
  );

  it("#201 AC-3: fields は問題の項目の名前だけで、入力値（after・cursor の中身）を応答に含めない", async () => {
    const together = await errorBodyOf(`?after=${ZERO_ID}&cursor=${cursor}`);
    expect(together.fields).toEqual(["cursor"]);
    expect(JSON.stringify(together)).not.toContain(cursor);
    const broken = await errorBodyOf("?after=broken");
    expect(broken.fields).toEqual(["after"]);
    expect(JSON.stringify(broken)).not.toContain("broken");
  });

  it("#201 AC-3: after 不正と limit 不正を同時に出すと、fields は項目名を重複なく並べる（validate() の既存の形）", async () => {
    const body = await errorBodyOf("?after=broken&limit=0");
    const fields = body.fields as string[];
    expect([...fields].sort()).toEqual(["after", "limit"]);
  });
});
