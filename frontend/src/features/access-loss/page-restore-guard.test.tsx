// #342 AC-1〜AC-10（計画 plan342a2 の 3-5〜3-8・4 節、7 節の U5・U6・U7・U9・U10・U11・U12 の守りの側）：
// 復元の守り（page-restore-guard）。退避の準備がある文書では、pageshow の persisted によらず、セッションを直接取り直し、
// 同じ利用者なら、捕捉した対象の全件の概要を直接取る（同時に2件まで）。守り自身が始めた取得の答えだけで、外す・再試行・入口への引き渡しを決める。
// 合成した pagehide・pageshow は、実際の bfcache の保存・復元の証拠ではない。
// 組み立ては main.tsx と同じ（test/page-restore-harness.tsx）。確定の入口・概要の取得・セッションの確かめは本物、通信は MSW。
// 読み込み直しの状態（idle・waiting・reloading）は、このファイルで、手で切り替えられる差し替えにする（本物は idle から戻れないため）。
// 入口（requestAccessLossReload・requestUserSwitchReload）と、再遷移の口（retryReloadNavigationAfterPageRestore）は vi.fn。
// 実際の読み込み直し（location）は browser-location の差し替えで数える。データはすべて架空（testuser_・[UNIT_TEST]）。
// 前提にした口（実装の担当へ）：page-restore-guard.ts の getPageRestoreState()・retryPageRestoreVerification()（状態は idle・prepared・verifying・failed・handedOff）、
//   reload-after-access-loss.ts の retryReloadNavigationAfterPageRestore()。守りの組み立ての形は test/page-restore-harness.tsx の冒頭
import { QueryClient } from "@tanstack/react-query";
import { act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../../services/api-client";
import { TEST_USER } from "../../test/auth-handlers";
import { caseDetail, caseRoomId, caseSummary } from "../../test/case-handlers";
import {
  FakeBroadcastChannel,
  flushTasks,
} from "../../test/fake-broadcast-channel";
import {
  RESTORE_OTHER_USER,
  cacheParticipantSummary,
  firePageHide,
  firePageShow,
  gate,
  installRestoreGuardLikeMain,
  newRestoreClient,
  respondRestoreWorld,
  waitForSessionAnswered,
  waitForSummaryAnswered,
  type RestoreWorld,
  type SessionAnswer,
  type SummaryAnswer,
} from "../../test/page-restore-harness";
import { caseAccessTargets } from "../cases/case-access-evidence";
import {
  currentLossPeriod,
  startCaseParticipationPeriod,
} from "../cases/case-access-loss-monitor";
import { isBeforeUnloadSuppressed, restoreBeforeUnload } from "../leave-guard";
import { reloadPage } from "./browser-location";
import {
  getPageRestoreState,
  retryPageRestoreVerification,
} from "./page-restore-guard";
import {
  requestAccessLossReload,
  requestUserSwitchReload,
  retryReloadNavigationAfterPageRestore,
} from "./reload-after-access-loss";

const reloadState = vi.hoisted(() => {
  let value: "idle" | "waiting" | "reloading" = "idle";
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: "idle" | "waiting" | "reloading") {
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});

vi.mock("./reload-after-access-loss", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestAccessLossReload: vi.fn(() => Promise.resolve()),
  requestUserSwitchReload: vi.fn(),
  getAccessLossReloadState: reloadState.get,
  subscribeAccessLossReloadState: reloadState.subscribe,
  retryReloadNavigationAfterPageRestore: vi.fn(),
}));
vi.mock("./browser-location", () => ({
  reloadPage: vi.fn(),
  replacePage: vi.fn(),
}));

const USER = TEST_USER.id;
const N_A = 3421;
const N_B = 3422;
const N_C = 3423;
const CHANNEL = "internal-system:access-loss:v1";
const summaryKey = (n: number) => ["cases", "summary", USER, caseSummary(n).id];
const detailKey = (n: number) => ["cases", "detail", USER, caseSummary(n).id];
const draftKey = (n: number) =>
  `internal-system:draft:v1:${USER}:room:${caseRoomId(n)}`;

