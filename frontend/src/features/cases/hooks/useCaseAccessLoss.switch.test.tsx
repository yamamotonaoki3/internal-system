// #298・#376 AC-6・AC-8（計画 plan-298 改訂3 の 2-7、8-1 の 214・215 行、8-1b の 223・225 行、計画レビュー4回目の軽微2・4）：
// S-17 で、拒否（403）を契機に概要を取り直して資格を確かめるとき、
// (1) 取り直しが 409 SESSION_USER_MISMATCH なら、409 の後のセッションの取り直し（auth の confirmSessionUserAfterMismatch）を待って決める。
//     switched（別の利用者が返り、切り替えの入口が動いた）：表示中・離れた後とも、片付け・喪失の読み込み直し（requestAccessLossReload）・合図・
//       下書きの消去・確かめられないの表示・onLost をしない（文書ごと替わる）。
//     same・unauthenticated・unknown：今の unverified（中身を隠す・確かめられないの表示・読み込み直しを求める・下書きは消さない・合図なし）。
//     行き止まりにしない（表示中は確かめられないの表示、離れた後は片付けと入口）。
//   計画 8-1 の 214・216 行（409 なら片付け・入口・unverified の表示がない）は、8-1b の 223 行の4つの分け方にそろえた（計画レビュー4回目の軽微4）：
//   「何もしない」は switched だけに限る。
// (2) 取り直しの答えは、この取り直しで Query の更新の回数（成功・失敗）が増えたかで見分ける（2-7）。キャッシュの不在を喪失の証拠にしない。
//     答えが無い（取り消し・revert で保存済みのデータが返った等）なら、切り替えの入口が動いていれば switched、そうでなければ unverified。
// 本物の QueryClient と、手で解決する概要の取得（queryFn）で確かめる。固定の時間の待ちは使わず、観測できる出来事（取得の開始・確かめの呼び出し）を待ってから、
// 決まった回数だけタスクを進めて、起きないことを確かめる。
// 前提にした口（実装の担当へ）：
//   features/auth（index）の confirmSessionUserAfterMismatch(): Promise<"switched" | "same" | "unauthenticated" | "unknown">（このファイルで差し替える）
//   features/access-loss（index）の isUserSwitchReloadRequested(): boolean（このファイルで差し替える）
//   requestAccessLossReload は test/setup.ts の差し替え（vi.fn）を数える。
// キーは本番の関数を使わず、リテラルで独立に書く。データはすべて架空（testuser_298_・[UNIT_TEST]）。
// 【2回目】統括の決定（decision-298-2b）の 4・5 のテストを、末尾の2つの describe に足した。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isUserSwitchReloadRequested,
  requestAccessLossReload,
} from "../../access-loss";
import { confirmSessionUserAfterMismatch } from "../../auth";
import {
  FakeBroadcastChannel,
  flushTasks,
} from "../../../test/fake-broadcast-channel";
import { useCaseAccessLoss } from "./useCaseAccessLoss";

vi.mock("../../auth", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  confirmSessionUserAfterMismatch: vi.fn(),
}));
vi.mock("../../access-loss", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isUserSwitchReloadRequested: vi.fn(() => false),
}));

type Outcome = "switched" | "same" | "unauthenticated" | "unknown";

const USER = "01JTESTUSER298A00000000006";
const CASE = "01JTESTCASE298000000000006";
const ROOM = "01JTESTROOM298000000000006";
const CHANNEL = "internal-system:access-loss:v1";

const SUMMARY = ["cases", "summary", USER, CASE] as const;
const CONTENT = {
  detail: ["cases", "detail", USER, CASE],
  todos: ["cases", "todos", USER, CASE],
  roomMessages: ["messages", "room", ROOM],
} as const;
const ROOM_DRAFT = `internal-system:draft:v1:${USER}:room:${ROOM}`;

