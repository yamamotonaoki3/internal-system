// #239 AC-2：下書きのキーに使う、ログイン中の利用者ID。セッションのキャッシュを読むだけで、取得の通信はしない。
// 契約：features/auth/index.ts から useSignedInUserId(): string | undefined を公開する。
//   TanStack Query のキャッシュ（authKeys.session）を同期で購読し、user.id を返す。キャッシュがなければ undefined。
//   利用者IDが変わったときだけ再描画する（別の部品の描画中の通知で、更新を予約しない）。
//   手動ログアウトの queryClient.clear() の後は undefined。データは架空。
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, render, renderHook } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { server } from "../../../test/server";
import { authKeys, useSignedInUserId } from "../index";

const USER_A = {
  id: "01JTESTUSER00000000000DA01",
  displayName: "testuser_draft_a",
  loginId: "testuser_draft_a",
};
const USER_B = {
  id: "01JTESTUSER00000000000DB01",
  displayName: "testuser_draft_b",
  loginId: "testuser_draft_b",
};
const sessionOf = (user: typeof USER_A) => ({
  user,
  permissions: [],
  mustChangePassword: false,
  reauthenticatedAt: null,
});

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let sessionRequests = 0;
  server.use(
    http.get("/api/auth/session", () => {
      sessionRequests += 1;
      return HttpResponse.json(sessionOf(USER_A));
    }),
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper, requests: () => sessionRequests };
}

describe("#239 AC-2 useSignedInUserId", () => {
  it("#239 AC-2: セッションのキャッシュがあれば、その利用者IDを返す", () => {
    const { client, wrapper } = setup();
    client.setQueryData(authKeys.session, sessionOf(USER_A));
    const { result } = renderHook(() => useSignedInUserId(), { wrapper });
    expect(result.current).toBe(USER_A.id);
  });

  it("#239 AC-2: キャッシュがなければ undefined で、セッションの取得の通信もしない", async () => {
    const { wrapper, requests } = setup();
    const { result } = renderHook(() => useSignedInUserId(), { wrapper });
    expect(result.current).toBeUndefined();
    // 取得が走るなら、この間に要求が届く
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(requests()).toBe(0);
    expect(result.current).toBeUndefined();
  });

  it("#239 AC-2: キャッシュの利用者が替わると、新しい利用者IDを返す", () => {
    const { client, wrapper } = setup();
    client.setQueryData(authKeys.session, sessionOf(USER_A));
    const { result } = renderHook(() => useSignedInUserId(), { wrapper });
    act(() => {
      client.setQueryData(authKeys.session, sessionOf(USER_B));
    });
    expect(result.current).toBe(USER_B.id);
  });

  it("#239 AC-4: 手動ログアウトの queryClient.clear() の後は undefined になり、取り直しもしない", async () => {
    const { client, wrapper, requests } = setup();
    client.setQueryData(authKeys.session, sessionOf(USER_A));
    const { result } = renderHook(() => useSignedInUserId(), { wrapper });
    act(() => {
      client.clear();
    });
    expect(result.current).toBeUndefined();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(requests()).toBe(0);
  });

  it("#239 AC-2: 401 の自動ログアウトでセッションのキャッシュが捨てられると undefined になる", () => {
    const { client, wrapper } = setup();
    client.setQueryData(authKeys.session, sessionOf(USER_A));
    const { result } = renderHook(() => useSignedInUserId(), { wrapper });
    act(() => {
      client.removeQueries({ queryKey: authKeys.session });
    });
    expect(result.current).toBeUndefined();
  });

  it("#239 AC-2: 別の部品の描画中に新しいキーの useQuery が追加されても、描画中の更新の警告を出さず、利用者IDも変わらない", async () => {
    const { client, wrapper: Wrapper } = setup();
    client.setQueryData(authKeys.session, sessionOf(USER_A));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: Array<string | undefined> = [];
    let showLate: () => void = () => {};

    function Consumer() {
      seen.push(useSignedInUserId());
      return null;
    }
    // 描画中に、まだキャッシュにないキーの useQuery を初めて呼ぶ（クエリの追加の通知が描画中に出る）
    function Late() {
      useQuery({
        queryKey: ["testuser_draft_late-query"],
        queryFn: () => Promise.resolve("ok"),
      });
      return null;
    }
    function Host() {
      const [shown, setShown] = useState(false);
      showLate = () => setShown(true);
      return (
        <>
          <Consumer />
          {shown ? <Late /> : null}
        </>
      );
    }

    try {
      render(
        <Wrapper>
          <Host />
        </Wrapper>,
      );
      await act(async () => {
        showLate();
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      const warned = errorSpy.mock.calls.some((args) =>
        args.some(
          (arg) =>
            typeof arg === "string" &&
            arg.includes("Cannot update a component"),
        ),
      );
      expect(warned).toBe(false);
      expect(new Set(seen)).toEqual(new Set([USER_A.id]));
    } finally {
      errorSpy.mockRestore();
    }
  });
});
