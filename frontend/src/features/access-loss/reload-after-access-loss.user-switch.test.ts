// #298 AC-4（計画 plan-298 改訂3 の 2-8、8-1 の AC-4 の reload-after-access-loss の行、8-1b の「交錯の逆向き」「知らせ」の行）：
// 利用者の切り替えの読み込み直しの入口 requestUserSwitchReload(queryClient)。#338 の状態（idle・waiting・reloading）・覆い・
// 離脱の確認の抑止（suppressBeforeUnload）・待ち方（最大5秒・1つ後のタスク）を使い回す。取りやめはしない。知らせは書かず、保存済みの知らせは消す。
// #338 の待機中に呼ぶと、抑止を外さず・idle を経ずに引き継ぐ。切り替えの入口が動いている間の #338 の要求は何もしない。
// 実際の読み込み直しは browser-location を差し替えて数える。離脱の確認の抑止は本物を使い（呼び出しだけを記録する）、途中で一度も外れないことを見る。
// 時刻は偽の時計で進める（固定の待ちを使わない）。入口は文書ごとの状態を持つので、各テストで vi.resetModules して新しい文書として読み込む。
// 前提にした口（実装の担当へ）：
//   reload-after-access-loss.ts（access-loss の index からも公開）の requestUserSwitchReload(queryClient: QueryClient): void
//     と isUserSwitchReloadRequested(): boolean（切り替えの入口が呼ばれた後、文書の間ずっと真）
// 期待の値（5秒・知らせの保存先のキー）は、本番の定義から取り込まず、ここにリテラルで書く。データはすべて架空（testuser_298_・[UNIT_TEST]）。
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authKeys } from "../auth";

vi.unmock("./reload-after-access-loss");
vi.mock("./browser-location", () => ({
  reloadPage: vi.fn(),
  replacePage: vi.fn(),
}));
vi.mock("../leave-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../leave-guard")>();
  return {
    ...actual,
    suppressBeforeUnload: vi.fn(actual.suppressBeforeUnload),
    restoreBeforeUnload: vi.fn(actual.restoreBeforeUnload),
  };
});

const USER_A = "01JTESTUSER298A00000000005";
const USER_B = "01JTESTUSER298B00000000005";
/** 計画 2-8 の 4：受理済みの操作を待つ上限（Q13） */
const LIMIT_MS = 5_000;
/** 読み込み直した後の知らせの保存先（sessionStorage）のキー（#338） */
const NOTICE_KEY = "internal-system:access-loss-notice:v1";

async function freshDocument() {
  vi.resetModules();
  const entry = await import("./reload-after-access-loss");
  const location = await import("./browser-location");
  const leaveGuard = await import("../leave-guard");
  const notice = await import("./access-loss-notice");
  const api = await import("../../services/api-client");
  const auth = await import("../auth");
  const states: string[] = [];
  const suppressedSeen: boolean[] = [];
  entry.subscribeAccessLossReloadState(() => {
    states.push(entry.getAccessLossReloadState());
    suppressedSeen.push(leaveGuard.isBeforeUnloadSuppressed());
  });
  return {
    entry,
    location,
    leaveGuard,
    notice,
    api,
    auth,
    states,
    suppressedSeen,
  };
}

type Doc = Awaited<ReturnType<typeof freshDocument>>;

function sessionOf(id: string) {
  return {
    user: { id, displayName: `testuser_298_${id.slice(-3)}`, loginId: id },
    permissions: [],
    mustChangePassword: false,
    reauthenticatedAt: null,
  };
}

function clientSignedInAs(id: string): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(authKeys.session, sessionOf(id));
  return client;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function startPending(
  client: QueryClient,
  options: { mutationKey?: readonly unknown[]; context?: unknown } = {},
) {
  const gate = deferred();
  const observer = new MutationObserver(client, {
    mutationKey: options.mutationKey,
    mutationFn: () => gate.promise,
    onMutate: () => options.context,
  });
  const settled = observer.mutate();
  return { gate, settled };
}

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