const forbidden = { status: 403, code: "FORBIDDEN", message: "forbidden" };
const mismatch = {
  status: 409,
  code: "SESSION_USER_MISMATCH",
  message: "[UNIT_TEST]298食い違い",
};
const notFound = { status: 404, code: "NOT_FOUND", message: "not found" };

function summary(isParticipant: boolean) {
  return {
    id: CASE,
    title: "[UNIT_TEST]298件名",
    isParticipant,
    canManage: false,
    canEditDueDate: false,
    participantCount: 2,
    lastActivityAt: isParticipant ? "2026-11-23T00:00:00.000Z" : null,
    channelId: isParticipant ? ROOM : null,
  };
}

type Row = ReturnType<typeof summary>;
type Answer = { data: Row } | { error: unknown };

const remaining = (client: QueryClient) =>
  Object.entries(CONTENT)
    .filter(([, key]) => client.getQueryData([...key]) !== undefined)
    .map(([label]) => label);

const reloadCalls = () => vi.mocked(requestAccessLossReload).mock.calls;
const announced = () => FakeBroadcastChannel.sent(CHANNEL);
const draftKept = () => window.localStorage.getItem(ROOM_DRAFT) !== null;

/**
 * S-17 の確かめの準備。概要の取得は呼ばれるたびに保留し、answers[n] で n 回目の取得に答える。
 * 拒否（TODO の 403）を起こし、確かめの取得が始まるまで待つ。leave なら、その時点で画面を離れる
 */
