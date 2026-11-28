// #342 AC-3・AC-8（計画 plan342a2 の 3-1・3-5・3-7、7 節の U3、計画レビュー3回目の軽微2）：復元の後のセッションの直接の確かめ verifyDocumentSession()。
// 新しい GET /api/auth/session を直接1回送り（キャッシュ・進行中の取得に合流しない）、答えを、文書の利用者と比べて4つに分ける：
//   same（文書の利用者）・otherUser（別の利用者。切り替えの入口は、守りが試行の番号を照らしてから呼ぶので、ここでは呼ばない）・
//   unauthenticated（HTTP の状態が 401。コードによらない）・unknown（5xx・通信の失敗など、答えが無い）。応答の検証の失敗は投げる。
// 答えをセッションのキャッシュに書き戻さない。軽微2：セッションの直接の確かめは、409 の後の「同じ利用者が続いた回数」に触れない。
// 概要の取得の 409 は、既存の決まりどおり数える（case-access-verification.restore.test.ts）。
// データはすべて架空（testuser_342_・[UNIT_TEST]）。
// 前提にした口（実装の担当へ）：features/auth/verify-document-session.ts の
//   verifyDocumentSession(): Promise<"same" | "otherUser" | "unauthenticated" | "unknown">（文書の利用者は document-user.ts の getDocumentUserId()）
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server";
import { fetchSession } from "./api/auth-api";
import { authKeys } from "./api/query-keys";
import { installDocumentUser } from "./document-user";
import {
  confirmSessionUserAfterMismatch,
  createSessionUserMismatchHandler,
} from "./session-user-mismatch-handler";
import { verifyDocumentSession } from "./verify-document-session";

// ミューテーション診断の後の補い（T20〜T22）：API の失敗の形でない値で拒否されたときを作るため、取得の関数を、本物に委ねる差し替えにする
// （ふだんは本物のまま。テストの中で mockRejectedValueOnce したときだけ、その値で拒否する）
vi.mock("./api/auth-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api/auth-api")>();
  return { ...actual, fetchSession: vi.fn(actual.fetchSession) };
});

const USER_A = {
  id: "01JTESTUSER342A00000000003",
  displayName: "testuser_342_a",
  loginId: "testuser_342_a",
};
const USER_B = {
  id: "01JTESTUSER342B00000000003",
  displayName: "testuser_342_b",
  loginId: "testuser_342_b",
};

const sessionOf = (user: typeof USER_A) => ({
  user,
  permissions: [],
  mustChangePassword: false,
  reauthenticatedAt: null,
});

type Answer =
  | { kind: "user"; user: typeof USER_A }
  | { kind: "status"; status: number; code?: string }
  | { kind: "network" }
  | { kind: "invalid" };

let answers: Answer[];
let calls: number;
let client: QueryClient;
let stopDocumentUser: () => void;
let onOtherUser: ReturnType<typeof vi.fn<() => void>>;

function respond(answer: Answer) {
  switch (answer.kind) {
    case "user":
      return HttpResponse.json(sessionOf(answer.user));
    case "status":
      return HttpResponse.json(
        answer.code === undefined
          ? { message: "[UNIT_TEST]342コードなし" }
          : { code: answer.code, message: "[UNIT_TEST]342失敗" },
        { status: answer.status },
      );
    case "network":
      return HttpResponse.error();
    case "invalid":
      return HttpResponse.json({ user: { id: 342 } });
  }
}

beforeEach(() => {
  answers = [];
  calls = 0;
  server.use(
    http.get("/api/auth/session", () => {
      calls += 1;
      return respond(answers.shift() ?? { kind: "user", user: USER_A });
    }),
  );
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // アプリでは useSession が与える取得の関数（409 の後の取り直しが、手で置いたセッションの Query でも動くように）
  client.setQueryDefaults(authKeys.session, { queryFn: fetchSession });
  client.setQueryData(authKeys.session, sessionOf(USER_A));
  // 文書の利用者は A（最初に確定したセッションの利用者）
  stopDocumentUser = installDocumentUser(client);
  onOtherUser = vi.fn<() => void>();
  createSessionUserMismatchHandler({ queryClient: client, onOtherUser });
});
afterEach(() => {
  stopDocumentUser();
  client.clear();
});

