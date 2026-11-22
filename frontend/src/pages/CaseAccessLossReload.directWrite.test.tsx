// #338 AC-2（コードレビュー1回目 重大3）：MutationCache に載らない、API の直接の送信（パスワードの変更。usePasswordChange は
// changePassword を直接待つ）の途中に、読み込み直しが求められても、送信が終わるまで読み込み直さない。応答の後の処理
// （セッションの書き換え）が済んでから、1回だけ読み込み直す。上限は同じ5秒。
// 本物の入口を通し、実際の読み込み直し（browser-location）だけを数える。入口の状態はファイルごとなので、このファイルに分けた。
// 偽の時計で進め、送信の応答は手で解く。データはすべて架空（testuser_・[UNIT_TEST]）。パスワードはテスト専用の固定値。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestAccessLossReload } from "../features/access-loss";
import {
  reloadPage,
  replacePage,
} from "../features/access-loss/browser-location";
import { authKeys, type SessionInfo } from "../features/auth";
import { usePasswordChange } from "../features/auth/hooks/usePasswordChange";
import { TEST_USER } from "../test/auth-handlers";
import { server } from "../test/server";

vi.mock("../features/access-loss/browser-location", () => ({
  reloadPage: vi.fn(),
  replacePage: vi.fn(),
}));
vi.unmock("../features/access-loss/reload-after-access-loss");

const PASSWORD_NOW = "TestPass123!";
const PASSWORD_NEXT = "TestPass456!";

function sessionOf(mustChangePassword: boolean): SessionInfo {
  return {
    user: TEST_USER,
    mustChangePassword,
    reauthenticatedAt: null,
    permissions: [],
  } as SessionInfo;
}

function PasswordChangeProbe() {
  const change = usePasswordChange();
  const [done, setDone] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() =>
          void change({
            currentPassword: PASSWORD_NOW,
            newPassword: PASSWORD_NEXT,
          }).then(() => setDone(true))
        }
      >
        [UNIT_TEST]338パスワードを変更
      </button>
      {done && <p>[UNIT_TEST]338変更の後の処理が済んだ</p>}
    </>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("#338 AC-2 直接の送信（パスワードの変更）を待つ（コードレビュー1回目 重大3）", () => {
  it("#338 AC-2: パスワードの変更の送信中に読み込み直しが求められても、送信が終わるまで読み込み直さず、応答の後の処理（セッションの書き換え）の後に1回だけ読み込み直す", async () => {
    const gate = { release: () => undefined as void };
    const released = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    let arrived = false;
    server.use(
      http.put("/api/me/password", async () => {
        arrived = true;
        await released;
        return HttpResponse.json(sessionOf(false));
      }),
      http.get("/api/auth/session", () => HttpResponse.json(sessionOf(false))),
    );
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    // usePasswordChange は、送信の前のセッションのクエリがあることを前提にする
    await client.prefetchQuery({
      queryKey: authKeys.session,
      queryFn: () => sessionOf(true),
    });
    const sessionAtReload: (boolean | undefined)[] = [];
    vi.mocked(reloadPage).mockImplementation(() => {
      sessionAtReload.push(
        client.getQueryData<SessionInfo>(authKeys.session)?.mustChangePassword,
      );
    });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <PasswordChangeProbe />
      </QueryClientProvider>,
    );
    await user.click(
      screen.getByRole("button", { name: "[UNIT_TEST]338パスワードを変更" }),
    );
    await waitFor(() => expect(arrived).toBe(true));

    act(() => {
      void requestAccessLossReload(client, {
        ownerId: TEST_USER.id,
        reason: "lost",
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(reloadPage).not.toHaveBeenCalled();

    gate.release();
    await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
    // 応答の後の処理（セッションの書き換え）が先に済んでいる
    expect(sessionAtReload).toEqual([false]);
    expect(replacePage).not.toHaveBeenCalled();
  });
});