let reportError: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  reportError = vi.fn();
  vi.stubGlobal("reportError", reportError);
  FakeBroadcastChannel.clearSent();
  reloadState.set("idle");
  vi.mocked(requestAccessLossReload).mockClear();
  vi.mocked(requestUserSwitchReload).mockClear();
  vi.mocked(retryReloadNavigationAfterPageRestore).mockClear();
  vi.mocked(reloadPage).mockClear();
});
afterEach(() => {
  restoreBeforeUnload();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Doc = { client: QueryClient; world: RestoreWorld; ids: string[] };

/** 参加者の案件（概要・詳細・その部屋の下書き）を持つ文書。守りを登録する */
function arrangeDocument(
  cases: number[],
  options: Parameters<typeof installRestoreGuardLikeMain>[1] = {},
): Doc & { navigations: string[]; dispose: () => void } {
  const world = respondRestoreWorld();
  const client = newRestoreClient();
  const ids = cases.map((n) => {
    cacheParticipantSummary(client, n);
    client.setQueryData(detailKey(n), caseDetail(n));
    window.localStorage.setItem(
      draftKey(n),
      JSON.stringify({
        body: `[UNIT_TEST]342書きかけ${n}`,
        updatedAt: Date.now(),
      }),
    );
    return world.addCase(n);
  });
  const wiring = installRestoreGuardLikeMain(client, options);
  return { client, world, ids, ...wiring };
}

function restore(persistedHide = true, persistedShow = true) {
  firePageHide(persistedHide);
  firePageShow(persistedShow);
}

async function waitForState(state: ReturnType<typeof getPageRestoreState>) {
  await waitFor(() => expect(getPageRestoreState()).toBe(state));
}

const draftKept = (n: number) =>
  window.localStorage.getItem(draftKey(n)) !== null;
const announced = () => FakeBroadcastChannel.sent(CHANNEL);

function answerCase(
  world: RestoreWorld,
  n: number,
  ...answers: SummaryAnswer[]
) {
  world.caseOf(caseSummary(n).id).answers.push(...answers);
}

function holdCase(world: RestoreWorld, n: number) {
  const held = gate();
  world.caseOf(caseSummary(n).id).gates.push(held.promise);
  return held;
}

describe("#342 AC-1・AC-10 U5 退避の準備があれば、pageshow の persisted によらず確かめる", () => {
  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])(
    "#342 AC-1 U5: pagehide（persisted=%s）→ pageshow（persisted=%s）：セッションを1回・対象の概要を1回、直接取り、参加者なら idle に戻る",
    async (hide, show) => {
      const { world, ids } = arrangeDocument([N_A]);
      firePageHide(hide);
      expect(getPageRestoreState()).toBe("prepared");
      firePageShow(show);
      await waitForState("idle");
      expect(world.session.calls).toBe(1);
      expect(world.summaryCalls).toEqual(ids);
    },
  );
});

