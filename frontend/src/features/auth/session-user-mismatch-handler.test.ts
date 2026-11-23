// #298 AC-4・AC-6（計画 plan-298 改訂3 の 2-6、8-1 の AC-4 の session-user-mismatch-handler の行、8-1b の「2-6 の繰り返し」の行、
// 計画レビュー4回目の軽微1・3）：409 SESSION_USER_MISMATCH を受けたら、セッションを1回だけ取り直し、結果を4つに分ける。
//   switched：別の利用者が返った。渡された切り替えの入口（onOtherUser）を、結果を返す前に1回呼ぶ
//   same：文書の利用者 A が返った。入口は呼ばない
//   unauthenticated：401。既存の 401 の処理が動く。入口は呼ばない
//   unknown：5xx・通信の失敗。セッションのクエリをエラーにする（RequireAuth が「ログイン状態を確認できませんでした」と再試行を出し、中身を隠す。Q5）
// 同時の 409 は、進行中の1つの取り直しにまとめる（Promise の合流）。409 を受けた呼び出し元は、取り直しを待たずに失敗を受け取る。
// 下書き（端末の保存）は、どの結果でも消さない。
// 【2回目】統括の決定（decision-298-2b）の 2（same が続けて3回目で unknown・数を戻す条件・同時の 409 は1回）、3（進行中が無いときは新しく始める・
//   取り消されたときは、その時点のセッションが別の利用者なら switched、それ以外は unknown。セッションのクエリを失敗にしない）、
//   6（ログアウトの直後の 409 は、ふつうの 409 と同じ）を足した。「取り直しは2秒に最大1回」は、決定2で取り下げたので確かめない。
//   1回目の「4回目までに unknown」は、決定2の「3回目」に直した（1回目に作った、まだ main に無いテスト）。
// 本物の QueryClient・api-client と、MSW の応答（保留できる）で確かめる。固定の時間の待ちは使わない。
// 文書ごとの状態（進行中の取り直し・続いた回数）を持つので、各テストで vi.resetModules して新しい文書として読み込む。
// 前提にした口（実装の担当へ）：
//   features/auth/session-user-mismatch-handler.ts の
//     createSessionUserMismatchHandler({ queryClient, onOtherUser: () => void }): (error: ApiError) => void
//       （main.tsx が services/api-client.ts の setSessionUserMismatchHandler に渡す）
//     confirmSessionUserAfterMismatch(): Promise<"switched" | "same" | "unauthenticated" | "unknown">
//       （進行中の取り直しがあれば合流し、無ければ始める。資格の確かめ（useCaseAccessLoss）が待つ。features/auth の index からも公開する）
//   取り直しは、セッションのクエリ（["auth", "session"]）を通して行う（取得の数は GET /api/auth/session の回数で数える）
// 期待の値（コード・文）は、本番の定義から取り込まず、ここにリテラルで書く。データはすべて架空（testuser_298_・[UNIT_TEST]）。
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server";

const USER_A = "01JTESTUSER298A00000000003";
const USER_B = "01JTESTUSER298B00000000003";
const SESSION_KEY = ["auth", "session"] as const;
const DRAFT_KEY = `internal-system:draft:v1:${USER_A}:room:01JTESTROOM298000000000001`;

type Outcome = "switched" | "same" | "unauthenticated" | "unknown";
type Served = "A" | "B" | 401 | 500 | "network";

