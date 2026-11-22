// #338 AC-1〜AC-5（計画 plan-338 の 5-4・7-2 の U-1〜U-11b・U-14・U-15・U-17）：読み込み直しの入口 requestAccessLossReload の単体テスト。
// 入口は文書ごとの状態（idle → waiting → reloading）を持つため、各テストで vi.resetModules して新しい文書として読み込む（U-3 も同じ方法）。
// 実際の読み込み直し（location）は browser-location を差し替えて数える。時刻は偽の時計で進める（固定の待ちを使わない）。
// データはすべて架空（testuser_338_・[UNIT_TEST]）。期待は受け入れ条件と計画の 5-4 から決めた（実装の動きを写さない）。
// 前提にした口（実装の担当へ）：
//   requestAccessLossReload(queryClient, { ownerId, reason: "lost" | "left", leftCasePath? })
//   getAccessLossReloadState(): "idle" | "waiting" | "reloading"
//   browser-location の reloadPage()・replacePage(to)
//   leave-guard（index）の suppressBeforeUnload()・restoreBeforeUnload()
//   access-loss-notice の takeAccessLossNotice(queryClient): "lost" | "left" | null（読んだら消す）
//   「1つ後のタスク」は setTimeout（偽の時計で進む）で待つ
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authKeys } from "../auth";

// #338：test/setup.ts の入口の差し替えを外し、本物の入口を使う
vi.unmock("./reload-after-access-loss");
vi.mock("./browser-location", () => ({
  reloadPage: vi.fn(),
  replacePage: vi.fn(),
}));
vi.mock("../leave-guard", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  suppressBeforeUnload: vi.fn(),
  restoreBeforeUnload: vi.fn(),
}));

const USER_A = "01JTESTUSER338A00000000001";
const USER_B = "01JTESTUSER338B00000000001";
const CASE_PATH = "/cases/01JTESTCASE338000000000001";
/** 計画 5-4 の 4：一般の操作を待つ上限（AC-2） */
const LIMIT_MS = 5_000;

type Modules = {
  entry: typeof import("./reload-after-access-loss");
  location: typeof import("./browser-location");
  leaveGuard: typeof import("../leave-guard");
  notice: typeof import("./access-loss-notice");
  api: typeof import("../../services/api-client");
};

/** 新しい文書として読み込む（入口の状態・保存先の参照を前のテストから持ち越さない） */
async function freshDocument(): Promise<Modules> {
  vi.resetModules();
  const entry = await import("./reload-after-access-loss");
  const location = await import("./browser-location");
  const leaveGuard = await import("../leave-guard");
  const notice = await import("./access-loss-notice");
  const api = await import("../../services/api-client");
  return { entry, location, leaveGuard, notice, api };
}

function sessionOf(id: string) {
  return {
    user: { id, displayName: `testuser_338_${id.slice(-3)}`, loginId: id },
    permissions: [],
    mustChangePassword: false,
    reauthenticatedAt: null,
  };
}

function clientSignedInAs(id: string | null): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  if (id !== null) client.setQueryData(authKeys.session, sessionOf(id));
  return client;
}

