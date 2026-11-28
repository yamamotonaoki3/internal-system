// #342 AC-9（計画 plan342a2 の 3-1・3-8、7 節の U10 の入口の側）：再遷移の口 retryReloadNavigationAfterPageRestore()。
// 読み込み直しの状態が reloading のときだけ、いまの場所の読み込み直し（reloadPage）を1回呼ぶ（元の replacePage の行き先は再現しない。#392）。
// idle・waiting では何もしない（waiting の待機・タイマー・期限を作り直さない）。知らせ・合図・下書きの処理を繰り返さない。
// 切り替えの入口（requestUserSwitchReload）を reloading の後に呼ぶと、保存済みの喪失の知らせを消す。その後に再遷移すれば、知らせは消えている。
// 入口は文書ごとの状態を持つので、各テストで vi.resetModules して新しい文書として読み込む（reload-after-access-loss.test.ts と同じ）。
// 実際の読み込み直しは browser-location を差し替えて数える。時刻は偽の時計。データはすべて架空（testuser_342_・[UNIT_TEST]）。
// 前提にした口（実装の担当へ）：reload-after-access-loss.ts の retryReloadNavigationAfterPageRestore(): void
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authKeys } from "../auth";

vi.unmock("./reload-after-access-loss");
vi.mock("./browser-location", () => ({
  reloadPage: vi.fn(),
  replacePage: vi.fn(),
}));

const USER_A = "01JTESTUSER342A00000000001";
const CASE_PATH = "/cases/01JTESTCASE342000000000001";
/** 読み込み直した後の知らせの保存先（sessionStorage）のキー（#338） */
const NOTICE_KEY = "internal-system:access-loss-notice:v1";

async function freshDocument() {
  vi.resetModules();
  const entry = await import("./reload-after-access-loss");
  const location = await import("./browser-location");
  const leaveGuard = await import("../leave-guard");
  vi.mocked(location.reloadPage).mockClear();
  vi.mocked(location.replacePage).mockClear();
  return { entry, location, leaveGuard };
}

function clientSignedIn(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(authKeys.session, {
    user: { id: USER_A, displayName: "testuser_342_a", loginId: USER_A },
    permissions: [],
    mustChangePassword: false,
    reauthenticatedAt: null,
  });
  return client;
}

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("#342 AC-9 U10 再遷移の口は、reloading のときだけ、いまの場所を1回読み込み直す", () => {
  it("#342 AC-9 U10: idle では何もしない（読み込み直さず、状態も変えない）", async () => {
    const m = await freshDocument();
    m.entry.retryReloadNavigationAfterPageRestore();
    await advance(10_000);
    expect(m.location.reloadPage).not.toHaveBeenCalled();
    expect(m.location.replacePage).not.toHaveBeenCalled();
    expect(m.entry.getAccessLossReloadState()).toBe("idle");
  });

  it("#342 AC-9 U10: waiting では何もしない。待機は作り直されず、待つものが無くなったときの読み込み直しは1回だけ", async () => {
    const m = await freshDocument();
    const client = clientSignedIn();
    let release!: () => void;
    const observer = new MutationObserver(client, {
      mutationFn: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });
    void observer.mutate();
    await advance(0);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    expect(m.entry.getAccessLossReloadState()).toBe("waiting");
    m.entry.retryReloadNavigationAfterPageRestore();
    await advance(1);
    expect(m.location.reloadPage).not.toHaveBeenCalled();
    expect(m.entry.getAccessLossReloadState()).toBe("waiting");
    release();
    await advance(1);
    await advance(1);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
    // 待機の上限（最初の要求から5秒）を過ぎても、増えない
    await advance(10_000);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
  });

  it("#342 AC-9 U10: reloading では、いまの場所の読み込み直し（reloadPage）を1回呼ぶ。状態は reloading のまま、離脱の確認の抑止も外さず、知らせは書き直さない", async () => {
    const m = await freshDocument();
    const client = clientSignedIn();
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    await advance(1);
    expect(m.entry.getAccessLossReloadState()).toBe("reloading");
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
    const notice = window.sessionStorage.getItem(NOTICE_KEY);
    expect(notice).toBe("lost");
    m.entry.retryReloadNavigationAfterPageRestore();
    expect(m.location.reloadPage).toHaveBeenCalledTimes(2);
    expect(m.location.replacePage).not.toHaveBeenCalled();
    expect(m.entry.getAccessLossReloadState()).toBe("reloading");
    expect(m.leaveGuard.isBeforeUnloadSuppressed()).toBe(true);
    expect(window.sessionStorage.getItem(NOTICE_KEY)).toBe(notice);
    // 待機・タイマーを作り直さない（時間が過ぎても増えない）
    await advance(10_000);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(2);
  });

  it("#342 AC-9 U10: 元の遷移が /cases への置き換え（本人の退出）でも、再遷移は、いまの場所の reloadPage（行き先は再現しない）", async () => {
    const m = await freshDocument();
    const client = clientSignedIn();
    window.history.replaceState(null, "", CASE_PATH);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "left",
      leftCasePath: CASE_PATH,
    });
    await advance(1);
    expect(m.location.replacePage).toHaveBeenCalledTimes(1);
    m.entry.retryReloadNavigationAfterPageRestore();
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
    expect(m.location.replacePage).toHaveBeenCalledTimes(1);
  });

  it("#342 AC-9 U10: reloading の後に、切り替えの入口を呼んでから再遷移すると、再遷移の時点で、保存済みの喪失の知らせは消えている", async () => {
    const m = await freshDocument();
    const client = clientSignedIn();
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    await advance(1);
    expect(window.sessionStorage.getItem(NOTICE_KEY)).toBe("lost");
    const noticeAtRetry: (string | null)[] = [];
    vi.mocked(m.location.reloadPage).mockImplementation(() => {
      noticeAtRetry.push(window.sessionStorage.getItem(NOTICE_KEY));
    });
    m.entry.requestUserSwitchReload(client);
    m.entry.retryReloadNavigationAfterPageRestore();
    expect(noticeAtRetry).toEqual([null]);
    expect(m.entry.getAccessLossReloadState()).toBe("reloading");
  });
});
