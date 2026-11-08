import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { TEST_PASSWORD, TEST_USER } from "../../../test/auth-handlers";
import { server } from "../../../test/server";
import { fetchSession } from "../api/auth-api";
import { authKeys } from "../api/query-keys";
import { usePasswordChange } from "./usePasswordChange";

const SESSION = {
  user: TEST_USER,
  mustChangePassword: false,
  reauthenticatedAt: null,
};
const INPUT = { currentPassword: TEST_PASSWORD, newPassword: "Different456!" };

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(authKeys.session, SESSION);
  const hook = renderHook(() => usePasswordChange(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  return { ...hook, client };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("#123 0-3 AC-1/4 遅延応答と実行時の検証（レビュー回帰）", () => {
  it.each(["logout", "401", "unmount"] as const)(
    "#123 0-3 AC-4: %s後の遅延成功で認証情報を復活させない",
    async (reason) => {
      const response = deferred<Response>();
      const received = deferred<void>();
      server.use(
        http.put("/api/me/password", () => {
          received.resolve();
          return response.promise;
        }),
      );
      const { result, client, unmount } = setup();
      let pending!: Promise<unknown>;
      act(() => {
        pending = result.current(INPUT).then(
          () => "success",
          () => "rejected",
        );
      });
      await received.promise;
      if (reason === "logout") client.clear();
      if (reason === "401")
        client.removeQueries({ queryKey: authKeys.session });
      if (reason === "unmount") unmount();
      const before = client.getQueryData(authKeys.session);
      const changes: string[] = [];
      const unsubscribe = client.getQueryCache().subscribe((event) => {
        if (
          event.type === "updated" &&
          JSON.stringify(event.query.queryKey) ===
            JSON.stringify(authKeys.session)
        )
          changes.push(event.type);
      });
      try {
        await act(async () => {
          response.resolve(HttpResponse.json(SESSION));
          await pending;
        });
      } finally {
        unsubscribe();
      }
      expect(changes).toEqual([]);
      expect(client.getQueryData(authKeys.session)).toBe(before);
    },
  );

  it.each([
    ["空の応答", {}],
    ["利用者なし", { ...SESSION, user: null }],
    [
      "社員IDなし",
      {
        ...SESSION,
        user: { id: TEST_USER.id, displayName: TEST_USER.displayName },
      },
    ],
    ["初回変更の型違い", { ...SESSION, mustChangePassword: "false" }],
    ["再認証時刻の型違い", { ...SESSION, reauthenticatedAt: 123 }],
    ["不正な日時", { ...SESSION, reauthenticatedAt: "invalid" }],
  ])(
    "#123 0-3 AC-1: 200でも%sを拒否しsession cacheを変えない",
    async (_name, body) => {
      server.use(http.put("/api/me/password", () => HttpResponse.json(body)));
      const { result, client } = setup();
      let outcome: unknown;
      await act(async () => {
        outcome = await result.current(INPUT).then(
          () => "success",
          () => "rejected",
        );
      });
      expect(outcome).toBe("rejected");
      expect(client.getQueryData(authKeys.session)).toEqual(SESSION);
    },
  );
});

describe("#192 AC-6: パスワード変更後の取引先管理権限", () => {
  it("#192 AC-6: PUT応答に権限がなくても同一利用者の現行権限を保持しsessionを再検証対象にする", async () => {
    server.use(http.put("/api/me/password", () => HttpResponse.json(SESSION)));
    const { result, client } = setup();
    client.setQueryData(authKeys.session, {
      ...SESSION,
      permissions: ["perm.client.manage"],
    });
    await act(async () => {
      await result.current(INPUT);
    });
    expect(client.getQueryData(authKeys.session)).toMatchObject({
      user: TEST_USER,
      permissions: ["perm.client.manage"],
    });
    expect(
      client.getQueryCache().find({ queryKey: authKeys.session, exact: true })
        ?.state.isInvalidated,
    ).toBe(true);
  });

  it("#192 AC-6: 再検証したGET sessionの権限剥奪をcacheへ反映する", async () => {
    let getCalls = 0;
    server.use(
      http.put("/api/me/password", () => HttpResponse.json(SESSION)),
      http.get("/api/auth/session", () => {
        getCalls += 1;
        return HttpResponse.json({ ...SESSION, permissions: [] });
      }),
    );
    const { result, client } = setup();
    client.setQueryData(authKeys.session, {
      ...SESSION,
      permissions: ["perm.client.manage"],
    });
    const observer = new QueryObserver(client, {
      queryKey: authKeys.session,
      queryFn: fetchSession,
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      await act(async () => {
        await result.current(INPUT);
      });
      await waitFor(() => expect(getCalls).toBe(1));
      await waitFor(() =>
        expect(client.getQueryData(authKeys.session)).toMatchObject({
          permissions: [],
        }),
      );
    } finally {
      unsubscribe();
    }
  });

  it("#192 AC-6: PUT待機中に同一利用者の権限が剥奪されても古い権限を復活させない", async () => {
    const response = deferred<Response>();
    const received = deferred<void>();
    server.use(
      http.put("/api/me/password", () => {
        received.resolve();
        return response.promise;
      }),
    );
    const { result, client } = setup();
    client.setQueryData(authKeys.session, {
      ...SESSION,
      permissions: ["perm.client.manage"],
    });
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current(INPUT);
    });
    await received.promise;
    client.setQueryData(authKeys.session, { ...SESSION, permissions: [] });
    await act(async () => {
      response.resolve(HttpResponse.json(SESSION));
      await pending;
    });
    expect(client.getQueryData(authKeys.session)).toMatchObject({
      permissions: [],
    });
  });
});

describe("#192 AC-6: パスワード変更中の利用者切替", () => {
  it("#192 AC-6: 別利用者のsession cacheへ元利用者のPUT結果や権限を上書きしない", async () => {
    const response = deferred<Response>();
    const received = deferred<void>();
    server.use(
      http.put("/api/me/password", () => {
        received.resolve();
        return response.promise;
      }),
    );
    const { result, client } = setup();
    client.setQueryData(authKeys.session, {
      ...SESSION,
      permissions: ["perm.client.manage"],
    });
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current(INPUT);
    });
    await received.promise;
    const otherSession = {
      ...SESSION,
      user: {
        ...TEST_USER,
        id: "01JTESTUSER000000000000002",
        loginId: "testuser_002",
      },
      permissions: [] as string[],
    };
    client.setQueryData(authKeys.session, otherSession);
    const switched = client.getQueryData(authKeys.session);
    let outcome: unknown;
    await act(async () => {
      response.resolve(HttpResponse.json(SESSION));
      outcome = await pending;
    });
    expect(outcome).toBeUndefined();
    expect(client.getQueryData(authKeys.session)).toBe(switched);
    expect(client.getQueryData(authKeys.session)).toMatchObject({
      user: { id: otherSession.user.id },
      permissions: [],
    });
  });
  it("#192 AC-6: 同一利用者の再生成したsession queryへ旧PUT結果を上書きしない", async () => {
    const response = deferred<Response>();
    const received = deferred<void>();
    server.use(
      http.put("/api/me/password", () => {
        received.resolve();
        return response.promise;
      }),
    );
    const { result, client } = setup();
    client.setQueryData(authKeys.session, {
      ...SESSION,
      permissions: ["perm.client.manage"],
    });
    const oldQuery = client.getQueryCache().find({
      queryKey: authKeys.session,
      exact: true,
    });
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current(INPUT);
    });
    await received.promise;
    const nextSession = {
      ...SESSION,
      user: { ...TEST_USER },
      mustChangePassword: true,
      reauthenticatedAt: "2026-11-08T00:00:00.000Z",
      permissions: [] as string[],
    };
    act(() => {
      client.removeQueries({ queryKey: authKeys.session, exact: true });
      client.setQueryData(authKeys.session, nextSession);
    });
    const newQuery = client.getQueryCache().find({
      queryKey: authKeys.session,
      exact: true,
    });
    const newCache = client.getQueryData(authKeys.session);
    expect(newQuery).toBeDefined();
    expect(newQuery).not.toBe(oldQuery);
    expect(newCache).toMatchObject({
      user: { id: SESSION.user.id },
      mustChangePassword: true,
      reauthenticatedAt: nextSession.reauthenticatedAt,
      permissions: [],
    });
    let outcome: unknown;
    await act(async () => {
      response.resolve(HttpResponse.json(SESSION));
      outcome = await pending;
    });
    expect(outcome).toBeUndefined();
    expect(
      client.getQueryCache().find({
        queryKey: authKeys.session,
        exact: true,
      }),
    ).toBe(newQuery);
    expect(client.getQueryData(authKeys.session)).toBe(newCache);
  });
});