function sessionOf(id: string) {
  return {
    user: { id, displayName: `testuser_298_${id.slice(-3)}`, loginId: id },
    permissions: [],
    mustChangePassword: false,
    reauthenticatedAt: null,
  };
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** 模擬のサーバー。セッションの取得は served を返し（hold があれば保留する）、取得の回数を数える。食い違いの要求は常に 409 */
function respondWorld() {
  const world = {
    served: "A" as Served,
    hold: null as Promise<void> | null,
    sessionFetches: 0,
  };
  server.use(
    http.get("/api/auth/session", async () => {
      world.sessionFetches += 1;
      if (world.hold !== null) await world.hold;
      const served = world.served;
      if (served === "A") return HttpResponse.json(sessionOf(USER_A));
      if (served === "B") return HttpResponse.json(sessionOf(USER_B));
      if (served === "network") return HttpResponse.error();
      if (served === 401)
        return HttpResponse.json(
          { code: "UNAUTHENTICATED", message: "ログインしてください" },
          { status: 401 },
        );
      return HttpResponse.json(
        { code: "INTERNAL_ERROR", message: "x" },
        { status: 500 },
      );
    }),
    http.get("/api/[UNIT_TEST]298-mismatch", () =>
      HttpResponse.json(
        { code: "SESSION_USER_MISMATCH", message: "x" },
        { status: 409 },
      ),
    ),
  );
  return world;
}

/** 新しい文書として読み込み、main.tsx と同じく登録し、A のセッションを取得済みの状態にする */
async function setUp() {
  vi.resetModules();
  const api = await import("../../services/api-client");
  const authApi = await import("./api/auth-api");
  const handler = await import("./session-user-mismatch-handler");
  const world = respondWorld();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onOtherUser = vi.fn();
  const onUnauthenticated = vi.fn();
  api.setUnauthenticatedHandler(onUnauthenticated);
  api.setSessionUserMismatchHandler(
    handler.createSessionUserMismatchHandler({
      queryClient: client,
      onOtherUser,
    }),
  );
  await client.fetchQuery({
    queryKey: SESSION_KEY,
    queryFn: authApi.fetchSession,
  });
  world.sessionFetches = 0;
  window.localStorage.setItem(
    DRAFT_KEY,
    JSON.stringify({ body: "[UNIT_TEST]298書きかけ", updatedAt: Date.now() }),
  );
  /** 食い違いの要求を1回送り、失敗（409）を受け取るまで待つ */
  const mismatch = () =>
    api.apiClient.get("/[UNIT_TEST]298-mismatch").then(
      () => {
        throw new Error("成功してはいけない");
      },
      (error: unknown) => error,
    );
  return {
    api,
    handler,
    world,
    client,
    onOtherUser,
    onUnauthenticated,
    mismatch,
  };
}

const sessionUserId = (client: QueryClient) =>
  client.getQueryData<ReturnType<typeof sessionOf>>(SESSION_KEY)?.user.id;

describe("#298 AC-4・AC-6 409 の後のセッションの取り直しの結果", () => {
  it("#298 AC-4: 取り直しが B を返す：switched。切り替えの入口を、結果を返す前に1回だけ呼ぶ。下書きは残る", async () => {
    const t = await setUp();
    t.world.served = "B";
    const order: string[] = [];
    t.onOtherUser.mockImplementation(() => order.push("entry"));
    await t.mismatch();
    const outcome = await t.handler
      .confirmSessionUserAfterMismatch()
      .then((value: Outcome) => {
        order.push("outcome");
        return value;
      });
    expect(outcome).toBe("switched");
    expect(t.onOtherUser).toHaveBeenCalledTimes(1);
    // 入口を呼んだ後に結果が返る（2-6：入口が waiting になった後に返す）
    expect(order).toEqual(["entry", "outcome"]);
    expect(t.world.sessionFetches).toBe(1);
    expect(sessionUserId(t.client)).toBe(USER_B);
    expect(window.localStorage.getItem(DRAFT_KEY)).not.toBeNull();
  });

  it("#298 AC-6: 取り直しが A（文書の利用者）を返す：same。入口を呼ばない", async () => {
    const t = await setUp();
    t.world.served = "A";
    await t.mismatch();
    expect(await t.handler.confirmSessionUserAfterMismatch()).toBe("same");
    expect(t.onOtherUser).not.toHaveBeenCalled();
    expect(t.world.sessionFetches).toBe(1);
    expect(window.localStorage.getItem(DRAFT_KEY)).not.toBeNull();
  });

  it("#298 AC-6: 取り直しが 401：unauthenticated。既存の 401 の処理が動き、入口を呼ばない", async () => {
    const t = await setUp();
    t.world.served = 401;
    await t.mismatch();
    expect(await t.handler.confirmSessionUserAfterMismatch()).toBe(
      "unauthenticated",
    );
    expect(t.onUnauthenticated).toHaveBeenCalledTimes(1);
    expect(t.onUnauthenticated.mock.calls[0]?.[0]).toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
    });
    expect(t.onOtherUser).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(DRAFT_KEY)).not.toBeNull();
  });

  it.each([500, "network"] as const)(
    "#298 AC-4（Q5）: 取り直しが %s：unknown。セッションのクエリがエラーになり（RequireAuth が中身を隠して再試行を出す条件）、入口を呼ばない。下書きは残る",
    async (served) => {
      const t = await setUp();
      t.world.served = served;
      await t.mismatch();
      expect(await t.handler.confirmSessionUserAfterMismatch()).toBe("unknown");
      expect(t.client.getQueryState(SESSION_KEY)?.status).toBe("error");
      expect(t.onOtherUser).not.toHaveBeenCalled();
      expect(window.localStorage.getItem(DRAFT_KEY)).not.toBeNull();
    },
  );
});

