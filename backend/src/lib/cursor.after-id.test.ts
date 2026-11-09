// #201 AC-3: 「最後のID以降」の共通部品（cursor.ts の afterIdQuerySchema・toAfterIdPage）。他のIssueがそのまま使う。
// 既存の afterId（境界を含まない gt）の D1 結合は cursor.test.ts が確かめている。ここでは、新しい部品の入力検証とページの切り方を確かめる。
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { afterIdQuerySchema, toAfterIdPage } from "./cursor";
import { handleError, handleNotFound } from "./error-handler";
import { validate } from "./validation";

const VALID_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

describe("#201 AC-3 afterIdQuerySchema", () => {
  it("#201 AC-3: after は ULID を受け付け、limit の既定は100（PAGE_LIMIT.max）", () => {
    expect(afterIdQuerySchema.parse({ after: VALID_ID })).toEqual({
      after: VALID_ID,
      limit: 100,
    });
  });

  it.each([
    ["1", 1],
    ["100", 100],
    ["50", 50],
  ])("#201 AC-3: limit=%s は受け付け、数値に直す", (text, expected) => {
    expect(
      afterIdQuerySchema.parse({ after: VALID_ID, limit: text }).limit,
    ).toBe(expected);
  });

  it.each(["0", "101", "abc", "1.5", "-1"])(
    "#201 AC-3: limit=%s は拒否する",
    (limit) => {
      expect(
        afterIdQuerySchema.safeParse({ after: VALID_ID, limit }).success,
      ).toBe(false);
    },
  );

  it.each(["not-an-id", "01ARZ3NDEKTSV4RRFFQ69G5FA", "", "あいう"])(
    "#201 AC-3: ULID でない after %j は拒否する",
    (after) => {
      expect(afterIdQuerySchema.safeParse({ after }).success).toBe(false);
    },
  );

  it("#201 AC-3: 壊れた after は、validate を通すと 422 VALIDATION_ERROR（fields に after）になる", async () => {
    const app = new Hono()
      .get("/x", validate("query", afterIdQuerySchema), (c) => c.json({}))
      .onError(handleError)
      .notFound(handleNotFound);
    const response = await app.request("/x?after=broken");
    expect(response.status).toBe(422);
    const body = (await response.json()) as { code: string; fields: string[] };
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.fields).toContain("after");
  });
});

describe("#201 AC-3 toAfterIdPage", () => {
  it("#201 AC-3: limit+1 件あれば、limit 件に切って hasMore を真にする", () => {
    expect(toAfterIdPage([1, 2, 3, 4], 3)).toEqual({
      items: [1, 2, 3],
      hasMore: true,
    });
  });

  it.each([
    [[1, 2, 3], 3],
    [[1, 2], 3],
    [[], 3],
  ])("#201 AC-3: %j を limit=%i で切ると全件で hasMore は偽", (rows, limit) => {
    expect(toAfterIdPage(rows, limit)).toEqual({ items: rows, hasMore: false });
  });
});