/** 引き継ぎ・交錯の間に、抑止が一度も外れず、idle を経ていないこと */
function expectNeverReleased(m: Doc) {
  expect(m.states).not.toContain("idle");
  expect(m.suppressedSeen).not.toContain(false);
  expect(m.leaveGuard.restoreBeforeUnload).not.toHaveBeenCalled();
  expect(m.leaveGuard.isBeforeUnloadSuppressed()).toBe(true);
}

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState(null, "", "/channels");
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("#298 AC-4 切り替えの入口の基本の動き", () => {
  it("#298 AC-4: 呼ぶと waiting になり、抑止が立つ（覆いが出る状態）。呼んだその場では読み込み直さず、1つ後のタスクの後に、いまの場所を1回だけ読み込み直す", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_B);
    expect(m.entry.isUserSwitchReloadRequested()).toBe(false);
    m.entry.requestUserSwitchReload(client);
    expect(m.entry.getAccessLossReloadState()).toBe("waiting");
    expect(m.leaveGuard.isBeforeUnloadSuppressed()).toBe(true);
    expect(m.entry.isUserSwitchReloadRequested()).toBe(true);
    expect(m.location.reloadPage).not.toHaveBeenCalled();
    await advance(1);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
    expect(m.location.replacePage).not.toHaveBeenCalled();
    expect(m.entry.getAccessLossReloadState()).toBe("reloading");
    expectNeverReleased(m);
  });

  it("#298 AC-4: 2回呼んでも、reloading の後に呼んでも、読み込み直しは1回だけ", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_B);
    m.entry.requestUserSwitchReload(client);
    m.entry.requestUserSwitchReload(client);
    await advance(1);
    m.entry.requestUserSwitchReload(client);
    await advance(LIMIT_MS * 2);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
  });

  it("#298 AC-4: 受理済みの操作（pending の mutation）の完了を待ち、その続きの後に読み込み直す", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_B);
    const order: string[] = [];
    vi.mocked(m.location.reloadPage).mockImplementation(() => {
      order.push("reload");
    });
    const post = startPending(client);
    void post.settled.then(() => order.push("continuation"));
    await advance(0);
    m.entry.requestUserSwitchReload(client);
    await advance(LIMIT_MS - 1_000);
    expect(m.location.reloadPage).not.toHaveBeenCalled();
    post.gate.resolve();
    await advance(1);
    await advance(1);
    expect(order).toEqual(["continuation", "reload"]);
  });

  it("#298 AC-4（Q13）: 終わらない操作は、最初の要求から5000ミリ秒で打ち切る（4999ミリ秒では読み込み直さない）", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_B);
    startPending(client);
    await advance(0);
    m.entry.requestUserSwitchReload(client);
    await advance(LIMIT_MS - 1);
    expect(m.location.reloadPage).not.toHaveBeenCalled();
    await advance(1);
    await advance(1);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
  });

  it("#298 AC-4: A のログアウト（持ち主のログアウトの形）が終わらなくても、上限なしでは待たず、5000ミリ秒で読み込み直す", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_A);
    startPending(client, {
      mutationKey: authKeys.logout,
      context: { userId: USER_A },
    });
    await advance(0);
    m.entry.requestUserSwitchReload(client);
    await advance(LIMIT_MS - 1);
    expect(m.location.reloadPage).not.toHaveBeenCalled();
    await advance(1);
    await advance(1);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
  });

  it("#298 AC-4: API の直接の書き込みの要求も待ち、応答の後に読み込み直す", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_B);
    const gate = deferred();
    const adapter = (config: import("axios").InternalAxiosRequestConfig) =>
      gate.promise.then(() => ({
        data: {},
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      }));
    void m.api.apiClient.post("/[UNIT_TEST]298-write", { v: 1 }, { adapter });
    await advance(0);
    m.entry.requestUserSwitchReload(client);
    await advance(LIMIT_MS - 1_000);
    expect(m.location.reloadPage).not.toHaveBeenCalled();
    gate.resolve();
    await advance(1);
    await advance(1);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
  });

  it("#298 AC-4: 予約の後に始まった操作も待つ（実行の直前に確かめ直す）", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_B);
    m.entry.requestUserSwitchReload(client);
    const late = startPending(client);
    await advance(LIMIT_MS - 1_000);
    expect(m.location.reloadPage).not.toHaveBeenCalled();
    late.gate.resolve();
    await advance(1);
    await advance(1);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
  });

  it("#298 AC-4: 待つ間にセッションが A に戻っても・消えても、取りやめない（文書の利用者は変わらないので読み込み直す）", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_B);
    const post = startPending(client);
    await advance(0);
    m.entry.requestUserSwitchReload(client);
    client.setQueryData(authKeys.session, sessionOf(USER_A));
    client.removeQueries({ queryKey: authKeys.session });
    expect(m.entry.getAccessLossReloadState()).toBe("waiting");
    post.gate.resolve();
    await advance(1);
    await advance(1);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
    expectNeverReleased(m);
  });
});