describe("#298 AC-6 同時の 409 と、取り直しのまとめ方（計画レビュー4回目の軽微3）", () => {
  it("#298 AC-6: 取り直しを保留している間も、409 を受けた呼び出し元は、待たずに失敗（SESSION_USER_MISMATCH）を受け取る", async () => {
    const t = await setUp();
    const gate = deferred();
    t.world.hold = gate.promise;
    // 保留を解かないまま、呼び出し元の失敗が届く（取り直しを待つと、ここで止まって時間切れになる）
    expect(await t.mismatch()).toMatchObject({
      status: 409,
      code: "SESSION_USER_MISMATCH",
    });
    gate.release();
    await t.handler.confirmSessionUserAfterMismatch();
  });

  it("#298 AC-6: 取り直しの最中に 409 が3件届いても、セッションの取得は1回。合流したすべての確かめが、同じ結果を受け取る", async () => {
    const t = await setUp();
    const gate = deferred();
    t.world.hold = gate.promise;
    t.world.served = "B";
    await Promise.all([t.mismatch(), t.mismatch(), t.mismatch()]);
    const outcomes = Promise.all([
      t.handler.confirmSessionUserAfterMismatch(),
      t.handler.confirmSessionUserAfterMismatch(),
      t.handler.confirmSessionUserAfterMismatch(),
    ]);
    gate.release();
    expect(await outcomes).toEqual(["switched", "switched", "switched"]);
    expect(t.world.sessionFetches).toBe(1);
    expect(t.onOtherUser).toHaveBeenCalledTimes(1);
  });

  it("#298 AC-6: 取り直しが終わった後に届いた 409 は、新しい取り直しを1回始める", async () => {
    const t = await setUp();
    await t.mismatch();
    expect(await t.handler.confirmSessionUserAfterMismatch()).toBe("same");
    expect(t.world.sessionFetches).toBe(1);
    await t.mismatch();
    await t.handler.confirmSessionUserAfterMismatch();
    expect(t.world.sessionFetches).toBe(2);
  });

  it("#298 AC-6: 409 を受けていない状態で確かめを求めると、取り直しを1回始めて結果を返す（資格の確かめが先に求めた場合）", async () => {
    const t = await setUp();
    t.world.served = "B";
    expect(await t.handler.confirmSessionUserAfterMismatch()).toBe("switched");
    expect(t.world.sessionFetches).toBe(1);
    expect(t.onOtherUser).toHaveBeenCalledTimes(1);
  });
});

/** 409 を1回受け、その後の確かめの結果を受け取る（完了した取り直し1回分） */
async function cycle(t: Awaited<ReturnType<typeof setUp>>): Promise<Outcome> {
  await t.mismatch();
  return t.handler.confirmSessionUserAfterMismatch();
}