describe("#342 AC-2・AC-4・AC-6・AC-7 U6 全件を確かめる・同時に2件まで・一部の成功では外さない", () => {
  it("#342 AC-2 U6: 3件の対象は、同時に2件までで確かめ、全件が参加者のときだけ idle に戻る", async () => {
    const { world, ids } = arrangeDocument([N_A, N_B, N_C]);
    const held = [N_A, N_B, N_C].map((n) => holdCase(world, n));
    restore();
    await waitFor(() => expect(world.summaryCalls).toHaveLength(2));
    await flushTasks(3);
    expect(world.summaryCalls).toHaveLength(2);
    expect(getPageRestoreState()).toBe("verifying");
    // 1件目が届くまで、3件目を始めない。届いたら始める
    const first = world.summaryCalls[0] ?? "";
    held[ids.indexOf(first)]?.release();
    await waitFor(() => expect(world.summaryCalls).toHaveLength(3));
    expect(getPageRestoreState()).toBe("verifying");
    for (const each of held) each.release();
    await waitForState("idle");
    expect(world.summaryMaxInFlight).toBe(2);
    expect([...world.summaryCalls].sort()).toEqual([...ids].sort());
  });

  it("#342 AC-4・AC-7 U6: 一部が参加者と分かっても、残りが届くまで外さない", async () => {
    const { world } = arrangeDocument([N_A, N_B]);
    const heldB = holdCase(world, N_B);
    restore();
    await waitForSummaryAnswered(world, 1);
    await flushTasks(3);
    expect(getPageRestoreState()).toBe("verifying");
    heldB.release();
    await waitForState("idle");
  });

  it("#342 AC-2 U6: 捕捉の後に、その案件のキャッシュが消えても、確かめ済みにせず、捕捉した対象を確かめる（不在から喪失も決めない）", async () => {
    const { client, world, ids } = arrangeDocument([N_A]);
    firePageHide(true);
    client.removeQueries({ queryKey: summaryKey(N_A) });
    client.removeQueries({ queryKey: detailKey(N_A) });
    firePageShow(true);
    await waitForState("idle");
    expect(world.summaryCalls).toEqual(ids);
    expect(requestAccessLossReload).not.toHaveBeenCalled();
  });

  it("#342 AC-6 U6: 再試行は、セッションと、捕捉した全件を取り直す（前回の一部の成功を使わない）", async () => {
    const { world, ids } = arrangeDocument([N_A, N_B]);
    answerCase(world, N_B, {
      kind: "status",
      status: 500,
      code: "INTERNAL_ERROR",
    });
    restore();
    await waitForState("failed");
    expect(world.session.calls).toBe(1);
    await act(async () => {
      retryPageRestoreVerification();
    });
    await waitForState("idle");
    expect(world.session.calls).toBe(2);
    expect([...world.summaryCalls].sort()).toEqual([...ids, ...ids].sort());
  });

  it("#342 AC-6・AC-7 U6: 確かめの途中に、通常の確かめが参加の期間を進めたら、守りの答え（参加者）は採用されず、failed になり、再試行で通る", async () => {
    const { client, world, ids } = arrangeDocument([N_A]);
    const held = holdCase(world, N_A);
    restore();
    await waitFor(() => expect(world.summaryCalls).toEqual(ids));
    startCaseParticipationPeriod(client, USER, ids[0] ?? "");
    held.release();
    await waitForState("failed");
    expect(requestAccessLossReload).not.toHaveBeenCalled();
    await act(async () => {
      retryPageRestoreVerification();
    });
    await waitForState("idle");
  });

  it("#342 AC-2・AC-10 U6: 捕捉の時にセッションのキャッシュの利用者が無ければ、対象は0件（文書の利用者で補わない）：隠さず、確かめない", async () => {
    const world = respondRestoreWorld();
    world.addCase(N_A);
    const client = newRestoreClient();
    installRestoreGuardLikeMain(client);
    client.removeQueries({ queryKey: ["auth", "session"] });
    cacheParticipantSummary(client, N_A);
    restore();
    expect(getPageRestoreState()).toBe("idle");
    // 対照：同じ文書で、セッションが分かってから離れると、確かめる（前の pageshow の分の通信が無いことも、ここで確かめる）
    client.setQueryData(["auth", "session"], {
      user: TEST_USER,
      permissions: [],
      mustChangePassword: false,
      reauthenticatedAt: null,
    });
    restore();
    await waitForState("idle");
    expect(world.session.calls).toBe(1);
  });

  it("#342 AC-6・AC-7 U6: 捕捉の後にセッションのキャッシュが消えても、捕捉した対象は消さず、照合が成り立たないとして failed（外さない）", async () => {
    const { client, world, ids } = arrangeDocument([N_A]);
    firePageHide(true);
    client.removeQueries({ queryKey: ["auth", "session"] });
    firePageShow(true);
    await waitForState("failed");
    expect(world.summaryCalls).toEqual(ids);
    expect(requestAccessLossReload).not.toHaveBeenCalled();
    expect(draftKept(N_A)).toBe(true);
  });

  it("#342 AC-4 U6: 確かめの答えを、セッション・概要のキャッシュに書き戻さない", async () => {
    const { client } = arrangeDocument([N_A]);
    const session = client.getQueryState(["auth", "session"]);
    const summary = client.getQueryState(summaryKey(N_A));
    restore();
    await waitForState("idle");
    expect(client.getQueryState(["auth", "session"])?.dataUpdatedAt).toBe(
      session?.dataUpdatedAt,
    );
    expect(client.getQueryState(["auth", "session"])?.data).toBe(session?.data);
    expect(client.getQueryState(summaryKey(N_A))?.data).toBe(summary?.data);
  });
});

