// #155（155-A）AC-4・D-8 の権限：メッセージの検索の Service（計画 4.3「検索の規則（スレッドの一覧と同じ作り）」）。
// 期待：入口は perm.search.message（R-58）。なければ FORBIDDEN（403）で、Repository を呼ばない。
//   perm.dm.message.view がなければ DM を除く条件（includeDirect=false）、perm.case.view がなければ案件の部屋を除く条件（includeCase=false）を
//   Repository に渡し、検索そのものは成功させる（thread.service と同じ。表示の判定なので can を使ってよい）。
// 固定ロールはすべてこれらの権限を持つため、外し方は dm-fixtures の fakeAuthorizer（指定した権限だけを FORBIDDEN／false にする）。
// Repository の代役は、本物の約束（{ items, nextCursor }）と同じ形を返す。本物の Repository での除外は search.repository.db.test.ts で確かめる。
// 契約（実装前の仮置き。実装の担当へ）：
//   backend/src/services/search.service.ts
//     createSearchService(repository: Pick<SearchRepository, "searchMessages">, { authorizer }) / withSearchService(env, actor, run)
//     searchMessages(actor: { userId: string; traceId: string }, input: {
//       q: string; limit: number; cursor?: CursorPayload; roomId?: string; from?: string; to?: string;
//     }): Promise<{ items: ...; nextCursor: string | null }>
// データは架空（testuser_ の ID の形の固定値）。
import { describe, expect, it } from "vitest";
import { fakeAuthorizer } from "../../test/dm-fixtures";
import { AppError } from "../lib/app-error";
import type { Permission } from "../lib/permissions";
import { createSearchService } from "./search.service";

const ACTOR = {
  userId: "01JTESTUSER155SVC000000001",
  traceId: "unit-155-search-service",
};

type RepositoryCall = {
  viewerId: string;
  options: { term: string; includeDirect: boolean; includeCase: boolean };
};

function spyRepository() {
  const calls: RepositoryCall[] = [];
  return {
    calls,
    repository: {
      async searchMessages(
        viewerId: string,
        options: RepositoryCall["options"] & Record<string, unknown>,
      ) {
        calls.push({ viewerId, options });
        return { items: [], nextCursor: null };
      },
    },
  };
}

function serviceWith(denied: readonly Permission[]) {
  const authorizer = fakeAuthorizer(denied);
  const spy = spyRepository();
  const service = createSearchService(
    spy.repository as unknown as Parameters<typeof createSearchService>[0],
    { authorizer },
  );
  return { service, authorizer, calls: spy.calls };
}

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

describe("#155 AC-4 D-8 検索の権限（Service）", () => {
  it("#155 AC-4 D-8: perm.search.message がなければ FORBIDDEN（403）で、Repository を呼ばない", async () => {
    const { service, authorizer, calls } = serviceWith(["perm.search.message"]);
    const error = await errorOf(
      service.searchMessages(ACTOR, { q: "見積書", limit: 20 }),
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("FORBIDDEN");
    expect(calls).toEqual([]);
    expect(authorizer.calls).toContainEqual({
      userId: ACTOR.userId,
      permission: "perm.search.message",
    });
  });

  it("#155 AC-4 D-8: 権限がすべてあれば、DM・案件の部屋を含める条件で、閲覧者と検索語を渡す", async () => {
    const { service, calls } = serviceWith([]);
    expect(
      await service.searchMessages(ACTOR, { q: "見積書", limit: 20 }),
    ).toEqual({ items: [], nextCursor: null });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.viewerId).toBe(ACTOR.userId);
    expect(calls[0]?.options).toMatchObject({
      term: "見積書",
      includeDirect: true,
      includeCase: true,
    });
  });

  it("#155 AC-4 D-8: perm.dm.message.view がなければ、DM を除く条件を渡し、検索は成功する（403 にしない）", async () => {
    const { service, calls } = serviceWith(["perm.dm.message.view"]);
    expect(
      await service.searchMessages(ACTOR, { q: "見積書", limit: 20 }),
    ).toEqual({ items: [], nextCursor: null });
    expect(calls[0]?.options).toMatchObject({
      includeDirect: false,
      includeCase: true,
    });
  });

  it("#155 AC-4 D-8: perm.case.view がなければ、案件の部屋を除く条件を渡し、検索は成功する（403 にしない）", async () => {
    const { service, calls } = serviceWith(["perm.case.view"]);
    expect(
      await service.searchMessages(ACTOR, { q: "見積書", limit: 20 }),
    ).toEqual({ items: [], nextCursor: null });
    expect(calls[0]?.options).toMatchObject({
      includeDirect: true,
      includeCase: false,
    });
  });

  it("#155 AC-4 D-8: 両方がなければ、両方を除く条件を渡す", async () => {
    const { service, calls } = serviceWith([
      "perm.dm.message.view",
      "perm.case.view",
    ]);
    await service.searchMessages(ACTOR, { q: "見積書", limit: 20 });
    expect(calls[0]?.options).toMatchObject({
      includeDirect: false,
      includeCase: false,
    });
  });
});
