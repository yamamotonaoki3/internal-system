// #342（342-A。計画 plan342a2 の 3 節・7 節）：ブラウザの「戻る」で文書が丸ごと戻る場合（bfcache）の守り（page-restore-guard）のテストの共通の準備。
// データはすべて架空（testuser_342_・[UNIT_TEST]）。
// - main.tsx と同じ組み立てで、守りを登録する（installRestoreGuardLikeMain）。守りが使う関数は、本番の公開口を、関数として渡す
//   （access-loss は cases に依存しないので、main.tsx が関数で渡す。計画 3-1）。
// - pagehide・pageshow を合成する（PageTransitionEvent。無ければ Event に persisted を足す）。
//   合成したイベントは、実際の bfcache の保存・復元の証拠ではない（実復元の確かめは、通常のブラウザでの M1〜M3。計画 8 節）。
// - 復元の確かめの通信（GET /api/auth/session・GET /api/cases/:caseId）を、答えの列と保留つきで返し、数える（respondRestoreWorld）。
// - 後始末（計画レビュー3回目の軽微3）：各テストの後に、登録した守り・文書の利用者・見張り・切り替えの見張りを解除する。
//   守りの登録の解除で、守りの状態は idle に、試行の番号は初期に戻る（前のテストの状態を、境界を描く次のテストに残さない）。
// 前提にした口（実装の担当へ。計画が決めた名前と、テストの担当が決めた形。報告の一覧と同じ）：
//   features/access-loss/page-restore-guard.ts：
//     installPageRestoreGuard(options: {
//       queryClient: QueryClient;
//       verifySession: () => Promise<"same" | "otherUser" | "unauthenticated" | "unknown">;
//       onOtherUser: () => void;
//       listTargets: (userId: string) => readonly { caseId: string; roomId: string | null }[];
//       contextOf: (userId: string, target: { caseId: string; roomId: string | null }) =>
//         { userId: string; caseId: string; roomId: string | null; generation: number; period: number };
//       verifyCase: (caseId: string) => Promise<{ verdict: "participant" | "lost" | "notFound" | "unverified" | "switched"; failureStatus: number | null }>;
//       settleCase: (context: 上の contextOf の値, verdict: "participant" | "lost" | "notFound" | "switched" | "forbidden") =>
//         "confirmed" | "handedOff" | "unverified";
//     }): () => void（登録の解除。状態を idle・試行の番号を初期に戻す）
//     window の pagehide・pageshow を受ける。対象の捕捉に使う利用者は、セッションのキャッシュ（["auth","session"]）の利用者
//   features/auth/verify-document-session.ts の verifyDocumentSession()、features/auth/document-user.ts の reportOtherUser(onOtherUser)
//   features/cases/case-access-evidence.ts の caseAccessTargets(queryClient, userId)
//   features/cases/case-access-verification.ts の verifyBySummaryFetch(caseId, { withFailureStatus: true })
//   features/cases/case-access-loss-monitor.ts の settleVerifiedCaseAccess(queryClient, context, verdict)・currentUserGeneration・currentLossPeriod
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { afterEach, vi } from "vitest";
import {
  AccessLossBoundary,
  requestUserSwitchReload,
} from "../features/access-loss";
import {
  getPageRestoreState,
  installPageRestoreGuard,
  subscribePageRestoreState,
} from "../features/access-loss/page-restore-guard";
import {
  createSessionUserMismatchHandler,
  expectedUserIdFor,
  installDocumentUser,
  installUserSwitchGuard,
} from "../features/auth";
import { fetchSession } from "../features/auth/api/auth-api";
import { reportOtherUser } from "../features/auth/document-user";
import { createUnauthenticatedHandler } from "../features/auth/unauthenticated-handler";
import { verifyDocumentSession } from "../features/auth/verify-document-session";
import { caseAccessTargets } from "../features/cases/case-access-evidence";
import {
  currentLossPeriod,
  currentUserGeneration,
  installCaseAccessLossMonitor,
  settleVerifiedCaseAccess,
} from "../features/cases/case-access-loss-monitor";
import { verifyBySummaryFetch } from "../features/cases/case-access-verification";
import {
  apiClient,
  setExpectedUserIdProvider,
  setSessionUserMismatchHandler,
  setUnauthenticatedHandler,
} from "../services/api-client";
import { TEST_USER } from "./auth-handlers";
import { caseSummary, outsiderSummary } from "./case-handlers";
import { server } from "./server";