describe("#342 AC-7 U7 古い試行の遅い答えでは、外さない・確定しない", () => {
  it("#342 AC-7 U7: 確かめの途中にもう一度離れたら、前の試行のセッションの答えで、案件を確かめず、外さない。次の復元で確かめ直す", async () => {
    const { world, ids } = arrangeDocument([N_A]);
    const held = gate();
    world.session.gates.push(held.promise);
    restore();
    await waitFor(() => expect(world.session.calls).toBe(1));
    firePageHide(true);
    expect(getPageRestoreState()).toBe("prepared");
    held.release();
    await waitForSessionAnswered(world, 1);
    await flushTasks(3);
    expect(getPageRestoreState()).toBe("prepared");
    expect(world.summaryCalls).toEqual([]);
    firePageShow(true);
    await waitForState("idle");
    expect(world.summaryCalls).toEqual(ids);
  });

  it("#342 AC-7 U7: 新しい試行で外した後に、前の試行の概要（非参加）が遅れて届いても、確定の入口を呼ばない（片付け・入口・合図・下書きの消去なし）", async () => {
    const { client, world } = arrangeDocument([N_A]);
    answerCase(world, N_A, { kind: "outsider" }, { kind: "participant" });
    const held = holdCase(world, N_A);
    restore();
    await waitFor(() => expect(world.summaryCalls).toHaveLength(1));
    restore();
    await waitForState("idle");
    held.release();
    await waitForSummaryAnswered(world, 2);
    await flushTasks(3);
    expect(getPageRestoreState()).toBe("idle");
    expect(requestAccessLossReload).not.toHaveBeenCalled();
    expect(announced()).toEqual([]);
    expect(draftKept(N_A)).toBe(true);
    expect(client.getQueryData(detailKey(N_A))).toBeDefined();
  });

  it("#342 AC-6・AC-7 U7: 一部が確かめられずに failed になった後、残っていた要求が参加者で届いても、外さない", async () => {
    const { world } = arrangeDocument([N_A, N_B]);
    const heldA = holdCase(world, N_A);
    answerCase(world, N_B, { kind: "network" });
    restore();
    await waitForState("failed");
    heldA.release();
    await waitForSummaryAnswered(world, 2);
    await flushTasks(3);
    expect(getPageRestoreState()).toBe("failed");
  });

  it("#342 AC-5・AC-7 U7: 引き渡し（handedOff）の後に、残っていた要求が参加者で届いても、外さない", async () => {
    const { world } = arrangeDocument([N_A, N_B]);
    answerCase(world, N_A, { kind: "outsider" });
    const heldB = holdCase(world, N_B);
    restore();
    await waitForState("handedOff");
    heldB.release();
    await waitForSummaryAnswered(world, 2);
    await flushTasks(3);
    expect(getPageRestoreState()).toBe("handedOff");
    expect(requestAccessLossReload).toHaveBeenCalledTimes(1);
  });

  it("#342 AC-7 U7: 登録を解除した後に、確かめの答え（非参加）が届いても、確定の入口を呼ばない", async () => {
    const { client, world, dispose } = arrangeDocument([N_A]);
    answerCase(world, N_A, { kind: "outsider" });
    const held = holdCase(world, N_A);
    restore();
    await waitFor(() => expect(world.summaryCalls).toHaveLength(1));
    dispose();
    expect(getPageRestoreState()).toBe("idle");
    held.release();
    await waitForSummaryAnswered(world, 1);
    await flushTasks(3);
    expect(requestAccessLossReload).not.toHaveBeenCalled();
    expect(client.getQueryData(detailKey(N_A))).toBeDefined();
    expect(getPageRestoreState()).toBe("idle");
  });
});

// 統括の判断（2026-11-28。テストの報告の確認 2）：登録ごとの識別と試行の番号の両方で照らす。
// 解除して登録し直すと試行の番号は初期に戻るので、古い登録の試行と、新しい登録の試行の番号がぶつかりうる
describe("#342 AC-7 U7 登録の解除と再登録をまたいだ古い答え（統括の判断 2026-11-28）", () => {
  it("#342 AC-7 U7: 確かめの途中に登録を解除して登録し直し、新しい復元の確かめの途中に、古い登録の答え（非参加）が届いても、新しい登録の状態は変わらず、確定（入口・合図・下書きの消去）も起きない。その後、新しい答えが届けば、そのとおりに外れる", async () => {
    const { client, world, dispose } = arrangeDocument([N_A]);
    answerCase(world, N_A, { kind: "outsider" }, { kind: "participant" });
    const heldOld = holdCase(world, N_A);
    const heldNew = holdCase(world, N_A);
    restore();
    await waitFor(() => expect(world.summaryCalls).toHaveLength(1));
    dispose();
    expect(getPageRestoreState()).toBe("idle");
    installRestoreGuardLikeMain(client);
    restore();
    await waitFor(() => expect(world.summaryCalls).toHaveLength(2));
    expect(getPageRestoreState()).toBe("verifying");
    heldOld.release();
    await waitForSummaryAnswered(world, 1);
    await flushTasks(3);
    expect(getPageRestoreState()).toBe("verifying");
    expect(requestAccessLossReload).not.toHaveBeenCalled();
    expect(announced()).toEqual([]);
    expect(draftKept(N_A)).toBe(true);
    expect(client.getQueryData(detailKey(N_A))).toBeDefined();
    heldNew.release();
    await waitForState("idle");
    expect(requestAccessLossReload).not.toHaveBeenCalled();
    expect(draftKept(N_A)).toBe(true);
  });
});