function deferred() {
  let resolve!: () => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 保留した操作を始める（MutationCache に pending として載る）。settled は成功・失敗のどちらでも解決する */
function startPending(
  client: QueryClient,
  options: {
    mutationKey?: readonly unknown[];
    context?: unknown;
    onSuccess?: () => void;
    onError?: () => void;
  } = {},
) {
  const gate = deferred();
  const observer = new MutationObserver(client, {
    mutationKey: options.mutationKey,
    mutationFn: () => gate.promise,
    onMutate: () => options.context,
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
  const settled = observer.mutate().then(
    () => "success" as const,
    (cause: unknown) => ({ failed: cause }),
  );
  return { gate, settled, observer };
}

/** 持ち主（A）が押したログアウト。文脈に押した時点の利用者を持つ（useLogout.ts の onMutate と同じ形） */
function startLogout(
  client: QueryClient,
  pressedBy: string,
  hooks: { onSuccess?: () => void; onError?: () => void } = {},
) {
  return startPending(client, {
    mutationKey: authKeys.logout,
    context: { userId: pressedBy },
    ...hooks,
  });
}

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("#338 AC-1 操作がなければ、すぐに読み込み直す", () => {
  it("#338 AC-1 U-1: 進行中の操作がなければ、1つ後のタスクの後に reloadPage が1回だけ呼ばれる（呼んだその場では呼ばない）", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_A);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    expect(m.location.reloadPage).not.toHaveBeenCalled();
    expect(m.entry.getAccessLossReloadState()).toBe("waiting");
    await advance(0);
    await advance(1);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
    expect(m.location.replacePage).not.toHaveBeenCalled();
    expect(m.entry.getAccessLossReloadState()).toBe("reloading");
    // 待つ間、離脱の確認（beforeunload）を止めない印を立てる（AC-2）
    expect(m.leaveGuard.suppressBeforeUnload).toHaveBeenCalled();
  });
});

describe("#338 AC-4 同じ文書の同じ持ち主の要求は1回にまとめる・時間の歯止めを持たない", () => {
  it("#338 AC-4 U-2: 同じ持ち主の要求が3回来ても、読み込み直しは1回だけ", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_A);
    for (let i = 0; i < 3; i += 1)
      void m.entry.requestAccessLossReload(client, {
        ownerId: USER_A,
        reason: "lost",
      });
    await advance(LIMIT_MS * 2);
    // reloading の後の要求も、何もしない
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    await advance(LIMIT_MS * 2);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
  });

  it("#338 AC-4 U-3: 読み込み直した直後の新しい文書でも（直前の知らせが保存先に残っていても）、新しい喪失なら、また読み込み直す（時間による歯止めがない）", async () => {
    const first = await freshDocument();
    const client = clientSignedInAs(USER_A);
    void first.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    await advance(1);
    expect(first.location.reloadPage).toHaveBeenCalledTimes(1);
    // 前の文書が書いた知らせが残ったまま、新しい文書で同じ持ち主の喪失が起きる
    expect(window.sessionStorage.length).toBe(1);
    const second = await freshDocument();
    // vi.resetModules でも、vi.mock の差し替えの関数は作り直されない（前の文書と同じ関数）。前の文書の分を数えないよう、ここで数え直す
    expect(second.location.reloadPage).toBe(first.location.reloadPage);
    vi.mocked(second.location.reloadPage).mockClear();
    void second.entry.requestAccessLossReload(clientSignedInAs(USER_A), {
      ownerId: USER_A,
      reason: "lost",
    });
    await advance(1);
    expect(second.location.reloadPage).toHaveBeenCalledTimes(1);
  });
});

describe("#338 AC-2 進行中の操作を、最大5秒待つ", () => {
  it("#338 AC-2 U-4: 保留した操作の完了まで待ち、mutateAsync の続き（then）が先に走ってから読み込み直す", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_A);
    const order: string[] = [];
    vi.mocked(m.location.reloadPage).mockImplementation(() => {
      order.push("reload");
    });
    const post = startPending(client);
    void post.settled.then(() => order.push("continuation"));
    await advance(0);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    await advance(LIMIT_MS - 1_000);
    expect(m.location.reloadPage).not.toHaveBeenCalled();
    expect(m.entry.getAccessLossReloadState()).toBe("waiting");
    post.gate.resolve();
    await advance(1);
    await advance(1);
    expect(order).toEqual(["continuation", "reload"]);
  });

  it("#338 AC-2 U-5: 終わらない操作は5000ミリ秒で打ち切る（4999ミリ秒では呼ばない）", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_A);
    const post = startPending(client);
    await advance(0);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    await advance(LIMIT_MS - 1);
    expect(m.location.reloadPage).not.toHaveBeenCalled();
    await advance(1);
    await advance(1);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
    // 打ち切っても、操作そのものは取り消さない
    expect(post.observer.getCurrentResult().status).toBe("pending");
  });
});