/** 文書の利用者（セッションのキャッシュの利用者）。TEST_USER と同じ ID（下書きのキー・スレッドの架空のデータと合わせる） */
export const RESTORE_USER = TEST_USER;
/** 別の利用者（復元の後のセッションが、この利用者を返す） */
export const RESTORE_OTHER_USER = {
  id: "01JTESTUSER342000000000OT1",
  displayName: "testuser_342_other",
  loginId: "testuser_342_other",
} as const;

export function sessionOf(user: {
  id: string;
  displayName: string;
  loginId: string;
}) {
  return {
    user: { ...user },
    permissions: [],
    mustChangePassword: false,
    reauthenticatedAt: null,
  };
}

export function newRestoreClient(signedIn = true): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  // アプリでは useSession がセッションの Query に取得の関数を与える。手で置いたセッションの Query でも、
  // 409 の後の取り直し（refetch）が、同じ取得の関数で動くようにする
  client.setQueryDefaults(["auth", "session"], { queryFn: fetchSession });
  if (signedIn)
    client.setQueryData(["auth", "session"], sessionOf(RESTORE_USER));
  return client;
}

// ---- 守りの登録（main.tsx と同じ組み立て） ----

export type GuardOptions = Parameters<typeof installPageRestoreGuard>[0];

export type RestoreGuardWiring = {
  /** 401 の共通の処理（createUnauthenticatedHandler）が移った先 */
  navigations: string[];
  dispose: () => void;
};

const disposers: (() => void)[] = [];

/**
 * main.tsx と同じ順で登録する：401 の共通の処理 → 文書の利用者 → ヘッダー → 409 の処理 → 切り替えの見張り → 見張り → 守り。
 * 切り替えの入口 requestUserSwitchReload は、test/setup.ts（または各ファイル）で vi.fn に差し替えてある。
 * overrides は、捕捉・通知の例外を作るテストだけが使う
 */
export function installRestoreGuardLikeMain(
  client: QueryClient,
  options: {
    currentPath?: () => string;
    overrides?: Partial<Omit<GuardOptions, "queryClient">>;
  } = {},
): RestoreGuardWiring {
  const navigations: string[] = [];
  setUnauthenticatedHandler(
    createUnauthenticatedHandler({
      queryClient: client,
      navigate: (to) => navigations.push(to),
      currentPath: options.currentPath ?? (() => window.location.pathname),
    }),
  );
  const stops: (() => void)[] = [installDocumentUser(client)];
  setExpectedUserIdProvider(expectedUserIdFor);
  const onOtherUser = () => requestUserSwitchReload(client);
  setSessionUserMismatchHandler(
    createSessionUserMismatchHandler({ queryClient: client, onOtherUser }),
  );
  stops.push(installUserSwitchGuard(client, onOtherUser));
  stops.push(installCaseAccessLossMonitor(client));
  stops.push(
    installPageRestoreGuard({
      queryClient: client,
      verifySession: () => verifyDocumentSession(),
      onOtherUser: () => reportOtherUser(onOtherUser),
      listTargets: (userId) => caseAccessTargets(client, userId),
      contextOf: (userId, target) => ({
        userId,
        caseId: target.caseId,
        roomId: target.roomId,
        generation: currentUserGeneration(client),
        period: currentLossPeriod(client, userId, target.caseId),
      }),
      verifyCase: (caseId) =>
        verifyBySummaryFetch(caseId, { withFailureStatus: true }),
      settleCase: (context, verdict) =>
        settleVerifiedCaseAccess(client, context, verdict),
      ...options.overrides,
    }),
  );
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    // 守りを最初に外す（守りの状態を idle に戻してから、見張り・文書の利用者を外す）
    for (const stop of stops.reverse()) stop();
  };
  disposers.push(dispose);
  return { navigations, dispose };
}