describe("#298 AC-6 same が続く（計画 2-6 の繰り返しの防止。統括の決定 decision-298-2b の2）", () => {
  // 数える単位は、完了した取り直し。same が続けて3回目になったら、その回を unknown として扱う（中身を隠し、再試行を出す）。
  // 数を戻すのは、same 以外の結果・unknown を返した後・最後の same から 30 秒、409 が無かったとき。
  it("#298 AC-6（決定2）: 取り直しが A を返し続けると、1・2回目は same、3回目は unknown になり、セッションのクエリがエラーになる。入口は呼ばず、下書きは残る", async () => {
    const t = await setUp();
    t.world.served = "A";
    const outcomes: Outcome[] = [];
    for (let n = 0; n < 3; n += 1) outcomes.push(await cycle(t));
    expect(outcomes).toEqual(["same", "same", "unknown"]);
    expect(t.client.getQueryState(SESSION_KEY)?.status).toBe("error");
    expect(t.world.sessionFetches).toBe(3);
    expect(t.onOtherUser).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(DRAFT_KEY)).not.toBeNull();
  });

  it("#298 AC-6（決定2）: 同時に届いた 409 は1回と数える：3件同時 → same、続けて1件 → same、続けて1件 → unknown", async () => {
    const t = await setUp();
    t.world.served = "A";
    // 3件を、1つの取り直しの最中に届ける（取り直しを保留する）
    const gate = deferred();
    t.world.hold = gate.promise;
    await Promise.all([t.mismatch(), t.mismatch(), t.mismatch()]);
    const first = Promise.all([
      t.handler.confirmSessionUserAfterMismatch(),
      t.handler.confirmSessionUserAfterMismatch(),
      t.handler.confirmSessionUserAfterMismatch(),
    ]);
    t.world.hold = null;
    gate.release();
    expect(await first).toEqual(["same", "same", "same"]);
    expect(t.world.sessionFetches).toBe(1);
    expect(await cycle(t)).toBe("same");
    expect(await cycle(t)).toBe("unknown");
  });

  it("#298 AC-6（決定2）: same 以外の結果（unauthenticated）で数が戻る：same・same・unauthenticated の後は、same・same と続き、その次が unknown", async () => {
    const t = await setUp();
    t.world.served = "A";
    expect(await cycle(t)).toBe("same");
    expect(await cycle(t)).toBe("same");
    t.world.served = 401;
    expect(await cycle(t)).toBe("unauthenticated");
    t.world.served = "A";
    expect(await cycle(t)).toBe("same");
    expect(await cycle(t)).toBe("same");
    expect(await cycle(t)).toBe("unknown");
  });

  it("#298 AC-6（決定2）: same 以外の結果（500 の unknown）で数が戻る：same・unknown の後は、same・same と続き、その次が unknown", async () => {
    const t = await setUp();
    t.world.served = "A";
    expect(await cycle(t)).toBe("same");
    t.world.served = 500;
    expect(await cycle(t)).toBe("unknown");
    t.world.served = "A";
    expect(await cycle(t)).toBe("same");
    expect(await cycle(t)).toBe("same");
    expect(await cycle(t)).toBe("unknown");
  });

  it("#298 AC-6（決定2）: 3回目で unknown を返した後は数が戻る：次は same・same、その次が unknown", async () => {
    const t = await setUp();
    t.world.served = "A";
    for (let n = 0; n < 3; n += 1) await cycle(t);
    expect(await cycle(t)).toBe("same");
    expect(await cycle(t)).toBe("same");
    expect(await cycle(t)).toBe("unknown");
  });

  describe("最後の same からの時間（偽の時計）", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("#298 AC-6（決定2）: 最後の same から 30 秒、409 が無ければ数が戻る：same・same・（30 秒）・same", async () => {
      const t = await setUp();
      t.world.served = "A";
      expect(await cycle(t)).toBe("same");
      expect(await cycle(t)).toBe("same");
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await cycle(t)).toBe("same");
    });

    it("#298 AC-6（決定2）: 30 秒より短い間（29 秒）なら数は戻らない：same・same・（29 秒）・unknown", async () => {
      // 偽の時計は、実の時間の経過も足す（shouldAdvanceTime）ので、境界の 1 ミリ秒ではなく、1 秒の余裕をとる
      const t = await setUp();
      t.world.served = "A";
      expect(await cycle(t)).toBe("same");
      expect(await cycle(t)).toBe("same");
      await vi.advanceTimersByTimeAsync(29_000);
      expect(await cycle(t)).toBe("unknown");
    });
  });
});