describe("#338 AC-3 待機の持ち主と、利用者の切り替え・ログアウト", () => {
  it("#338 AC-3 U-6: 持ち主のログアウトの進行中は、5000ミリ秒を過ぎても待ち、成功の後処理の後に読み込み直す", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_A);
    const order: string[] = [];
    vi.mocked(m.location.reloadPage).mockImplementation(() => {
      order.push("reload");
    });
    const logout = startLogout(client, USER_A, {
      onSuccess: () => {
        order.push("logout-cleanup");
        client.clear();
      },
    });
    await advance(0);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    await advance(LIMIT_MS * 3);
    expect(m.location.reloadPage).not.toHaveBeenCalled();
    expect(m.entry.getAccessLossReloadState()).toBe("waiting");
    logout.gate.resolve();
    await advance(1);
    await advance(1);
    expect(order).toEqual(["logout-cleanup", "reload"]);
  });

  it("#338 AC-3 U-6: 持ち主のログアウトが失敗しても、失敗の後に読み込み直す（5000ミリ秒を過ぎても待つ）", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_A);
    const logout = startLogout(client, USER_A);
    await advance(0);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    await advance(LIMIT_MS * 3);
    expect(m.location.reloadPage).not.toHaveBeenCalled();
    logout.gate.reject({ status: 500, code: "INTERNAL_ERROR", message: "x" });
    await logout.settled;
    await advance(1);
    await advance(1);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
  });

  it("#338 AC-3 U-7: 要求の時点で、いまのセッションが持ち主と別の利用者なら、waiting にならず、読み込み直さない", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_B);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    expect(m.entry.getAccessLossReloadState()).toBe("idle");
    await advance(LIMIT_MS * 2);
    expect(m.location.reloadPage).not.toHaveBeenCalled();
    expect(m.location.replacePage).not.toHaveBeenCalled();
    expect(m.leaveGuard.suppressBeforeUnload).not.toHaveBeenCalled();
  });

  it("#338 AC-3 U-7: セッションが無い（401 の後）だけなら、取りやめずに読み込み直す", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(null);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    await advance(1);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
  });

  it("#338 AC-3 U-8: 待つ間に別の利用者に替わると、その時点で idle に戻り、離脱の確認の抑止が外れ、読み込み直さない", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_A);
    startPending(client);
    await advance(0);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    expect(m.entry.getAccessLossReloadState()).toBe("waiting");
    expect(m.leaveGuard.suppressBeforeUnload).toHaveBeenCalledTimes(1);
    client.setQueryData(authKeys.session, sessionOf(USER_B));
    expect(m.entry.getAccessLossReloadState()).toBe("idle");
    expect(m.leaveGuard.restoreBeforeUnload).toHaveBeenCalledTimes(1);
    await advance(LIMIT_MS * 2);
    expect(m.location.reloadPage).not.toHaveBeenCalled();
    expect(m.location.replacePage).not.toHaveBeenCalled();
  });

  it("#338 AC-3 U-8: 待つ間にセッションが消えるだけ（401）では取りやめない", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_A);
    const post = startPending(client);
    await advance(0);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    client.removeQueries({ queryKey: authKeys.session });
    expect(m.entry.getAccessLossReloadState()).toBe("waiting");
    post.gate.resolve();
    await advance(1);
    await advance(1);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
  });

  it("#338 AC-3 U-9: A の待機中に B に替わり、B の喪失の要求が来る：A の待機は取りやめ、B の分が1回だけ読み込み直される（B の喪失を捨てない）", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_A);
    const post = startPending(client);
    await advance(0);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    client.setQueryData(authKeys.session, sessionOf(USER_B));
    expect(m.entry.getAccessLossReloadState()).toBe("idle");
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_B,
      reason: "lost",
    });
    expect(m.entry.getAccessLossReloadState()).toBe("waiting");
    post.gate.resolve();
    await advance(1);
    await advance(1);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
    expect(m.notice.takeAccessLossNotice(clientSignedInAs(USER_B))).toBe(
      "lost",
    );
  });

  it("#338 AC-3 U-9: A の待機中に、A が戻らないまま B の要求が来ても（持ち主が違う）、古い待機を取りやめて B を待つ", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(null);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    client.setQueryData(authKeys.session, sessionOf(USER_B));
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_B,
      reason: "lost",
    });
    await advance(1);
    await advance(1);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
  });

  it("#338 AC-3 U-10: A のログアウトを保留したまま B に替わると、A の待機はすぐ終わり（idle）、ログアウトの操作は取り消されない", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_A);
    const logout = startLogout(client, USER_A);
    await advance(0);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    client.setQueryData(authKeys.session, sessionOf(USER_B));
    expect(m.entry.getAccessLossReloadState()).toBe("idle");
    expect(logout.observer.getCurrentResult().status).toBe("pending");
    await advance(LIMIT_MS * 2);
    expect(m.location.reloadPage).not.toHaveBeenCalled();
  });

  it("#338 AC-3 U-10b: A のログアウトを保留したまま B に替わり、B でも喪失：B の待機は A のログアウトを上限なしでは待たず、5000ミリ秒で読み込み直す", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_A);
    startLogout(client, USER_A);
    await advance(0);
    client.setQueryData(authKeys.session, sessionOf(USER_B));
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_B,
      reason: "lost",
    });
    await advance(LIMIT_MS - 1);
    expect(m.location.reloadPage).not.toHaveBeenCalled();
    await advance(1);
    await advance(1);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
  });

  it("#338 AC-3 U-11: 持ち主のログアウトを保留 → 別の通信の 401 でセッションが消える → ログアウトが成功：消えた時点では読み込み直さず、成功の後処理（下書きの消去・キャッシュの消去）の後に読み込み直す。知らせは書かない", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_A);
    const order: string[] = [];
    vi.mocked(m.location.reloadPage).mockImplementation(() => {
      order.push("reload");
    });
    const logout = startLogout(client, USER_A, {
      onSuccess: () => {
        order.push("drafts-removed");
        client.clear();
        order.push("cache-cleared");
      },
    });
    await advance(0);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    // 別の通信の 401（unauthenticated-handler.ts と同じ：セッションのクエリを消すだけ）
    client.removeQueries({ queryKey: authKeys.session });
    await advance(LIMIT_MS * 2);
    expect(m.location.reloadPage).not.toHaveBeenCalled();
    expect(m.entry.getAccessLossReloadState()).toBe("waiting");
    logout.gate.resolve();
    await advance(1);
    await advance(1);
    expect(order).toEqual(["drafts-removed", "cache-cleared", "reload"]);
    // セッションが無い時点で読み込み直すので、知らせの種類は書かない（計画 5-4 の 6）
    expect(window.sessionStorage.length).toBe(0);
  });

  it("#338 AC-3 U-11b: 持ち主のログアウトを保留 → 401 でセッションが消える → ログアウトが失敗：失敗の後に読み込み直す", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_A);
    const logout = startLogout(client, USER_A);
    await advance(0);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    client.removeQueries({ queryKey: authKeys.session });
    await advance(LIMIT_MS * 2);
    expect(m.location.reloadPage).not.toHaveBeenCalled();
    logout.gate.reject({ status: 500, code: "INTERNAL_ERROR", message: "x" });
    await logout.settled;
    await advance(1);
    await advance(1);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
  });
});

