// #284 AC-1・AC-2（計画 plan-284 の 7.1 の 1・3、10 の単体 T1〜T7a・T17）：切り替えの見張りと、セッションの公開。QueryClient だけで確かめる。
// 契約（実装の担当へ。計画で決めたもの）：
//   features/auth/index.ts が installUserSwitchGuard(queryClient) と publishSession(queryClient, session) を公開する。
//   installUserSwitchGuard：登録のときのセッションの user.id を覚える（捨てない）。クエリのキャッシュの通知のたびにセッションの user.id を読み、
//     覚えた ID と違う ID に替わったら、先に覚えた ID を更新してから、removeQueries でセッション以外のクエリを捨てる（同期）。
//     ID がない（401 の後）ときは何もしない（覚えた ID は消さない）。最初の ID（覚えた ID がない）では捨てない。mutation のキャッシュには触らない。
//     解除の関数を返す。
//   publishSession：セッションの進行中の取得を取り消してから（await）、setQueryData で書く。
// 応答の保留は手で解決する Promise で行う（固定の時間の待ちは使わない）。データはすべて架空。
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authKeys, installUserSwitchGuard, publishSession } from "./index";
import type { SessionInfo } from "./index";
import { createUnauthenticatedHandler } from "./unauthenticated-handler";

const USER_A = {
  id: "01JTEST284SESSA00000000001",
  displayName: "testuser_284_a",
  loginId: "testuser_284_a",
};
const USER_B = {
  id: "01JTEST284SESSB00000000001",
  displayName: "testuser_284_b",
  loginId: "testuser_284_b",
};
const A_TEXT = "[E2E_TEST]284Aの本文";
const B_TEXT = "[E2E_TEST]284Bの本文";

function sessionOf(
  user: typeof USER_A,
  reauthenticatedAt: string | null = null,
): SessionInfo {
  return {
    user,
    permissions: [],
    mustChangePassword: false,
    reauthenticatedAt,
  };
}

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** セッション以外のクエリのキー */
function otherKeys(client: QueryClient) {
  return client
    .getQueryCache()
    .getAll()
    .map((query) => query.queryKey)
    .filter((key) => JSON.stringify(key) !== JSON.stringify(authKeys.session));
}

/** A の利用者のデータとして、いろいろなキーを入れる（将来のキーを含む） */
function seedOthers(client: QueryClient) {
  client.setQueryData(
    ["rooms", "messages", "01JTEST284RQQM00000000001"],
    [A_TEXT],
  );
  client.setQueryData(["threads", "list"], [A_TEXT]);
  client.setQueryData(["future-key"], A_TEXT);
  client.setQueryData(["future-key", "nested", 1], A_TEXT);
}

const disposers: (() => void)[] = [];
function install(client: QueryClient) {
  const dispose = installUserSwitchGuard(client);
  disposers.push(dispose);
  return dispose;
}
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.restoreAllMocks();
});