describe("#342 AC-3 U3 セッションを直接取り直し、文書の利用者と比べる", () => {
  it("#342 AC-3 U3: 同じ利用者なら same。キャッシュがあっても新しい GET を1回送り、キャッシュに書き戻さない", async () => {
    const before = client.getQueryState(authKeys.session);
    await expect(verifyDocumentSession()).resolves.toBe("same");
    expect(calls).toBe(1);
    const after = client.getQueryState(authKeys.session);
    expect(after?.data).toBe(before?.data);
    expect(after?.dataUpdatedAt).toBe(before?.dataUpdatedAt);
  });

  it("#342 AC-3 U3: キャッシュは A のままでも、サーバーが B を返せば otherUser（キャッシュを答えにしない）。切り替えの入口は呼ばず、キャッシュも A のまま", async () => {
    answers.push({ kind: "user", user: USER_B });
    await expect(verifyDocumentSession()).resolves.toBe("otherUser");
    expect(onOtherUser).not.toHaveBeenCalled();
    expect(
      client.getQueryData<{ user: { id: string } }>(authKeys.session)?.user.id,
    ).toBe(USER_A.id);
  });

  it("#342 AC-3 U3: 2回呼べば、2回とも新しい GET を送る（前の答え・進行中の取得に合流しない）", async () => {
    answers.push(
      { kind: "user", user: USER_A },
      { kind: "user", user: USER_B },
    );
    await expect(verifyDocumentSession()).resolves.toBe("same");
    await expect(verifyDocumentSession()).resolves.toBe("otherUser");
    expect(calls).toBe(2);
  });
});

describe("#342 AC-8 U3 401 は、HTTP の状態で決める（コードによらない）", () => {
  it.each([
    ["UNAUTHENTICATED", "UNAUTHENTICATED"],
    ["別のコード", "SESSION_EXPIRED"],
    ["コードの欠落（UNKNOWN_ERROR に変換される）", undefined],
  ] as const)(
    "#342 AC-8 U3: 状態が 401（%s）なら unauthenticated",
    async (_label, code) => {
      answers.push({ kind: "status", status: 401, code });
      await expect(verifyDocumentSession()).resolves.toBe("unauthenticated");
    },
  );
});

describe("#342 AC-6 U3 答えが無い・確かめの例外", () => {
  it.each([
    ["500", { kind: "status", status: 500, code: "INTERNAL_ERROR" }],
    ["503", { kind: "status", status: 503, code: "SERVICE_UNAVAILABLE" }],
    [
      "403（ログイン切れではない）",
      { kind: "status", status: 403, code: "FORBIDDEN" },
    ],
    ["通信の失敗", { kind: "network" }],
  ] as [string, Answer][])(
    "#342 AC-6 U3: %sなら unknown（同じ利用者・未ログインとは扱わない）",
    async (_label, answer) => {
      answers.push(answer);
      await expect(verifyDocumentSession()).resolves.toBe("unknown");
    },
  );

  it("#342 AC-6 U3: 応答が契約に合わない（検証の失敗）なら、unknown にせず、投げる", async () => {
    answers.push({ kind: "invalid" });
    const outcome = await verifyDocumentSession().then(
      (value: unknown) => ({ resolved: value }),
      (error: unknown) => ({ rejected: error }),
    );
    expect(outcome).not.toHaveProperty("resolved");
    expect(outcome).toHaveProperty("rejected");
    // API の失敗の形（status・code）ではない
    expect((outcome as { rejected: unknown }).rejected).not.toMatchObject({
      status: expect.any(Number),
    });
  });
});