describe("#338 AC-5 知らせの種類の書き込みと、保存先を使えない端末", () => {
  it("#338 AC-5 U-15: 読み込み直す前に、知らせの種類だけを保存先に書く（利用者の ID を書かない）", async () => {
    const m = await freshDocument();
    void m.entry.requestAccessLossReload(clientSignedInAs(USER_A), {
      ownerId: USER_A,
      reason: "lost",
    });
    await advance(1);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.length).toBe(1);
    const key = window.sessionStorage.key(0) ?? "";
    const stored = `${key}=${window.sessionStorage.getItem(key) ?? ""}`;
    expect(stored).not.toContain(USER_A);
    expect(m.notice.takeAccessLossNotice(clientSignedInAs(USER_A))).toBe(
      "lost",
    );
  });

  it("#338 AC-5 U-14: 保存先の参照が SecurityError でも、例外を出さずに読み込み直す", async () => {
    const m = await freshDocument();
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    void m.entry.requestAccessLossReload(clientSignedInAs(USER_A), {
      ownerId: USER_A,
      reason: "lost",
    });
    await advance(1);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["SecurityError", new DOMException("denied", "SecurityError")],
    ["容量の超過", new DOMException("full", "QuotaExceededError")],
  ])(
    "#338 AC-5 U-14: 知らせの書き込みが失敗（%s）しても、知らせを諦めて読み込み直しを続ける",
    async (_name, failure) => {
      const m = await freshDocument();
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw failure;
      });
      void m.entry.requestAccessLossReload(clientSignedInAs(USER_A), {
        ownerId: USER_A,
        reason: "lost",
      });
      await advance(1);
      expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
    },
  );
});