/** 登録した守りを、すべて解除する（このファイルを読み込んだテストでは、各テストの後に自動で呼ぶ） */
export function disposePageRestoreGuards(): void {
  for (const dispose of disposers.splice(0)) dispose();
}

afterEach(() => {
  disposePageRestoreGuards();
});

// ---- pagehide・pageshow の合成 ----

function transition(type: "pagehide" | "pageshow", persisted: boolean): Event {
  if (typeof PageTransitionEvent === "function")
    return new PageTransitionEvent(type, { persisted });
  const event = new Event(type);
  Object.defineProperty(event, "persisted", { value: persisted });
  return event;
}

/** 文書を離れる（合成した pagehide）。React の反映は act の後だが、守りの直接の非表示は、この呼び出しの中で起きる */
export function firePageHide(persisted = true): void {
  act(() => {
    window.dispatchEvent(transition("pagehide", persisted));
  });
}

/** 文書に戻る（合成した pageshow）。実際の bfcache の復元の証拠ではない */
export function firePageShow(persisted = true): void {
  act(() => {
    window.dispatchEvent(transition("pageshow", persisted));
  });
}

/**
 * pagehide の同じ処理の中で、包みが隠れたかを、守りより後に登録したネイティブのリスナーで記録する（act の後の反映では合格にしない）。
 * 守り・境界を登録した後に呼ぶ
 */
export function watchWrapperOnPageHide(wrapper: () => HTMLElement) {
  const seen: { hidden: boolean; inert: boolean }[] = [];
  const listener = () => {
    const element = wrapper();
    seen.push({
      hidden: element.hasAttribute("hidden"),
      inert: element.hasAttribute("inert"),
    });
  };
  window.addEventListener("pagehide", listener);
  disposers.push(() => window.removeEventListener("pagehide", listener));
  return seen;
}

// ---- 境界の描画 ----

/**
 * 境界（AccessLossBoundary）で包んで描画する（main.tsx と同じく、QueryClientProvider の中）。
 * strict は、main.tsx と同じ StrictMode。ルートの側の reactStrictMode で指定する（wrapper の中の <StrictMode> では、
 * 効果の「登録 → 解除 → 再登録」が起きないことを #339 で確かめた）
 */
export function renderInBoundary(
  client: QueryClient,
  children: ReactNode,
  options: { strict?: boolean } = {},
) {
  return render(
    <QueryClientProvider client={client}>
      <AccessLossBoundary>{children}</AccessLossBoundary>
    </QueryClientProvider>,
    { reactStrictMode: options.strict === true },
  );
}

/** 子の要素の親（境界の包み） */
export function wrapperOf(child: HTMLElement): HTMLElement {
  const wrapper = child.parentElement;
  if (wrapper === null) throw new Error("子の包みがありません");
  return wrapper;
}

export function isCovered(wrapper: HTMLElement): boolean {
  return wrapper.hasAttribute("hidden") && wrapper.hasAttribute("inert");
}

export function isUncovered(wrapper: HTMLElement): boolean {
  return !wrapper.hasAttribute("hidden") && !wrapper.hasAttribute("inert");
}

/** 確かめに失敗したときの案内（計画 3-7）と、再試行の共通のボタンの名前 */
export const RESTORE_FAILED_TEXT =
  "画面を確認できませんでした。再試行してください";
export const RETRY_BUTTON = "再試行";

// ---- 復元の確かめの通信 ----

export type SessionAnswer =
  | { kind: "user"; user: { id: string; displayName: string; loginId: string } }
  | { kind: "status"; status: number; code?: string }
  | { kind: "network" }
  | { kind: "invalid" };

export type SummaryAnswer =
  | { kind: "participant" }
  | { kind: "outsider" }
  | { kind: "status"; status: number; code?: string }
  | { kind: "network" }
  | { kind: "invalid" };