describe("#298 AC-4（Q7） 知らせ", () => {
  it("#298 AC-4（Q7）: 切り替えの読み込み直しは、知らせを書かない", async () => {
    const m = await freshDocument();
    m.entry.requestUserSwitchReload(clientSignedInAs(USER_B));
    await advance(1);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(NOTICE_KEY)).toBeNull();
  });

  it("#298 AC-4（Q7）: 前の文書で保存済みの喪失の知らせは、読み込み直す前に消え、新しい文書で B に何も出ない", async () => {
    const m = await freshDocument();
    window.sessionStorage.setItem(NOTICE_KEY, "lost");
    const order: string[] = [];
    vi.mocked(m.location.reloadPage).mockImplementation(() => {
      order.push(
        `reload:${window.sessionStorage.getItem(NOTICE_KEY) ?? "none"}`,
      );
    });
    m.entry.requestUserSwitchReload(clientSignedInAs(USER_B));
    await advance(1);
    expect(order).toEqual(["reload:none"]);
    const next = await freshDocument();
    expect(
      next.notice.takeAccessLossNotice(clientSignedInAs(USER_B)),
    ).toBeNull();
  });
});

describe("#298 AC-4 #338 の待機を引き継ぐ（抑止を途切れさせない）", () => {
  it("#298 AC-4: #338 の待機中（A・操作を待っている）に切り替えの入口を呼び、その後セッションが B になっても、抑止は外れず idle を経ない。喪失の知らせを書かず、読み込み直しは1回", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_A);
    const post = startPending(client);
    await advance(0);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    m.entry.requestUserSwitchReload(client);
    // #338 の待機の取りやめのきっかけ（キャッシュの購読の通知・finish の isOtherUser）を起こす
    client.setQueryData(authKeys.session, sessionOf(USER_B));
    expect(m.entry.getAccessLossReloadState()).toBe("waiting");
    post.gate.resolve();
    await advance(1);
    await advance(1);
    await advance(LIMIT_MS * 2);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
    expect(m.location.replacePage).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(NOTICE_KEY)).toBeNull();
    expectNeverReleased(m);
  });

  it("#298 AC-4: main.tsx と同じく見張りが入口を呼ぶ形で、#338 の待機中にセッションが B に替わっても、抑止は外れず idle を経ない。読み込み直しは1回で、知らせを書かない", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_A);
    const disposeDocument = m.auth.installDocumentUser(client);
    const disposeGuard = m.auth.installUserSwitchGuard(client, () =>
      m.entry.requestUserSwitchReload(client),
    );
    const post = startPending(client);
    await advance(0);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    client.setQueryData(authKeys.session, sessionOf(USER_B));
    expect(m.entry.getAccessLossReloadState()).toBe("waiting");
    expect(m.entry.isUserSwitchReloadRequested()).toBe(true);
    post.gate.resolve();
    await advance(1);
    await advance(1);
    await advance(LIMIT_MS * 2);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(NOTICE_KEY)).toBeNull();
    expectNeverReleased(m);
    disposeGuard();
    disposeDocument();
  });

  it("#298 AC-4: #338 の待機が1つ後のタスクを予約した直後に引き継ぎ、その後に B へ替わっても、遅れて走る #338 の終わり方で抑止が外れない", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_A);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    m.entry.requestUserSwitchReload(client);
    client.setQueryData(authKeys.session, sessionOf(USER_B));
    await advance(1);
    await advance(LIMIT_MS * 2);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(NOTICE_KEY)).toBeNull();
    expectNeverReleased(m);
  });
});