describe("#338 AC-4・AC-5 退出（left）と喪失（lost）の合流と、読み込み先", () => {
  it("#338 AC-4 U-17: left の待機に lost が合流しても理由は left。いまの場所がその案件の S-17 なら /cases へ置き換える", async () => {
    const m = await freshDocument();
    window.history.replaceState(null, "", CASE_PATH);
    const client = clientSignedInAs(USER_A);
    const post = startPending(client);
    await advance(0);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "left",
      leftCasePath: CASE_PATH,
    });
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    post.gate.resolve();
    await advance(1);
    await advance(1);
    expect(m.location.replacePage).toHaveBeenCalledTimes(1);
    expect(m.location.replacePage).toHaveBeenCalledWith("/cases");
    expect(m.location.reloadPage).not.toHaveBeenCalled();
    expect(m.notice.takeAccessLossNotice(clientSignedInAs(USER_A))).toBe(
      "left",
    );
  });

  it("#338 AC-4 U-17: lost の待機に left が合流すると left になる（退出の案件の場所も持つ）", async () => {
    const m = await freshDocument();
    window.history.replaceState(null, "", CASE_PATH);
    const client = clientSignedInAs(USER_A);
    const post = startPending(client);
    await advance(0);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "left",
      leftCasePath: CASE_PATH,
    });
    post.gate.resolve();
    await advance(1);
    await advance(1);
    expect(m.location.replacePage).toHaveBeenCalledWith("/cases");
    expect(m.location.reloadPage).not.toHaveBeenCalled();
    expect(m.notice.takeAccessLossNotice(clientSignedInAs(USER_A))).toBe(
      "left",
    );
  });

  it("#338 AC-5 U-17: left で、読み込み直す時点の場所が /cases なら /cases へ置き換える", async () => {
    const m = await freshDocument();
    window.history.replaceState(null, "", "/cases");
    void m.entry.requestAccessLossReload(clientSignedInAs(USER_A), {
      ownerId: USER_A,
      reason: "left",
      leftCasePath: CASE_PATH,
    });
    await advance(1);
    expect(m.location.replacePage).toHaveBeenCalledWith("/cases");
    expect(m.location.reloadPage).not.toHaveBeenCalled();
  });

  it("#338 AC-5 U-17: 読み込み先は、要求の時点ではなく、読み込み直す時点の場所で決まる（待つ間にほかの画面へ移っていたら、その場所を読み込み直す）", async () => {
    const m = await freshDocument();
    window.history.replaceState(null, "", CASE_PATH);
    const client = clientSignedInAs(USER_A);
    const post = startPending(client);
    await advance(0);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "left",
      leftCasePath: CASE_PATH,
    });
    window.history.replaceState(
      null,
      "",
      "/channels/01JTESTROOM338000000000001",
    );
    post.gate.resolve();
    await advance(1);
    await advance(1);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
    expect(m.location.replacePage).not.toHaveBeenCalled();
    expect(m.notice.takeAccessLossNotice(clientSignedInAs(USER_A))).toBe(
      "left",
    );
  });

  it("#338 AC-1 U-17: lost では、いまの場所が S-17 でも置き換えず、その場所を読み込み直す", async () => {
    const m = await freshDocument();
    window.history.replaceState(null, "", CASE_PATH);
    void m.entry.requestAccessLossReload(clientSignedInAs(USER_A), {
      ownerId: USER_A,
      reason: "lost",
    });
    await advance(1);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
    expect(m.location.replacePage).not.toHaveBeenCalled();
  });
});