describe("#284 切り替えの見張り（installUserSwitchGuard）", () => {
  it("#284 AC-1（T1）: A から B へセッションを直接上書きした直後（同期）に、セッション以外のクエリ（将来のキーを含む）が0件になり、破棄は一度だけ動く", () => {
    const client = newClient();
    client.setQueryData(authKeys.session, sessionOf(USER_A));
    seedOthers(client);
    const removeSpy = vi.spyOn(client, "removeQueries");
    install(client);
    expect(otherKeys(client)).toHaveLength(4);

    client.setQueryData(authKeys.session, sessionOf(USER_B));

    expect(otherKeys(client)).toEqual([]);
    expect(client.getQueryData(authKeys.session)).toEqual(sessionOf(USER_B));
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });

  it("#284 AC-1（T2）: 401 の処理でセッションを捨てた後に B を入れても、セッション以外のクエリを捨てる", () => {
    const client = newClient();
    client.setQueryData(authKeys.session, sessionOf(USER_A));
    seedOthers(client);
    install(client);
    const onUnauthenticated = createUnauthenticatedHandler({
      queryClient: client,
      navigate: () => undefined,
      currentPath: () => "/channels",
    });

    onUnauthenticated({
      status: 401,
      code: "UNAUTHENTICATED",
      message: "ログインしてください",
    });
    // 401 の時点では、セッション以外は残す（0-2 AC-8）
    expect(otherKeys(client)).toHaveLength(4);

    client.setQueryData(authKeys.session, sessionOf(USER_B));
    expect(otherKeys(client)).toEqual([]);
  });

  it("#284 AC-2（T3）: B に替わっても、mutation のキャッシュには触らない（A の mutation が残る）", () => {
    const client = newClient();
    client.setQueryData(authKeys.session, sessionOf(USER_A));
    client.getMutationCache().build(client, {
      mutationKey: ["test-mutation-284"],
      mutationFn: () => Promise.resolve(A_TEXT),
    });
    install(client);

    client.setQueryData(authKeys.session, sessionOf(USER_B));

    expect(
      client
        .getMutationCache()
        .getAll()
        .map((mutation) => mutation.options.mutationKey),
    ).toEqual([["test-mutation-284"]]);
  });

  it("#284 AC-2（T4）: A → 401 でセッションを捨てる → A を入れ直す、では何も捨てない", () => {
    const client = newClient();
    client.setQueryData(authKeys.session, sessionOf(USER_A));
    seedOthers(client);
    install(client);

    client.removeQueries({ queryKey: authKeys.session, exact: true });
    client.setQueryData(authKeys.session, sessionOf(USER_A));

    expect(otherKeys(client)).toHaveLength(4);
    expect(client.getQueryData(["future-key"])).toBe(A_TEXT);
  });

  it("#284 AC-2（T5）: 同じ A のセッションを別の内容で上書きしても、何も捨てない", () => {
    const client = newClient();
    client.setQueryData(authKeys.session, sessionOf(USER_A));
    seedOthers(client);
    install(client);

    client.setQueryData(
      authKeys.session,
      sessionOf(USER_A, "2026-11-18T00:00:00.000Z"),
    );

    expect(otherKeys(client)).toHaveLength(4);
  });

  it("#284 AC-2（T6）: 登録の時点で既に A がいるとき、登録だけでは捨てない。その後 B に替わると捨てる", () => {
    const client = newClient();
    client.setQueryData(authKeys.session, sessionOf(USER_A));
    seedOthers(client);

    install(client);
    client.setQueryData(["future-key", "after-install"], A_TEXT);
    expect(otherKeys(client)).toHaveLength(5);

    client.setQueryData(authKeys.session, sessionOf(USER_B));
    expect(otherKeys(client)).toEqual([]);
  });

  it("#284（T7）: セッションがない間に足されたキーは、最初の利用者の ID が入っても捨てない", () => {
    const client = newClient();
    install(client);
    client.setQueryData(["setup", "status"], { setupRequired: false });
    client.setQueryData(["future-key"], "未ログインの間のデータ");

    client.setQueryData(authKeys.session, sessionOf(USER_A));

    expect(otherKeys(client)).toHaveLength(2);
  });

  it("#284（T7）: 解除の後は、B に替わっても捨てない", () => {
    const client = newClient();
    client.setQueryData(authKeys.session, sessionOf(USER_A));
    seedOthers(client);
    const dispose = install(client);

    dispose();
    client.setQueryData(authKeys.session, sessionOf(USER_B));

    expect(otherKeys(client)).toHaveLength(4);
  });

  it("#284（T7）: clear() の後に B が入っても例外にならず、その後に足したキーは B のものとして残る", () => {
    const client = newClient();
    client.setQueryData(authKeys.session, sessionOf(USER_A));
    seedOthers(client);
    install(client);

    client.clear();
    expect(() =>
      client.setQueryData(authKeys.session, sessionOf(USER_B)),
    ).not.toThrow();
    client.setQueryData(["future-key"], B_TEXT);

    expect(client.getQueryData(["future-key"])).toBe(B_TEXT);
  });

  it("#284 AC-1（T7a）: 任意のキーの A の取得を保留したまま B に替え、A の応答を後から返しても、キャッシュに書き戻されず、B の取得の結果も変わらない", async () => {
    const client = newClient();
    client.setQueryData(authKeys.session, sessionOf(USER_A));
    install(client);
    const responseA = deferred<string>();
    const responseB = deferred<string>();
    // 取り消されると reject されるので、結果を値として受け取る（もみ消さず、後で確かめる）
    const fetchA = client
      .fetchQuery({
        queryKey: ["future-key"],
        queryFn: () => responseA.promise,
      })
      .then(
        (value) => ({ status: "resolved" as const, value }),
        (error: unknown) => ({ status: "rejected" as const, error }),
      );

    client.setQueryData(authKeys.session, sessionOf(USER_B));
    const fetchB = client.fetchQuery({
      queryKey: ["future-key"],
      queryFn: () => responseB.promise,
    });

    responseA.resolve(A_TEXT);
    const resultA = await fetchA;
    expect(resultA.status).toBe("rejected");
    expect(client.getQueryData(["future-key"])).toBeUndefined();

    responseB.resolve(B_TEXT);
    await expect(fetchB).resolves.toBe(B_TEXT);
    expect(client.getQueryData(["future-key"])).toBe(B_TEXT);
  });
});

describe("#284 セッションの公開（publishSession）", () => {
  it("#284 AC-1（T17）: A のセッションの取得を保留したまま B を書き込み、A の応答を後から返しても、セッションは B のまま", async () => {
    const client = newClient();
    const responseA = deferred<SessionInfo>();
    const fetchA = client
      .fetchQuery({
        queryKey: authKeys.session,
        queryFn: () => responseA.promise,
      })
      .then(
        () => "resolved" as const,
        () => "rejected" as const,
      );

    await publishSession(client, sessionOf(USER_B));
    expect(client.getQueryData(authKeys.session)).toEqual(sessionOf(USER_B));

    responseA.resolve(sessionOf(USER_A));
    await fetchA;
    expect(client.getQueryData(authKeys.session)).toEqual(sessionOf(USER_B));
  });
});
