import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { TEST_PASSWORD, TEST_USER } from "../../../test/auth-handlers";
import { server } from "../../../test/server";
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