async function startVerifying(options: {
  leave: boolean;
  /** 確かめより前に、概要の取得を1つ進めておく（その取得が答える前に確かめが始まる） */
  inFlightBefore?: boolean;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const answers: ((answer: Answer) => void)[] = [];
  client.setQueryDefaults([...SUMMARY], {
    queryFn: () =>
      new Promise((resolve, reject) => {
        answers.push((answer) =>
          "data" in answer ? resolve(answer.data) : reject(answer.error),
        );
      }),
  });
  client.setQueryData([...SUMMARY], summary(true));
  for (const [label, key] of Object.entries(CONTENT))
    client.setQueryData([...key], {
      label,
      secret: "[UNIT_TEST]298参加者だけ",
    });
  window.localStorage.setItem(
    ROOM_DRAFT,
    JSON.stringify({ body: "[UNIT_TEST]298書きかけ", updatedAt: Date.now() }),
  );
  const onLost = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(
    () =>
      useCaseAccessLoss({
        caseId: CASE,
        userId: USER,
        roomId: ROOM,
        participantRoomId: ROOM,
        isParticipant: true,
        outsider: false,
        onLost,
      }),
    { wrapper },
  );
  if (options.inFlightBefore) {
    void client.refetchQueries({ queryKey: [...SUMMARY], exact: true });
    await waitFor(() => expect(answers).toHaveLength(1));
  }
  const before = answers.length;
  await client
    .fetchQuery({
      queryKey: [...CONTENT.todos],
      queryFn: () => Promise.reject(forbidden),
      staleTime: 0,
    })
    .catch(() => undefined);
  await waitFor(() => expect(answers).toHaveLength(before + 1));
  if (options.leave) view.unmount();
  /** 確かめの取得（最後に始まった取得）に答える */
  const answer = (value: Answer) => answers[answers.length - 1]?.(value);
  return { client, view, onLost, answers, answer };
}

type Started = Awaited<ReturnType<typeof startVerifying>>;

/** 何もしない（switched）の確かめ：中身・下書きが残り、喪失の読み込み直し・合図・確かめられないの表示・onLost がない */
function expectUntouched(t: Started, mounted: boolean) {
  expect(remaining(t.client)).toEqual(Object.keys(CONTENT));
  expect(reloadCalls()).toEqual([]);
  expect(announced()).toEqual([]);
  expect(draftKept()).toBe(true);
  expect(t.onLost).not.toHaveBeenCalled();
  if (mounted) expect(t.view.result.current.unverified).toBe(false);
}

/** unverified の確かめ：中身を取り除き、読み込み直しを1回求め、下書きは残し、合図は送らない。表示中なら確かめられないの表示と onLost */
async function expectUnverified(t: Started, mounted: boolean) {
  await waitFor(() => expect(reloadCalls()).toHaveLength(1));
  await waitFor(() => expect(remaining(t.client)).toEqual([]));
  expect(reloadCalls()[0]?.[1]).toEqual({ ownerId: USER, reason: "lost" });
  expect(announced()).toEqual([]);
  expect(draftKept()).toBe(true);
  if (mounted) {
    expect(t.view.result.current.unverified).toBe(true);
    expect(t.onLost).toHaveBeenCalled();
  }
}

/** 喪失（lost・notFound）の確かめ：読み込み直し・合図・下書きの消去 */
async function expectLost() {
  await waitFor(() => expect(reloadCalls()).toHaveLength(1));
  await waitFor(() => expect(announced()).toHaveLength(1));
  expect(draftKept()).toBe(false);
}

beforeEach(() => {
  vi.mocked(requestAccessLossReload).mockClear();
  vi.mocked(isUserSwitchReloadRequested).mockReset();
  vi.mocked(isUserSwitchReloadRequested).mockReturnValue(false);
  vi.mocked(confirmSessionUserAfterMismatch).mockReset();
});
afterEach(() => {
  FakeBroadcastChannel.clearSent();
});

describe.each([
  { where: "表示中", leave: false },
  { where: "画面を離れた後", leave: true },
])(
  "#298・#376 AC-6 確かめの概要が 409 SESSION_USER_MISMATCH（$where）",
  ({ leave }) => {
    it("#376 AC-6: 409 の後の取り直しが別の利用者を返し、切り替えの入口が動いた（switched）：片付け・喪失の読み込み直し・合図・下書きの消去・確かめられないの表示・onLost がない", async () => {
      vi.mocked(confirmSessionUserAfterMismatch).mockResolvedValue("switched");
      vi.mocked(isUserSwitchReloadRequested).mockReturnValue(true);
      const t = await startVerifying({ leave });
      t.answer({ error: mismatch });
      await waitFor(() =>
        expect(confirmSessionUserAfterMismatch).toHaveBeenCalled(),
      );
      await flushTasks(10);
      expectUntouched(t, !leave);
    });

    it.each(["same", "unauthenticated", "unknown"] as const)(
      "#376 AC-6（Q14）: 409 の後の取り直しが %s：unverified として扱う（中身を取り除き、読み込み直しを求め、下書きは残し、合図は送らない）",
      async (outcome: Outcome) => {
        vi.mocked(confirmSessionUserAfterMismatch).mockResolvedValue(outcome);
        const t = await startVerifying({ leave });
        t.answer({ error: mismatch });
        await waitFor(() =>
          expect(confirmSessionUserAfterMismatch).toHaveBeenCalled(),
        );
        await expectUnverified(t, !leave);
      },
    );
  },
);

describe("#298・#376 AC-6 409 の後は、取り直しの結果を待ってから決める", () => {
  it("#376 AC-6: 取り直しの結果が届くまでは、片付けも読み込み直しも始めず、same が届いてから unverified になる", async () => {
    let settle: (outcome: Outcome) => void = () => undefined;
    vi.mocked(confirmSessionUserAfterMismatch).mockReturnValue(
      new Promise<Outcome>((resolve) => {
        settle = resolve;
      }),
    );
    const t = await startVerifying({ leave: false });
    t.answer({ error: mismatch });
    await waitFor(() =>
      expect(confirmSessionUserAfterMismatch).toHaveBeenCalled(),
    );
    await flushTasks(10);
    expectUntouched(t, true);
    settle("same");
    await expectUnverified(t, true);
  });
});

describe("#298 AC-8 取り直しの答えの見分け（更新の回数。計画 8-1b の 225 行・計画レビュー4回目の軽微2）", () => {
  it("#298 AC-8 (i): 概要の取得が進行中のときに確かめが始まる：確かめの取得の新しい答え（非参加）で lost。キャッシュにも非参加が書かれる", async () => {
    const t = await startVerifying({ leave: false, inFlightBefore: true });
    expect(t.answers).toHaveLength(2);
    t.answer({ data: summary(false) });
    await expectLost();
    expect(t.client.getQueryData([...SUMMARY])).toMatchObject({
      isParticipant: false,
    });
  });

  it("#298 AC-8 (ii): 確かめの成功（非参加）の直後に、概要のキャッシュが捨てられても、その答えで lost のまま", async () => {
    const t = await startVerifying({ leave: false });
    removeSummaryRightAfterSuccess(t.client);
    t.answer({ data: summary(false) });
    await expectLost();
  });

  it("#298 AC-8 (ii): 確かめの成功（参加者のまま）の直後に、概要のキャッシュが捨てられても、喪失として扱わない（キャッシュの不在を喪失の証拠にしない）", async () => {
    const t = await startVerifying({ leave: false });
    const removed = removeSummaryRightAfterSuccess(t.client);
    t.answer({ data: summary(true) });
    await waitFor(() => expect(removed()).toBe(true));
    await flushTasks(10);
    expectUntouched(t, true);
  });

  it("#298 AC-8 (iii): 確かめの取得が取り消され（cancelQueries の revert）、保存済みの参加者のデータが返っても、新しい答えとして扱わない。同じ利用者のままなら unverified", async () => {
    const t = await startVerifying({ leave: false });
    await t.client.cancelQueries({ queryKey: [...SUMMARY], exact: true });
    await expectUnverified(t, true);
  });

  it("#298 AC-8 (iii): 確かめの取得が、概要の破棄（removeQueries）で取り消される：同じ利用者のままなら unverified", async () => {
    const t = await startVerifying({ leave: false });
    t.client.removeQueries({ queryKey: [...SUMMARY], exact: true });
    await expectUnverified(t, true);
  });

  it.each(["cancelQueries", "removeQueries"] as const)(
    "#298 AC-8 (iii)・#376 AC-6: 確かめの取得が %s で取り消され、切り替えの入口が動いている：switched（何もしない）",
    async (how) => {
      vi.mocked(isUserSwitchReloadRequested).mockReturnValue(true);
      const t = await startVerifying({ leave: false });
      if (how === "cancelQueries")
        await t.client.cancelQueries({ queryKey: [...SUMMARY], exact: true });
      else t.client.removeQueries({ queryKey: [...SUMMARY], exact: true });
      await flushTasks(10);
      expectUntouched(t, true);
    },
  );

  it("#298 AC-8（軽微2）: 確かめの最中に概要が捨てられ、同じキーで作り直されて参加者のデータが入っても、元の確かめの答えにしない（unverified）", async () => {
    const t = await startVerifying({ leave: false });
    t.client.removeQueries({ queryKey: [...SUMMARY], exact: true });
    t.client.setQueryData([...SUMMARY], summary(true));
    await expectUnverified(t, true);
  });

  it("#298 AC-8 (iv): 確かめの新しい答えが 404：notFound（読み込み直し・合図・下書きの消去）で、キャッシュにも 404 が残る", async () => {
    const t = await startVerifying({ leave: false });
    t.answer({ error: notFound });
    await expectLost();
    expect(t.client.getQueryState([...SUMMARY])?.error).toMatchObject({
      status: 404,
    });
  });
});

// 【2回目】統括の決定（decision-298-2b）の 4・5 を足した。
//   4：取り直しの最中に、ほかから書き換えられた・成功と失敗の両方の回数が増えた → 見分けられないので unverified
//   5：409 の後の取り直しが switched を返したが、切り替えの入口が動いていない → unverified
describe.each([
  { where: "表示中", leave: false },
  { where: "画面を離れた後", leave: true },
])(
  "#298・#376 AC-6 switched が返ったが、切り替えの入口が動いていない（決定5。$where）",
  ({ leave }) => {
    it("#376 AC-6（決定5）: 409 の後の取り直しが switched でも、切り替えの入口が動いていなければ unverified（中身を取り除き、読み込み直しを求め、下書きは残し、合図は送らない）", async () => {
      vi.mocked(confirmSessionUserAfterMismatch).mockResolvedValue("switched");
      vi.mocked(isUserSwitchReloadRequested).mockReturnValue(false);
      const t = await startVerifying({ leave });
      t.answer({ error: mismatch });
      await waitFor(() =>
        expect(confirmSessionUserAfterMismatch).toHaveBeenCalled(),
      );
      await expectUnverified(t, !leave);
    });
  },
);

describe("#298 AC-8 取り直しの最中のほかからの書き換え（決定4）", () => {
  it("#298 AC-8（決定4）: 確かめの最中に、ほかから参加者の概要が書かれ、確かめの答えが 404：成功と失敗の両方の回数が増えたので見分けられず、notFound にせず unverified（下書きは残り、合図は送らない）", async () => {
    const t = await startVerifying({ leave: false });
    t.client.setQueryData([...SUMMARY], summary(true));
    t.answer({ error: notFound });
    await expectUnverified(t, true);
  });

  it("#298 AC-8（決定4）: 画面を離れた後、確かめの最中に、ほかから参加者の概要が書かれ、確かめの答えが非参加：成功の回数が2つ増えたので見分けられず、lost にせず unverified（下書きは残り、合図は送らない）", async () => {
    // 表示中だと、最後に書かれる非参加の概要を (b) の効果が見て喪失にする（別の経路）ため、効果の無い離れた後で確かめる
    const t = await startVerifying({ leave: true });
    t.client.setQueryData([...SUMMARY], summary(true));
    t.answer({ data: summary(false) });
    await expectUnverified(t, false);
  });
});

/** 概要の取得の成功が書かれた直後（同じ通知の中）に、概要のキャッシュを捨てる。捨てたかを返す */
function removeSummaryRightAfterSuccess(client: QueryClient): () => boolean {
  let removed = false;
  const stop = client.getQueryCache().subscribe((event) => {
    if (
      event.type === "updated" &&
      event.action.type === "success" &&
      JSON.stringify(event.query.queryKey) === JSON.stringify(SUMMARY)
    ) {
      stop();
      removed = true;
      client.removeQueries({ queryKey: [...SUMMARY], exact: true });
    }
  });
  return () => removed;
}

// 【3回目】コードレビュー（cr298c-1）の重大1：手での書き換え（setQueryData）と取り消しが重なったとき、取り直しの成功と見誤らない。
// setQueryData は成功の更新の回数を増やし、取り消しの revert はその書き換えを残す（query-core の #revertState）。
// 新しい応答が無いのに増分が「成功1・失敗0」になる。これは確かめの答えではないので、lost・participant にせず unverified（決定3・4、AC-8）。
// 表示中は、フックの isParticipant を固定で渡しているので、書き換えた概要を (b) の効果が見ることはない（この経路だけを確かめる）。
describe.each([
  { where: "表示中", leave: false },
  { where: "画面を離れた後", leave: true },
])(
  "#298 AC-8 確かめの最中の手での書き換えと取り消しの重なり（決定3・4。コードレビューの重大1。$where）",
  ({ leave }) => {
    it.each([
      { content: "参加者でない内容", participant: false },
      { content: "参加者の内容", participant: true },
    ])(
      "#298 AC-8（決定3・4）: 概要の取り直しの最中に、$content が手で書かれ、取り直しが取り消された：lost にせず unverified（下書きを消さない・合図を送らない・読み込み直しは確かめられないとして1回）",
      async ({ participant }) => {
        const t = await startVerifying({ leave });
        t.client.setQueryData([...SUMMARY], summary(participant));
        await t.client.cancelQueries({ queryKey: [...SUMMARY], exact: true });
        await expectUnverified(t, !leave);
      },
    );
  },
);