// コードレビュー1回目 重大2：待ちが終わり、1つ後のタスクでの読み込み直しを予約した後に始まった操作。
// 直し方：実行の直前にも進行中の操作を確かめ直し、待つべきものがあれば待機に戻る（AC-2・AC-3）。上限は、最初の要求からの5秒のまま（延ばし続けない）
describe("#338 AC-2・AC-3 予約の後に始まった操作も待つ（コードレビュー1回目 重大2）", () => {
  it("#338 AC-3: 予約の後、タスクが進む前に持ち主のログアウトが始まる → 読み込み直さず、5秒を過ぎても待ち、ログアウトの後処理の後に1回読み込み直す", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_A);
    const order: string[] = [];
    vi.mocked(m.location.reloadPage).mockImplementation(() => {
      order.push("reload");
    });
    // 進行中の操作がないので、要求の時点で予約される
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    const logout = startLogout(client, USER_A, {
      onSuccess: () => {
        order.push("logout-cleanup");
        client.clear();
      },
    });
    await advance(1);
    await advance(LIMIT_MS * 3);
    expect(m.location.reloadPage).not.toHaveBeenCalled();
    expect(m.entry.getAccessLossReloadState()).toBe("waiting");
    logout.gate.resolve();
    await advance(1);
    await advance(1);
    expect(order).toEqual(["logout-cleanup", "reload"]);
  });

  it("#338 AC-2: 予約の後に、ほかの操作が始まる → その完了を待ち、完了の後に1回読み込み直す", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_A);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    const post = startPending(client);
    await advance(1);
    await advance(1_000);
    expect(m.location.reloadPage).not.toHaveBeenCalled();
    post.gate.resolve();
    await advance(1);
    await advance(1);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
  });

  it("#338 AC-2: 予約の後に始まった、終わらない操作は、最初の要求から5秒で打ち切る（上限を延ばさない）", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_A);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    await advance(0);
    startPending(client);
    await advance(LIMIT_MS - 1);
    expect(m.location.reloadPage).not.toHaveBeenCalled();
    await advance(1);
    await advance(1);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
  });

  it("#338 AC-3: 予約の後に始まったのが、持ち主と別の利用者のログアウトなら、上限の対象（最初の要求から5秒で読み込み直す）", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_A);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    startLogout(client, USER_B);
    await advance(LIMIT_MS - 1);
    expect(m.location.reloadPage).not.toHaveBeenCalled();
    await advance(1);
    await advance(1);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
  });
});

// コードレビュー1回目 重大3：MutationCache に載らない、API の直接の書き込み（usePasswordChange など）。
// 直し方：API クライアントの層で、進行中の書き込みの要求（GET・HEAD・OPTIONS 以外）の数を数え、入口の待つ対象に含める（上限は同じ5秒）。
// 応答の後の処理（await の続き）は、要求が終わった1つ後のタスクで読み込み直すことで、先に走らせる（AC-2）。
// 通信はアダプターで保留する（本物の通信・時計に頼らない）。インターセプターはアダプターの前後で動く
describe("#338 AC-2 API の直接の書き込みも待つ（コードレビュー1回目 重大3）", () => {
  type Api = Modules["api"];
  function heldRequest(api: Api, method: "post" | "get") {
    const gate = deferred();
    const adapter = (config: import("axios").InternalAxiosRequestConfig) =>
      gate.promise.then(() => ({
        data: {},
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      }));
    const request =
      method === "post"
        ? api.apiClient.post("/[UNIT_TEST]338-write", { value: 1 }, { adapter })
        : api.apiClient.get("/[UNIT_TEST]338-read", { adapter });
    return { gate, request };
  }

  it("#338 AC-2: 直接の書き込みの要求が進行中なら読み込み直さず、応答の後の処理（await の続き）の後に1回読み込み直す", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_A);
    const order: string[] = [];
    vi.mocked(m.location.reloadPage).mockImplementation(() => {
      order.push("reload");
    });
    const held = heldRequest(m.api, "post");
    void held.request.then(() => order.push("continuation"));
    await advance(0);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    await advance(LIMIT_MS - 1_000);
    expect(m.location.reloadPage).not.toHaveBeenCalled();
    held.gate.resolve();
    await advance(1);
    await advance(1);
    expect(order).toEqual(["continuation", "reload"]);
  });

  it("#338 AC-2: 直接の書き込みが終わらなければ、5秒で打ち切る", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_A);
    heldRequest(m.api, "post");
    await advance(0);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    await advance(LIMIT_MS - 1);
    expect(m.location.reloadPage).not.toHaveBeenCalled();
    await advance(1);
    await advance(1);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
  });

  it("#338 AC-2: 読み取り（GET）の進行中は待たない", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_A);
    heldRequest(m.api, "get");
    await advance(0);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    await advance(1);
    await advance(1);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
  });

  it("#338 AC-2: 予約の後に始まった直接の書き込みも待つ（重大2 と同じく、実行の直前に確かめ直す）", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_A);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    const held = heldRequest(m.api, "post");
    await advance(1);
    await advance(1_000);
    expect(m.location.reloadPage).not.toHaveBeenCalled();
    held.gate.resolve();
    await advance(1);
    await advance(1);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
  });
});