describe("#298 AC-4 切り替えの入口が動いている間の #338 の要求（逆向きの交錯）", () => {
  it("#298 AC-4: 切り替えの入口の waiting 中に、#338 の要求（A・lost / B・lost / A・left）が来ても何もしない。抑止は外れず、読み込み直しは1回で、知らせを書かず、/cases へ置き換えない", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_B);
    const post = startPending(client);
    await advance(0);
    m.entry.requestUserSwitchReload(client);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_B,
      reason: "lost",
    });
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_B,
      reason: "left",
      leftCasePath: "/channels",
    });
    expect(m.entry.getAccessLossReloadState()).toBe("waiting");
    post.gate.resolve();
    await advance(1);
    await advance(1);
    await advance(LIMIT_MS * 2);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
    expect(m.location.replacePage).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(NOTICE_KEY)).toBeNull();
    expectNeverReleased(m);
  });

  it("#298 AC-4: 実行の直前（1つ後のタスクの前）に #338 の要求が来ても何もしない。読み込み直しは1回", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_B);
    m.entry.requestUserSwitchReload(client);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_B,
      reason: "lost",
    });
    await advance(1);
    await advance(LIMIT_MS * 2);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(NOTICE_KEY)).toBeNull();
    expectNeverReleased(m);
  });

  it("#298 AC-4: reloading の後の #338 の要求・下書きの印は、何もしない", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_B);
    m.entry.requestUserSwitchReload(client);
    await advance(1);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_B,
      reason: "lost",
    });
    m.entry.noteDraftsRemain(USER_B);
    await advance(LIMIT_MS * 2);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
    expect(m.entry.getAccessLossReloadState()).toBe("reloading");
    expect(window.sessionStorage.getItem(NOTICE_KEY)).toBeNull();
  });
});

// 【3回目】コードレビュー（cr298c-1）の重大2：#338 の喪失の読み込み直しが、知らせを保存して reloading になった後
// （文書が置き換わる前）に、切り替えの入口が呼ばれたら、保存済みの知らせを消す（Q7）。読み込み直しは追加で起きない（全体で1回）。
describe("#298 AC-4（Q7） #338 の reloading の後の切り替え（コードレビューの重大2）", () => {
  it("#298 AC-4（Q7）: #338 が知らせ（lost）を保存して reloading になった後に、切り替えの入口が呼ばれると、保存済みの知らせを消す。読み込み直しは全体で1回", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_A);
    void m.entry.requestAccessLossReload(client, {
      ownerId: USER_A,
      reason: "lost",
    });
    await advance(1);
    // 前提：#338 の読み込み直しが動き、知らせが保存された
    expect(m.entry.getAccessLossReloadState()).toBe("reloading");
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(NOTICE_KEY)).toBe("lost");
    client.setQueryData(authKeys.session, sessionOf(USER_B));
    m.entry.requestUserSwitchReload(client);
    expect(window.sessionStorage.getItem(NOTICE_KEY)).toBeNull();
    await advance(LIMIT_MS * 2);
    expect(window.sessionStorage.getItem(NOTICE_KEY)).toBeNull();
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
    expect(m.location.replacePage).not.toHaveBeenCalled();
    expect(m.entry.getAccessLossReloadState()).toBe("reloading");
    // 新しい文書で B に前の利用者の知らせが出ない
    const next = await freshDocument();
    expect(
      next.notice.takeAccessLossNotice(clientSignedInAs(USER_B)),
    ).toBeNull();
  });
});

// 【ミューテーションの生き残りへの対応】docs/design/access-loss.md の requestAccessLossReload の行：返り値は「読み込み直したか取りやめたときに解決」。
// 切り替えの入口が #338 の待機を引き継いだ後は、その読み込み直しで文書が替わるので、#338 の要求の Promise も解決する（待ち続けにしない）。
describe("#298 AC-4 引き継いだ #338 の要求の返り値", () => {
  it("#298 AC-4: #338 の待機中に切り替えの入口を呼ぶと、#338 の要求の Promise は解決する。読み込み直しは1回", async () => {
    const m = await freshDocument();
    const client = clientSignedInAs(USER_A);
    const post = startPending(client);
    await advance(0);
    let resolved = false;
    void m.entry
      .requestAccessLossReload(client, { ownerId: USER_A, reason: "lost" })
      .then(() => {
        resolved = true;
      });
    m.entry.requestUserSwitchReload(client);
    post.gate.resolve();
    await advance(1);
    await advance(1);
    await advance(LIMIT_MS * 2);
    expect(m.location.reloadPage).toHaveBeenCalledTimes(1);
    expect(resolved).toBe(true);
  });
});