// 統括の判断（2026-11-28。テストの報告の確認 1）：pagehide で対象の捕捉が例外で終わったら、隠したまま（prepared）、例外は reportError。
// その後の pageshow では、捕まえた対象が無いので、案件を確かめずに failed（再試行）。再試行では、セッションの確かめからやり直し、
// 対象は、その時点のキャッシュから捕まえ直す。捕まえ直しも例外なら failed のまま（例外は reportError）
describe("#342 AC-1・AC-6 U5 対象の捕捉の例外の後（統括の判断 2026-11-28）", () => {
  /** 最初の failures 回だけ投げ、その後は本物の捕捉（caseAccessTargets）を返す */
  function throwingTargets(client: QueryClient, failures: number) {
    const failure = new Error("[UNIT_TEST]342捕捉の失敗");
    let calls = 0;
    const listTargets = (userId: string) => {
      calls += 1;
      if (calls <= failures) throw failure;
      return caseAccessTargets(client, userId);
    };
    return { failure, listTargets, calls: () => calls };
  }

  function arrangeThrowing(failures: number) {
    const world = respondRestoreWorld();
    const client = newRestoreClient();
    cacheParticipantSummary(client, N_A);
    const id = world.addCase(N_A);
    const targets = throwingTargets(client, failures);
    installRestoreGuardLikeMain(client, {
      overrides: { listTargets: targets.listTargets },
    });
    return { world, id, targets };
  }

  it("#342 AC-1・AC-6 U5: 捕捉が例外で終わったら prepared のまま（reportError に渡す）。その後の pageshow では、案件を確かめずに failed", async () => {
    const { world, targets } = arrangeThrowing(1);
    firePageHide(true);
    expect(getPageRestoreState()).toBe("prepared");
    expect(reportError).toHaveBeenCalledWith(targets.failure);
    firePageShow(true);
    await waitForState("failed");
    expect(world.summaryCalls).toEqual([]);
    expect(requestAccessLossReload).not.toHaveBeenCalled();
  });

  it("#342 AC-1・AC-6 U5: 捕捉の例外で failed になった後の再試行は、セッションを確かめ直し、その時点のキャッシュから対象を捕まえ直す。全件が参加者なら外れる", async () => {
    const { world, id, targets } = arrangeThrowing(1);
    firePageHide(true);
    firePageShow(true);
    await waitForState("failed");
    const sessionCalls = world.session.calls;
    await act(async () => {
      retryPageRestoreVerification();
    });
    await waitForState("idle");
    expect(world.session.calls).toBe(sessionCalls + 1);
    expect(world.summaryCalls).toEqual([id]);
    expect(targets.calls()).toBe(2);
  });

  it("#342 AC-1・AC-6 U5: 再試行の捕まえ直しも例外なら、failed のまま（例外は reportError に渡し、案件を確かめない）", async () => {
    const { world, targets } = arrangeThrowing(2);
    firePageHide(true);
    firePageShow(true);
    await waitForState("failed");
    await act(async () => {
      retryPageRestoreVerification();
    });
    await waitFor(() => expect(targets.calls()).toBe(2));
    await waitFor(() => expect(reportError).toHaveBeenCalledTimes(2));
    await flushTasks(3);
    expect(getPageRestoreState()).toBe("failed");
    expect(world.summaryCalls).toEqual([]);
    expect(reportError).toHaveBeenNthCalledWith(2, targets.failure);
  });
});

describe("#342 AC-3 別の利用者", () => {
  it("#342 AC-3: 復元の後のセッションが別の利用者なら、案件を確かめず、切り替えの入口を1回呼ぶ。喪失の片付け・入口・合図・下書きの消去はしない", async () => {
    const { client, world } = arrangeDocument([N_A]);
    world.session.answers.push({ kind: "user", user: RESTORE_OTHER_USER });
    restore();
    await waitFor(() =>
      expect(requestUserSwitchReload).toHaveBeenCalledTimes(1),
    );
    await flushTasks(3);
    expect(world.summaryCalls).toEqual([]);
    expect(requestAccessLossReload).not.toHaveBeenCalled();
    expect(announced()).toEqual([]);
    expect(draftKept(N_A)).toBe(true);
    expect(client.getQueryData(detailKey(N_A))).toBeDefined();
    expect(getPageRestoreState()).not.toBe("idle");
  });
});

const UNAUTHENTICATED_CODES = [
  ["UNAUTHENTICATED", "UNAUTHENTICATED"],
  ["別のコード", "SESSION_EXPIRED"],
  ["コードの欠落（UNKNOWN_ERROR に変換される）", undefined],
] as const;