describe("#342 計画レビュー3回目の軽微2 セッションの直接の確かめは、409 の後の回数に触れない", () => {
  it("#342 AC-10 軽微2: 409 の後の取り直しで same が2回続いた後に、直接の確かめを何回しても、回数は増えも戻りもしない（3回目の 409 の後の same で unknown になる）", async () => {
    // 409 の後の取り直しが同じ利用者を返す（1回目・2回目は same）
    await expect(confirmSessionUserAfterMismatch()).resolves.toBe("same");
    await expect(confirmSessionUserAfterMismatch()).resolves.toBe("same");
    // 直接の確かめ（same・otherUser・unknown を混ぜる）
    answers.push(
      { kind: "user", user: USER_A },
      { kind: "user", user: USER_B },
      { kind: "network" },
    );
    await verifyDocumentSession();
    await verifyDocumentSession();
    await verifyDocumentSession();
    expect(client.getQueryState(authKeys.session)?.status).toBe("success");
    // 3回目の 409 の後の same は、既存の決まりどおり unknown（直接の確かめで、回数が戻っていない・増えていない）
    await expect(confirmSessionUserAfterMismatch()).resolves.toBe("unknown");
    expect(client.getQueryState(authKeys.session)?.status).toBe("error");
  });

  it("#342 AC-10 軽微2: 409 の後の same が1回の後に、直接の確かめを2回しても、次の 409 の後は same のまま（直接の確かめは回数に足さない）", async () => {
    await expect(confirmSessionUserAfterMismatch()).resolves.toBe("same");
    await verifyDocumentSession();
    await verifyDocumentSession();
    await expect(confirmSessionUserAfterMismatch()).resolves.toBe("same");
    expect(client.getQueryState(authKeys.session)?.status).toBe("success");
  });
});

// ミューテーション診断（2026-11-28）の後の補い。API の失敗（api-client が変換した形：status と code を持つオブジェクト、status は数値）だけを、
// 401 → unauthenticated・それ以外 → unknown に分ける。それ以外の値（実装の例外・形の違う値）は、答えが無いことにせず、同じ値のまま投げる（C-212 の (3)）
describe("#342 AC-6・AC-8 T20〜T22 API の失敗の形でない拒否は、同じ値のまま投げる", () => {
  function functionWithStatus() {
    const value = () => undefined;
    return Object.assign(value, { status: 401, code: "UNAUTHENTICATED" });
  }

  it.each([
    ["status が 401 だが code を持たないオブジェクト（T20）", { status: 401 }],
    [
      "code はあるが status が文字列のオブジェクト（T22）",
      { status: "401", code: "UNAUTHENTICATED" },
    ],
    ["null（T21）", null],
    ["undefined（T21）", undefined],
    ["文字列（T21）", "[UNIT_TEST]342拒否の文字列"],
    ["数値（T21）", 401],
    ["status と code を持つ関数（T21）", functionWithStatus()],
  ] as [string, unknown][])(
    "#342 AC-6・AC-8: セッションの取得が%sで拒否されたら、unauthenticated・unknown にせず、同じ値で拒否する",
    async (_label, rejection) => {
      vi.mocked(fetchSession).mockRejectedValueOnce(rejection);
      const outcome = await verifyDocumentSession().then(
        (value: unknown) => ({ resolved: value }),
        (error: unknown) => ({ rejected: error }),
      );
      expect(outcome).toStrictEqual({ rejected: rejection });
      if (typeof rejection === "function")
        expect((outcome as { rejected: unknown }).rejected).toBe(rejection);
    },
  );

  it("#342 AC-8 T20（対照）: API の失敗の形（status 401・code あり）なら unauthenticated", async () => {
    vi.mocked(fetchSession).mockRejectedValueOnce({
      status: 401,
      code: "UNAUTHENTICATED",
      message: "[UNIT_TEST]342",
    });
    await expect(verifyDocumentSession()).resolves.toBe("unauthenticated");
  });
});

describe("#342 AC-3 T23 文書の利用者が決まっていない", () => {
  it("#342 AC-3 T23: 文書の利用者が決まっていなければ、取得が成功しても unknown（same・otherUser・ほかの値にしない）", async () => {
    stopDocumentUser();
    // 解除の後も、後始末で二重に呼ばれて困らないよう、何もしない関数にしておく
    stopDocumentUser = () => undefined;
    answers.push({ kind: "user", user: USER_B });
    await expect(verifyDocumentSession()).resolves.toBe("unknown");
    answers.push({ kind: "user", user: USER_A });
    await expect(verifyDocumentSession()).resolves.toBe("unknown");
    expect(calls).toBe(2);
  });
});
