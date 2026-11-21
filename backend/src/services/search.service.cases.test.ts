// #155（155-C）S-1：案件の検索の Service（searchCases）の権限（計画 4章：入口は authorize(perm.case.summary.view, 会社の範囲)。EP-5-07 の概要と同じ）。
// 期待：権限の判定は、権限の名前・範囲・主体まで、引数の完全一致で。拒否なら FORBIDDEN（403）で、Repository（読み取り）を呼ばない。
//   許可なら、閲覧者と検索語（Route が前後の空白を除いた値）・limit・cursor を、そのまま Repository に渡し、Repository の戻り値を変えずに返す。
//   表示の判定（can）は使わない（見える範囲は全案件で、権限で除く部屋がない）。
// 固定ロールはすべて perm.case.summary.view を持つため、拒否は偽の Authorizer で作る。偽の Repository は、本物の約束（{ items, nextCursor }）と同じ形を返す。
// 契約（実装前の仮置き。実装の担当へ）：backend/src/services/search.service.ts
//   createSearchService(repository: Pick<SearchRepository, "searchMessages"> & Pick<CaseRepository, "searchCases">, { authorizer })
//   searchCases(actor: { userId; traceId }, input: { q: string; limit: number; cursor?: CursorPayload })
//     → repository.searchCases({ actorId: actor.userId, term: input.q, limit: input.limit, cursor?: input.cursor })
// データは架空（testuser_ の ID の形の固定値）。
import { describe, expect, it } from "vitest";
import { AppError } from "../lib/app-error";
import type { CursorPayload } from "../lib/cursor";
import type { Permission } from "../lib/permissions";
import { createSearchService } from "./search.service";

const ACTOR = {
  userId: "01JTESTUSER155CSVC00000001",
  traceId: "unit-155c-search-service",
};

type AuthCall = {
  method: "authorize" | "can";
  userId: string | null;
  permission: Permission;
  scope: unknown;
};

function recordingAuthorizer(denied: readonly Permission[] = []) {
  const calls: AuthCall[] = [];
  return {
    calls,
    authorizer: {
      async authorize(
        principal: { userId: string } | null,
        permission: Permission,
        scope: unknown,
      ) {
        calls.push({
          method: "authorize",
          userId: principal?.userId ?? null,
          permission,
          scope,
        });
        if (denied.includes(permission))
          throw new AppError("FORBIDDEN", "この操作を行う権限がありません");
      },
      async can(
        principal: { userId: string } | null,
        permission: Permission,
        scope: unknown,
      ) {
        calls.push({
          method: "can",
          userId: principal?.userId ?? null,
          permission,
          scope,
        });
        return !denied.includes(permission);
      },
    },
  };
}

const PAGE = {
  items: [
    {
      id: "01JTESTCASE155CSVC00000001",
      caseNumber: "QZA-261121-0001",
      title: "[UNIT_TEST]155C検索の案件",
      status: "active" as const,
      client: {
        id: "01JTESTCLNT155CSVC00000001",
        name: "[UNIT_TEST]取引先",
        isActive: true,
      },
      departments: [
        {
          id: "01JTESTDEPT155CSVC00000001",
          name: "[UNIT_TEST]部署",
          isActive: true,
        },
      ],
      dueDate: null,
      progress: null,
      isParticipant: false,
      matchedIn: ["title" as const],
    },
  ],
  nextCursor: "CURSOR-155C",
};

function spyRepository() {
  const caseCalls: unknown[] = [];
  const messageCalls: unknown[] = [];
  return {
    caseCalls,
    messageCalls,
    repository: {
      async searchMessages(...args: unknown[]) {
        messageCalls.push(args);
        return { items: [], nextCursor: null };
      },
      async searchCases(input: unknown) {
        caseCalls.push(input);
        return PAGE;
      },
    },
  };
}

function serviceWith(denied: readonly Permission[] = []) {
  const auth = recordingAuthorizer(denied);
  const spy = spyRepository();
  const service = createSearchService(
    spy.repository as unknown as Parameters<typeof createSearchService>[0],
    {
      authorizer: auth.authorizer as unknown as Parameters<
        typeof createSearchService
      >[1]["authorizer"],
    },
  );
  return { service, ...auth, ...spy };
}

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

describe("#155 4-2 AC-1 155-C S-1 案件の検索の権限（Service）", () => {
  it("#155 S-1: 権限の判定は authorize(perm.case.summary.view, 会社の範囲) の1回だけ（主体・権限・範囲の完全一致。can は使わない）", async () => {
    const { service, calls } = serviceWith();
    await service.searchCases(ACTOR, { q: "見積書", limit: 20 });
    expect(calls).toEqual([
      {
        method: "authorize",
        userId: ACTOR.userId,
        permission: "perm.case.summary.view",
        scope: { type: "company" },
      },
    ]);
  });

  it("#155 S-1: perm.case.summary.view がなければ FORBIDDEN（403）で、Repository の読み取りを呼ばない", async () => {
    const { service, caseCalls, messageCalls } = serviceWith([
      "perm.case.summary.view",
    ]);
    const error = await errorOf(
      service.searchCases(ACTOR, { q: "見積書", limit: 20 }),
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("FORBIDDEN");
    expect(caseCalls).toEqual([]);
    expect(messageCalls).toEqual([]);
  });

  it("#155 S-1: メッセージの検索の権限（perm.search.message）がなくても、案件の検索は拒否しない（別の権限）", async () => {
    const { service, caseCalls } = serviceWith(["perm.search.message"]);
    expect(
      await service.searchCases(ACTOR, { q: "見積書", limit: 20 }),
    ).toEqual(PAGE);
    expect(caseCalls).toHaveLength(1);
  });

  it("#155 S-1: 許可なら、閲覧者・検索語・limit をそのまま Repository に渡し、戻り値を変えずに返す（cursor なし）", async () => {
    const { service, caseCalls } = serviceWith();
    expect(
      await service.searchCases(ACTOR, { q: "見積書", limit: 20 }),
    ).toEqual(PAGE);
    expect(caseCalls).toEqual([
      { actorId: ACTOR.userId, term: "見積書", limit: 20 },
    ]);
  });

  it("#155 S-1: cursor があれば、そのまま Repository に渡す", async () => {
    const { service, caseCalls } = serviceWith();
    const cursor: CursorPayload = {
      v: "01JTESTCASE155CSVC00000009",
      id: "01JTESTCASE155CSVC00000009",
    };
    await service.searchCases(ACTOR, { q: "QZA-2611", limit: 5, cursor });
    expect(caseCalls).toEqual([
      { actorId: ACTOR.userId, term: "QZA-2611", limit: 5, cursor },
    ]);
  });
});