describe("#342 AC-8 U9 復元の確かめの 401 は、HTTP の状態で決め、覆ったまま読み込み直す", () => {
  it.each(UNAUTHENTICATED_CODES)(
    "#342 AC-8 U9: セッションの直接の確かめが 401（%s）なら、案件を確かめず、離脱の確認を止めて、読み込み直しを1回。handedOff のまま",
    async (_label, code) => {
      const { world } = arrangeDocument([N_A]);
      world.session.answers.push({ kind: "status", status: 401, code });
      restore();
      await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
      await flushTasks(3);
      expect(reloadPage).toHaveBeenCalledTimes(1);
      expect(isBeforeUnloadSuppressed()).toBe(true);
      expect(world.summaryCalls).toEqual([]);
      expect(getPageRestoreState()).toBe("handedOff");
      expect(requestAccessLossReload).not.toHaveBeenCalled();
      expect(announced()).toEqual([]);
      expect(draftKept(N_A)).toBe(true);
    },
  );

  it.each([
    ["/login", []],
    ["/setup", ["/login"]],
  ] as const)(
    "#342 AC-8 U9: 共通の 401 の処理の移動に頼らない：いまの場所が %s でも、守りが自分で読み込み直す（共通の処理の移動は %j のまま）",
    async (path, navigated) => {
      const { world, navigations } = arrangeDocument([N_A], {
        currentPath: () => path,
      });
      world.session.answers.push({
        kind: "status",
        status: 401,
        code: "UNAUTHENTICATED",
      });
      restore();
      await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
      expect(navigations).toEqual(navigated);
    },
  );

  it.each(UNAUTHENTICATED_CODES)(
    "#342 AC-8 U9: 案件の概要の直接の取得が 401（%s）なら、取得の答えから、覆ったまま読み込み直しを1回",
    async (_label, code) => {
      const { world } = arrangeDocument([N_A]);
      answerCase(world, N_A, { kind: "status", status: 401, code });
      restore();
      await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
      await flushTasks(3);
      expect(reloadPage).toHaveBeenCalledTimes(1);
      expect(getPageRestoreState()).toBe("handedOff");
      expect(requestAccessLossReload).not.toHaveBeenCalled();
    },
  );

  it("#342 AC-8 U9: 案件の概要が 409 SESSION_USER_MISMATCH で、その後のセッションの取り直しが 401 なら、読み込み直しを1回", async () => {
    const { world } = arrangeDocument([N_A]);
    world.session.answers.push(
      { kind: "user", user: TEST_USER },
      { kind: "status", status: 401, code: "UNAUTHENTICATED" },
    );
    answerCase(world, N_A, {
      kind: "status",
      status: 409,
      code: "SESSION_USER_MISMATCH",
    });
    restore();
    await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
    await flushTasks(3);
    expect(reloadPage).toHaveBeenCalledTimes(1);
    expect(getPageRestoreState()).toBe("handedOff");
  });

  it("#342 AC-8 U9: 2件の概要が両方 401 でも、読み込み直しは1回", async () => {
    const { world } = arrangeDocument([N_A, N_B]);
    answerCase(world, N_A, { kind: "status", status: 401 });
    answerCase(world, N_B, { kind: "status", status: 401 });
    restore();
    await waitForSummaryAnswered(world, 2);
    await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
    await flushTasks(3);
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it("#342 AC-8 U9: 401 で読み込み直しに進んだ後に、残りの概要が確かめられない（500）で届いても、遷移を重ねず、failed にしない", async () => {
    const { world } = arrangeDocument([N_A, N_B]);
    answerCase(world, N_A, {
      kind: "status",
      status: 401,
      code: "UNAUTHENTICATED",
    });
    answerCase(world, N_B, {
      kind: "status",
      status: 500,
      code: "INTERNAL_ERROR",
    });
    const heldB = holdCase(world, N_B);
    restore();
    await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
    heldB.release();
    await waitForSummaryAnswered(world, 2);
    await flushTasks(3);
    expect(reloadPage).toHaveBeenCalledTimes(1);
    expect(getPageRestoreState()).toBe("handedOff");
  });

  it("#342 AC-10 U9: 復元でない、通常の要求の 401 は、これまでの共通の処理のまま（守りは読み込み直さない）", async () => {
    const { world, navigations } = arrangeDocument([N_A]);
    answerCase(world, N_A, {
      kind: "status",
      status: 401,
      code: "UNAUTHENTICATED",
    });
    await expect(
      apiClient.get(`/cases/${caseSummary(N_A).id}`),
    ).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    await waitForSummaryAnswered(world, 1);
    await flushTasks(3);
    expect(navigations).toEqual(["/login"]);
    expect(reloadPage).not.toHaveBeenCalled();
    expect(getPageRestoreState()).toBe("idle");
  });
});

const SESSION_RESULTS: [string, SessionAnswer][] = [
  ["同じ利用者", { kind: "user", user: TEST_USER }],
  ["401", { kind: "status", status: 401, code: "UNAUTHENTICATED" }],
  ["通信の失敗", { kind: "network" }],
  ["確かめの例外（応答の検証の失敗）", { kind: "invalid" }],
];

describe("#342 AC-9 U10 復元のときに、読み込み直しが idle でない", () => {
  it.each(SESSION_RESULTS)(
    "#342 AC-9 U10: waiting から戻り、セッションが%sなら、案件を確かめず、外さず、既存の待機を続ける（再遷移・読み込み直し・切り替えの入口なし）",
    async (label, answer) => {
      const { world } = arrangeDocument([N_A]);
      reloadState.set("waiting");
      world.session.answers.push(answer);
      restore();
      await waitForSessionAnswered(world, 1);
      await flushTasks(3);
      expect(world.summaryCalls).toEqual([]);
      expect(retryReloadNavigationAfterPageRestore).not.toHaveBeenCalled();
      expect(reloadPage).not.toHaveBeenCalled();
      expect(requestUserSwitchReload).not.toHaveBeenCalled();
      expect(getPageRestoreState()).not.toBe("idle");
      if (label.startsWith("確かめの例外"))
        expect(reportError).toHaveBeenCalled();
    },
  );

  it("#342 AC-9 U10: waiting から戻り、セッションが別の利用者なら、切り替えの入口へ渡す（案件は確かめない）", async () => {
    const { world } = arrangeDocument([N_A]);
    reloadState.set("waiting");
    world.session.answers.push({ kind: "user", user: RESTORE_OTHER_USER });
    restore();
    await waitFor(() =>
      expect(requestUserSwitchReload).toHaveBeenCalledTimes(1),
    );
    expect(world.summaryCalls).toEqual([]);
    expect(retryReloadNavigationAfterPageRestore).not.toHaveBeenCalled();
  });

  it.each(SESSION_RESULTS)(
    "#342 AC-9 U10: reloading から戻り、セッションが%sでも、その復元について再遷移を1回だけ求める（案件は確かめず、直接の読み込み直しはしない）",
    async (label, answer) => {
      const { world } = arrangeDocument([N_A]);
      reloadState.set("reloading");
      world.session.answers.push(answer);
      restore();
      await waitFor(() =>
        expect(retryReloadNavigationAfterPageRestore).toHaveBeenCalledTimes(1),
      );
      await waitForSessionAnswered(world, 1);
      await flushTasks(3);
      expect(retryReloadNavigationAfterPageRestore).toHaveBeenCalledTimes(1);
      expect(reloadPage).not.toHaveBeenCalled();
      expect(world.summaryCalls).toEqual([]);
      expect(getPageRestoreState()).not.toBe("idle");
      if (label.startsWith("確かめの例外"))
        expect(reportError).toHaveBeenCalled();
    },
  );

  it("#342 AC-9 U10: reloading から戻り、セッションが別の利用者なら、先に切り替えの入口を呼び（喪失の知らせを消す）、その後に再遷移を1回", async () => {
    const { world } = arrangeDocument([N_A]);
    reloadState.set("reloading");
    world.session.answers.push({ kind: "user", user: RESTORE_OTHER_USER });
    restore();
    await waitFor(() =>
      expect(retryReloadNavigationAfterPageRestore).toHaveBeenCalledTimes(1),
    );
    expect(requestUserSwitchReload).toHaveBeenCalledTimes(1);
    const switchOrder =
      vi.mocked(requestUserSwitchReload).mock.invocationCallOrder[0] ?? 0;
    const retryOrder =
      vi.mocked(retryReloadNavigationAfterPageRestore).mock
        .invocationCallOrder[0] ?? 0;
    expect(switchOrder).toBeGreaterThan(0);
    expect(switchOrder).toBeLessThan(retryOrder);
    expect(world.summaryCalls).toEqual([]);
  });

  it("#342 AC-9 U10: reloading の再遷移は、確かめの再試行では増えず、次の復元で、もう1回", async () => {
    const { world } = arrangeDocument([N_A]);
    reloadState.set("reloading");
    restore();
    await waitFor(() =>
      expect(retryReloadNavigationAfterPageRestore).toHaveBeenCalledTimes(1),
    );
    await act(async () => {
      retryPageRestoreVerification();
    });
    await flushTasks(3);
    expect(retryReloadNavigationAfterPageRestore).toHaveBeenCalledTimes(1);
    restore();
    await waitFor(() =>
      expect(retryReloadNavigationAfterPageRestore).toHaveBeenCalledTimes(2),
    );
    expect(world.summaryCalls).toEqual([]);
  });

  it("#342 AC-9 U10: 確かめの途中に読み込み直しが waiting になったら、参加者の答えが届いても外さない", async () => {
    const { world } = arrangeDocument([N_A]);
    const held = holdCase(world, N_A);
    restore();
    await waitFor(() => expect(world.summaryCalls).toHaveLength(1));
    reloadState.set("waiting");
    held.release();
    await waitForSummaryAnswered(world, 1);
    await flushTasks(3);
    expect(getPageRestoreState()).not.toBe("idle");
    expect(requestAccessLossReload).not.toHaveBeenCalled();
  });
});

describe("#342 AC-10 U11 不要な確かめを始めない", () => {
  it.each([true, false])(
    "#342 AC-10 U11: 対象が0件・読み込み直しが idle の文書は、離れても戻っても（pageshow の persisted=%s）、隠さず、確かめない",
    async (persisted) => {
      const world = respondRestoreWorld();
      world.addCase(N_A);
      const client = newRestoreClient();
      installRestoreGuardLikeMain(client);
      restore(true, persisted);
      expect(getPageRestoreState()).toBe("idle");
      // 対照：対象ができた後の復元では確かめる（前の pageshow の分の通信が無いことも、ここで確かめる）
      cacheParticipantSummary(client, N_A);
      restore();
      await waitForState("idle");
      await waitForSummaryAnswered(world, 1);
      expect(world.session.calls).toBe(1);
    },
  );

  it.each([false, true])(
    "#342 AC-10 U11: 退避の準備が無い文書（初回・新しい文書）の pageshow（persisted=%s）では、確かめを始めない",
    async (persisted) => {
      const { world } = arrangeDocument([N_A]);
      firePageShow(persisted);
      expect(getPageRestoreState()).toBe("idle");
      // 対照：離れてから戻ると確かめる
      restore();
      await waitForState("idle");
      expect(world.session.calls).toBe(1);
    },
  );

  it("#342 AC-10 U11: アプリの中の「戻る」（履歴の移動。pagehide・pageshow なし）では、確かめを始めない", async () => {
    const { world } = arrangeDocument([N_A]);
    window.history.pushState(null, "", "/threads");
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    window.history.replaceState(null, "", "/");
    expect(getPageRestoreState()).toBe("idle");
    restore();
    await waitForState("idle");
    expect(world.session.calls).toBe(1);
  });

  it("#342 AC-10 U11: 退避と復元が続いても、復元ごとに1回ずつ確かめる", async () => {
    const { world, ids } = arrangeDocument([N_A]);
    restore();
    await waitForState("idle");
    restore();
    await waitForState("idle");
    await waitForSummaryAnswered(world, 2);
    expect(world.session.calls).toBe(2);
    expect(world.summaryCalls).toEqual([...ids, ...ids]);
  });
});

describe("#342 AC-5・AC-6 U12 概要の 403 と、通信の失敗・5xx を分ける", () => {
  it("#342 AC-5 U12: 概要が 403 なら、その案件の中身を片付けて（概要は参加者のまま）、読み込み直しの入口を呼ぶ。下書きは消さず、合図を送らず、参加の期間を変えない", async () => {
    const { client, world, ids } = arrangeDocument([N_A]);
    const period = currentLossPeriod(client, USER, ids[0] ?? "");
    answerCase(world, N_A, { kind: "status", status: 403, code: "FORBIDDEN" });
    restore();
    await waitForState("handedOff");
    expect(vi.mocked(requestAccessLossReload).mock.calls).toEqual([
      [client, { ownerId: USER, reason: "lost" }],
    ]);
    expect(client.getQueryData(detailKey(N_A))).toBeUndefined();
    expect(
      client.getQueryData<{ isParticipant: boolean }>(summaryKey(N_A))
        ?.isParticipant,
    ).toBe(true);
    expect(draftKept(N_A)).toBe(true);
    expect(announced()).toEqual([]);
    expect(currentLossPeriod(client, USER, ids[0] ?? "")).toBe(period);
  });

  it.each([
    ["500", { kind: "status", status: 500, code: "INTERNAL_ERROR" }],
    ["503", { kind: "status", status: 503, code: "SERVICE_UNAVAILABLE" }],
    ["通信の失敗", { kind: "network" }],
  ] as [string, SummaryAnswer][])(
    "#342 AC-6 U12: 概要が%sなら、片付け・読み込み直し・下書きの消去・合図をせず、failed（隠したまま）",
    async (_label, answer) => {
      const { client, world } = arrangeDocument([N_A]);
      answerCase(world, N_A, answer);
      restore();
      await waitForState("failed");
      expect(requestAccessLossReload).not.toHaveBeenCalled();
      expect(reloadPage).not.toHaveBeenCalled();
      expect(client.getQueryData(detailKey(N_A))).toBeDefined();
      expect(draftKept(N_A)).toBe(true);
      expect(announced()).toEqual([]);
    },
  );

  it("#342 AC-5 U12: 概要が 404 なら notFound として確定の入口へ渡す（入口・合図・下書きの消去）。handedOff", async () => {
    const { client, world } = arrangeDocument([N_A]);
    answerCase(world, N_A, { kind: "status", status: 404, code: "NOT_FOUND" });
    restore();
    await waitForState("handedOff");
    expect(vi.mocked(requestAccessLossReload).mock.calls).toEqual([
      [client, { ownerId: USER, reason: "lost" }],
    ]);
    await waitFor(() => expect(draftKept(N_A)).toBe(false));
    expect(announced()).toEqual([
      { v: 1, userId: USER, caseId: caseSummary(N_A).id },
    ]);
  });
});