describe("#298 AC-6 進行中の取り直しが無い・取り消された（統括の決定 decision-298-2b の3）", () => {
  it("#298 AC-6（決定3）: 進行中の取り直しが無いときに結果を求めると、新しく始める（取り直しの後に求めても、もう1回取る）", async () => {
    const t = await setUp();
    t.world.served = "A";
    expect(await cycle(t)).toBe("same");
    expect(t.world.sessionFetches).toBe(1);
    // 409 を受けずに求める：新しく始める（終わった取り直しの結果を使い回さない）
    t.world.served = "B";
    expect(await t.handler.confirmSessionUserAfterMismatch()).toBe("switched");
    expect(t.world.sessionFetches).toBe(2);
  });

  /** 取り直しを保留したまま 409 を受け、取り直しが始まるまで待つ。結果を求めた Promise を返す */
  async function startHeldRefetch(t: Awaited<ReturnType<typeof setUp>>) {
    const gate = deferred();
    t.world.hold = gate.promise;
    await t.mismatch();
    await vi.waitFor(() => expect(t.world.sessionFetches).toBe(1));
    const outcome = t.handler.confirmSessionUserAfterMismatch();
    return { gate, outcome };
  }

  it("#298 AC-6（決定3）: 取り直しが、ほかの処理に取り消され（cancelQueries）、その時点のセッションが A のまま：unknown。取り消しを理由に、セッションのクエリを失敗にしない", async () => {
    const t = await setUp();
    const held = await startHeldRefetch(t);
    await t.client.cancelQueries({ queryKey: SESSION_KEY, exact: true });
    expect(await held.outcome).toBe("unknown");
    expect(t.client.getQueryState(SESSION_KEY)?.status).not.toBe("error");
    expect(sessionUserId(t.client)).toBe(USER_A);
    expect(t.onUnauthenticated).not.toHaveBeenCalled();
    held.gate.release();
  });

  it("#298 AC-6（決定3）: 取り直しが取り消され、その時点のセッションが別の利用者（B）：switched。セッションのクエリを失敗にしない", async () => {
    const t = await setUp();
    const held = await startHeldRefetch(t);
    // 取り消しで元に戻った直後（同じ通知の中）に、B のセッションを書く（ログインの publishSession と同じ並び：取り消し → 書く）
    const stop = t.client.getQueryCache().subscribe((event) => {
      if (
        event.type === "updated" &&
        JSON.stringify(event.query.queryKey) === JSON.stringify(SESSION_KEY) &&
        event.query.state.fetchStatus === "idle"
      ) {
        stop();
        t.client.setQueryData(SESSION_KEY, sessionOf(USER_B));
      }
    });
    await t.client.cancelQueries({ queryKey: SESSION_KEY, exact: true });
    expect(await held.outcome).toBe("switched");
    expect(t.client.getQueryState(SESSION_KEY)?.status).not.toBe("error");
    expect(sessionUserId(t.client)).toBe(USER_B);
    held.gate.release();
  });

  it("#298 AC-6（決定3）: 取り直しが、セッションの破棄（removeQueries）で取り消される：その時点のセッションが無いので unknown。セッションを失敗の状態で作り直さない", async () => {
    const t = await setUp();
    const held = await startHeldRefetch(t);
    t.client.removeQueries({ queryKey: SESSION_KEY, exact: true });
    expect(await held.outcome).toBe("unknown");
    expect(t.client.getQueryState(SESSION_KEY)?.status).not.toBe("error");
    expect(t.onOtherUser).not.toHaveBeenCalled();
    held.gate.release();
  });
});

describe("#298 AC-6 ログアウトの直後の 409（統括の決定 decision-298-2b の6）", () => {
  it("#298 AC-6（決定6）: ログアウトでキャッシュを消した（queryClient.clear）直後に 409 が届いても、ふつうの 409 と同じく取り直し、401 なら unauthenticated で、既存の 401 の処理が1回動く。入口は呼ばない", async () => {
    const t = await setUp();
    t.client.clear();
    t.world.served = 401;
    expect(await cycle(t)).toBe("unauthenticated");
    expect(t.world.sessionFetches).toBe(1);
    expect(t.onUnauthenticated).toHaveBeenCalledTimes(1);
    expect(t.onOtherUser).not.toHaveBeenCalled();
  });
});