export type Gate = { promise: Promise<void>; release: () => void };

export function gate(): Gate {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

type CaseEntry = {
  n: number;
  /** 次の答えの列（先頭から使う）。空なら fallback */
  answers: SummaryAnswer[];
  fallback: SummaryAnswer;
  /** 次の要求から順に使う保留（先頭から使う）。空なら保留しない */
  gates: Promise<void>[];
};

export type RestoreWorld = {
  session: {
    calls: number;
    /** 応答が画面の側へ届いた回数 */
    answered: number;
    answers: SessionAnswer[];
    fallback: SessionAnswer;
    gates: Promise<void>[];
  };
  /** 概要の GET を受けた案件の ID（受けた順） */
  summaryCalls: string[];
  /** 概要の応答が画面の側へ届いた案件の ID（届いた順） */
  summaryAnswered: string[];
  summaryInFlight: number;
  summaryMaxInFlight: number;
  cases: Map<string, CaseEntry>;
  /** 案件を足す（n は caseSummary の番号。答えの既定は参加者） */
  addCase: (n: number, fallback?: SummaryAnswer) => string;
  caseOf: (caseId: string) => CaseEntry;
};

function errorBody(status: number, code: string | undefined) {
  return HttpResponse.json(
    code === undefined
      ? { message: "[UNIT_TEST]342コードの無い失敗" }
      : { code, message: "[UNIT_TEST]342確かめの失敗" },
    { status },
  );
}

function sessionResponse(answer: SessionAnswer) {
  switch (answer.kind) {
    case "user":
      return HttpResponse.json(sessionOf(answer.user));
    case "status":
      return errorBody(answer.status, answer.code);
    case "network":
      return HttpResponse.error();
    case "invalid":
      return HttpResponse.json({ user: { id: 342 } });
  }
}

function summaryResponse(n: number, answer: SummaryAnswer) {
  switch (answer.kind) {
    case "participant":
      return HttpResponse.json(caseSummary(n));
    case "outsider":
      return HttpResponse.json(outsiderSummary(n));
    case "status":
      return errorBody(answer.status, answer.code);
    case "network":
      return HttpResponse.error();
    case "invalid":
      return HttpResponse.json({ id: caseSummary(n).id, isParticipant: "yes" });
  }
}

/** 復元の確かめの通信を返す。セッションの既定は、文書の利用者のまま */
export function respondRestoreWorld(): RestoreWorld {
  const world: RestoreWorld = {
    session: {
      calls: 0,
      answered: 0,
      answers: [],
      fallback: { kind: "user", user: RESTORE_USER },
      gates: [],
    },
    summaryCalls: [],
    summaryAnswered: [],
    summaryInFlight: 0,
    summaryMaxInFlight: 0,
    cases: new Map(),
    addCase: (n, fallback = { kind: "participant" }) => {
      const id = caseSummary(n).id;
      world.cases.set(id, { n, answers: [], fallback, gates: [] });
      return id;
    },
    caseOf: (caseId) => {
      const entry = world.cases.get(caseId);
      if (entry === undefined)
        throw new Error(`[UNIT_TEST]342 準備していない案件：${caseId}`);
      return entry;
    },
  };
  const onEnd = ({ request }: { request: Request }) => {
    const path = new URL(request.url).pathname.split("/");
    if (path.join("/") === "/api/auth/session") world.session.answered += 1;
    // ["", "api", "cases", ":caseId"]（概要だけ。詳細・TODO などは数えない）
    else if (path.length === 4 && path[1] === "api" && path[2] === "cases")
      world.summaryAnswered.push(decodeURIComponent(path[3] ?? ""));
  };
  server.events.on("request:end", onEnd);
  disposers.push(() => server.events.removeListener("request:end", onEnd));
  server.use(
    // 答えと保留は、要求が届いた順に割り当てる（保留を解く順に左右されない）
    http.get("/api/auth/session", async () => {
      world.session.calls += 1;
      const answer = world.session.answers.shift() ?? world.session.fallback;
      const waiting = world.session.gates.shift();
      if (waiting !== undefined) await waiting;
      return sessionResponse(answer);
    }),
    http.get("/api/cases/:caseId", async ({ params }) => {
      const caseId = String(params.caseId);
      world.summaryCalls.push(caseId);
      const entry = world.caseOf(caseId);
      const answer = entry.answers.shift() ?? entry.fallback;
      const waiting = entry.gates.shift();
      world.summaryInFlight += 1;
      world.summaryMaxInFlight = Math.max(
        world.summaryMaxInFlight,
        world.summaryInFlight,
      );
      try {
        if (waiting !== undefined) await waiting;
        return summaryResponse(entry.n, answer);
      } finally {
        world.summaryInFlight -= 1;
      }
    }),
  );
  return world;
}

/** 応答が届いた回数を待つ（否定の確かめの起点。届いた後の処理は、続けて外から見える状態を待つ） */
export async function waitForSessionAnswered(
  world: RestoreWorld,
  count: number,
): Promise<void> {
  await vi.waitFor(() => {
    if (world.session.answered < count)
      throw new Error(
        `セッションの応答が ${count} 回届いていません（${world.session.answered} 回）`,
      );
  });
}

export async function waitForSummaryAnswered(
  world: RestoreWorld,
  count: number,
): Promise<void> {
  await vi.waitFor(() => {
    if (world.summaryAnswered.length < count)
      throw new Error(
        `概要の応答が ${count} 回届いていません（${world.summaryAnswered.length} 回）`,
      );
  });
}

// ---- 守りの処理の終わりを、外から分かる条件で待つ（コードレビュー1回目の軽微） ----

/** 後から送る1往復の要求の行き先（テストの中だけの架空の API。本番の API には無い） */
const LATER_ROUND_TRIP_PATH = "/test/page-restore-342/later-round-trip";

/**
 * 先に応答した要求の「続きの処理」（守りの判定・確定・解除・入口の呼び出し）が終わるのを待つ。
 * 先の応答が届いた（request:end）後に、同じ apiClient で、もう1往復の要求を送り、その応答を受け取るまで待つ。
 * 応答は届いた順に画面の側で処理され、守りの続きは、先の応答の受け取りに続くマイクロタスクで走るので、
 * この往復が終わった時点で、先に届いた応答の続きは終わっている（固定の回数のタスクを進めるだけの待ちにしない）。
 * 先の応答の続きが、さらに通信をする場合は、その通信の応答が届いたことを待ってから呼ぶ
 */
export async function afterLaterRoundTrip(): Promise<void> {
  server.use(
    http.get(`/api${LATER_ROUND_TRIP_PATH}`, () => HttpResponse.json({})),
  );
  await act(async () => {
    await apiClient.get(LATER_ROUND_TRIP_PATH);
  });
}

export type RestoreStateRecord = {
  state: ReturnType<typeof getPageRestoreState>;
  /** その状態になった時点で、画面の側へ届いていた概要・セッションの応答の数 */
  summaryAnswered: number;
  sessionAnswered: number;
};

/**
 * 守りの状態の移り変わりを、移った時点で届いていた応答の数と一緒に記録する（後から「この状態は、この応答より前には無かった」を確かめる）。
 * 記録はテストの後に止める
 */
export function recordRestoreStates(world: RestoreWorld): RestoreStateRecord[] {
  const history: RestoreStateRecord[] = [];
  const stop = subscribePageRestoreState(() => {
    history.push({
      state: getPageRestoreState(),
      summaryAnswered: world.summaryAnswered.length,
      sessionAnswered: world.session.answered,
    });
  });
  disposers.push(stop);
  return history;
}

/** 参加者の概要を、キャッシュに置く（計画 3-2 の「従来から対象としている参加者の概要」。対象の捕捉に使う） */
export function cacheParticipantSummary(
  client: QueryClient,
  n: number,
  userId: string = RESTORE_USER.id,
): void {
  const summary = caseSummary(n);
  client.setQueryData(["cases", "summary", userId, summary.id], summary);
}
