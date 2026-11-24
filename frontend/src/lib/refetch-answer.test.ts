// #298 AC-6・AC-8（docs/design/auth-session.md の refetch-answer の行、docs/design/cases.md の useCaseAccessLoss の行、統括の決定 decision-298-2b の 3・4）：
// 取り直しの答えは、取り直しの間にその Query に届いた更新の種類で見分ける。
//   取得の成功が1つだけ（失敗なし）→ data、取得の失敗が1つだけ（成功なし）→ error、
//   手での書き換えが混ざった・取得の答えが1つに決まらない（成功と失敗の両方が届いた等）→ none（見分けられないので、呼び出し側が安全な側に倒す）。
// 本物の QueryClient で確かめる。データはすべて架空（[UNIT_TEST]）。
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { refetchAnswerOf } from "./refetch-answer";

const KEY = ["[UNIT_TEST]298", "refetch-answer"] as const;
const failure = { status: 500, code: "INTERNAL_ERROR", message: "[UNIT_TEST]" };

function setUp() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData([...KEY], "[UNIT_TEST]前の値");
  const query = client
    .getQueryCache()
    .find({ queryKey: [...KEY], exact: true });
  if (query === undefined) throw new Error("準備の Query がない");
  const succeed = (value: string) =>
    client.fetchQuery({
      queryKey: [...KEY],
      queryFn: () => Promise.resolve(value),
      staleTime: 0,
    });
  const fail = () =>
    client
      .fetchQuery({
        queryKey: [...KEY],
        queryFn: () => Promise.reject(failure),
        staleTime: 0,
      })
      .catch(() => undefined);
  return { client, query, succeed, fail };
}

describe("#298 AC-6・AC-8 取り直しの答えの見分け（refetchAnswerOf）", () => {
  it("#298 AC-8: 取得の成功が1つだけなら、その値を data として返す", async () => {
    const t = setUp();
    await expect(
      refetchAnswerOf(t.client, t.query, () =>
        t.succeed("[UNIT_TEST]新しい値"),
      ),
    ).resolves.toEqual({ kind: "data", data: "[UNIT_TEST]新しい値" });
  });

  it("#298 AC-8: 取得の失敗が1つだけなら、その失敗を error として返す", async () => {
    const t = setUp();
    await expect(refetchAnswerOf(t.client, t.query, t.fail)).resolves.toEqual({
      kind: "error",
      error: failure,
    });
  });

  it("#298 AC-8（決定4）: 取り直しの間に、取得の失敗と成功の両方が届いたら、どちらの答えか決まらないので none（data にも error にもしない）", async () => {
    const t = setUp();
    await expect(
      refetchAnswerOf(t.client, t.query, async () => {
        await t.fail();
        await t.succeed("[UNIT_TEST]新しい値");
      }),
    ).resolves.toEqual({ kind: "none" });
  });

  it("#298 AC-8（決定4）: 取得の成功と失敗の順が逆でも none", async () => {
    const t = setUp();
    await expect(
      refetchAnswerOf(t.client, t.query, async () => {
        await t.succeed("[UNIT_TEST]新しい値");
        await t.fail();
      }),
    ).resolves.toEqual({ kind: "none" });
  });

  it("#298 AC-6（決定3・4）: 取り直しの間に手での書き換えが混ざったら、取得の成功があっても none", async () => {
    const t = setUp();
    await expect(
      refetchAnswerOf(t.client, t.query, async () => {
        t.client.setQueryData([...KEY], "[UNIT_TEST]手で書いた値");
        await t.succeed("[UNIT_TEST]新しい値");
      }),
    ).resolves.toEqual({ kind: "none" });
  });

  it("#298 AC-8: ほかの Query に届いた更新は、答えに数えない（取得が無ければ none）", async () => {
    const t = setUp();
    await expect(
      refetchAnswerOf(t.client, t.query, () =>
        t.client.fetchQuery({
          queryKey: ["[UNIT_TEST]298", "ほかの Query"],
          queryFn: () => Promise.resolve("[UNIT_TEST]別の値"),
        }),
      ),
    ).resolves.toEqual({ kind: "none" });
  });
});
