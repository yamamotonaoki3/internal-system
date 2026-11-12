// #200 AC-2〜AC-4: チャンネルの部品（詳細・サイドバーの参加中・一覧・1行・部署の絞り込み・API の形・参加後の取り直し）を、
// 状態の出し分けと表示の中身まで確かめる。API は MSW で返す。データはすべて架空。
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { respondShellUser } from "../../test/app-shell-harness";
import {
  DEPT_DEV,
  DEPT_SALES,
  channelItem,
  respondChannels,
} from "../../test/channel-handlers";
import { server } from "../../test/server";
import { fetchChannel, fetchChannels, joinChannel } from "./api/channel-api";
import { ChannelDetailView } from "./components/ChannelDetailView";
import { ChannelList } from "./components/ChannelList";
import { ChannelSummary } from "./components/ChannelSummary";
import { DepartmentFilter } from "./components/DepartmentFilter";
import { JoinedChannelsSection } from "./components/JoinedChannelsSection";

// #136：S-05 の参加者の「DMを送る」を自分に出さないため、ChannelDetailView がセッション（GET /api/auth/session）を取る。
// 想定外の要求を残さないよう、ログイン済み（testuser_001）の応答を、各テストの前に用意する（確かめる内容は変えない）
beforeEach(() => {
  respondShellUser();
});

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderWith(ui: ReactNode, client = newClient()) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

const ID = "01JTE5TCHAN00000000000XX01";
const detailBase = {
  id: ID,
  roomId: ID,
  name: "[E2E_TEST]詳細チャンネル",
  description: "",
  visibility: "public",
  departmentId: null,
  joined: false,
  isCaseChannel: false,
  // #201：詳細の応答に canPost が加わった（投稿できるか。お知らせ専用の権限）
  canPost: false,
};

function respondDetail(body: Record<string, unknown>) {
  server.use(
    http.get("/api/channels/:channelId", () =>
      HttpResponse.json({ ...detailBase, ...body }),
    ),
  );
}

const apiError = (status: number, code: string, message: string) =>
  HttpResponse.json({ code, message }, { status });

/** 続きを取る2ページの一覧。2ページ目は release が呼ばれるまで待つ */
function respondTwoPages(
  first: ReturnType<typeof channelItem>[],
  second: ReturnType<typeof channelItem>[],
) {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const cursors: (string | null)[] = [];
  server.use(
    http.get("/api/channels", async ({ request }) => {
      const cursor = new URL(request.url).searchParams.get("cursor");
      cursors.push(cursor);
      if (cursor === null)
        return HttpResponse.json({ items: first, nextCursor: "cursor-2" });
      await gate;
      return HttpResponse.json({ items: second, nextCursor: null });
    }),
  );
  return { cursors, release: () => release?.() };
}

describe("#200 AC-2・AC-3 チャンネルの詳細（ChannelDetailView）", () => {
  it("#200 AC-2: 読み込み中は「読み込み中です」（role=status）を出す", async () => {
    server.use(
      http.get("/api/channels/:channelId", () => new Promise(() => {})),
    );
    renderWith(<ChannelDetailView channelId={ID} />);
    expect((await screen.findByRole("status")).textContent).toBe(
      "読み込み中です",
    );
  });

  it("#200 AC-3: 404 は「チャンネルが見つかりません」の文だけを出し（エラー枠にしない）、名前などを出さない", async () => {
    server.use(
      http.get("/api/channels/:channelId", () =>
        apiError(404, "NOT_FOUND", "別の文言"),
      ),
    );
    const { container } = renderWith(<ChannelDetailView channelId={ID} />);
    expect(await screen.findByText("チャンネルが見つかりません")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("別の文言")).toBeNull();
    expect(container.querySelector("h1")).toBeNull();
  });

  it("#200 AC-2: 404 以外の失敗（500）は、API のメッセージを role=alert で出す。「見つかりません」にはしない", async () => {
    server.use(
      http.get("/api/channels/:channelId", () =>
        apiError(500, "INTERNAL", "一時的なエラーです"),
      ),
    );
    renderWith(<ChannelDetailView channelId={ID} />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "一時的なエラーです",
    );
    expect(screen.queryByText("チャンネルが見つかりません")).toBeNull();
  });

  it("#200 AC-2: 応答の形が不正（API のエラーではない例外）のときは、一般的な文を role=alert で出す", async () => {
    server.use(
      http.get("/api/channels/:channelId", () =>
        HttpResponse.json({ unexpected: true }),
      ),
    );
    renderWith(<ChannelDetailView channelId={ID} />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "エラーが発生しました",
    );
  });

  it("#200 AC-2・AC-3: 公開は「公開チャンネル」、非公開は「非公開のチャンネル」と出す", async () => {
    respondDetail({ visibility: "public" });
    const first = renderWith(<ChannelDetailView channelId={ID} />);
    expect(await screen.findByText("公開チャンネル")).toBeTruthy();
    expect(screen.queryByText("非公開のチャンネル")).toBeNull();
    first.unmount();
    respondDetail({
      visibility: "private",
      joined: true,
      memberCount: 1,
      members: [{ id: "u1", displayName: "テスト太郎" }],
    });
    renderWith(<ChannelDetailView channelId={ID} />);
    expect(await screen.findByText("非公開のチャンネル")).toBeTruthy();
    expect(screen.queryByText("公開チャンネル")).toBeNull();
  });

  it("#200 AC-2: 説明があるときは説明を出し、空のときは説明の段落を出さない", async () => {
    respondDetail({ description: "[E2E_TEST]この場所の説明" });
    const first = renderWith(<ChannelDetailView channelId={ID} />);
    expect(await screen.findByText("[E2E_TEST]この場所の説明")).toBeTruthy();
    first.unmount();
    respondDetail({ description: "" });
    const { container } = renderWith(<ChannelDetailView channelId={ID} />);
    await screen.findByRole("heading", { level: 1 });
    // 詳細の見出し直下に残る段落は「公開チャンネル」の1つだけ（空の説明の段落がない。メッセージ欄の中の段落は数えない）
    expect(container.querySelectorAll("section > p")).toHaveLength(1);
  });

  it("#200 AC-2: 参加者には、参加者の数と参加者の表示名の一覧を出し、参加ボタンは出さない", async () => {
    respondDetail({
      joined: true,
      memberCount: 3,
      members: [
        { id: "u1", displayName: "テスト太郎" },
        { id: "u2", displayName: "テスト花子" },
      ],
    });
    renderWith(<ChannelDetailView channelId={ID} />);
    expect(await screen.findByText("参加者（3人）")).toBeTruthy();
    // #136（方針9）：参加者の行に「DMを送る」などの操作のボタンが加わったため、ボタンを除いた行の文字（表示名）を、並びも含めて完全一致で比べる
    const items = screen.getAllByRole("listitem").map((li) => {
      const copy = li.cloneNode(true) as HTMLElement;
      for (const button of copy.querySelectorAll("button")) button.remove();
      return copy.textContent;
    });
    expect(items).toEqual(["テスト太郎", "テスト花子"]);
    expect(screen.queryByRole("button", { name: "参加する" })).toBeNull();
  });

  it.each([
    ["参加者の数も一覧もない", { joined: true }],
    ["参加者の数がない", { joined: true, members: [] }],
    ["参加者の一覧がない", { joined: true, memberCount: 1 }],
  ])(
    "#200 AC-2: 参加済みなのに%s応答は、0人と空で成功扱いにせず、エラーを role=alert で出す",
    async (_label, body) => {
      respondDetail(body);
      renderWith(<ChannelDetailView channelId={ID} />);
      expect((await screen.findByRole("alert")).textContent).toContain(
        "エラーが発生しました",
      );
      expect(screen.queryByText(/参加者（/)).toBeNull();
      expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    },
  );

  it("#200 AC-2: 未参加には「参加する」ボタンだけを出し（参加者の一覧は出さない）、押すと参加の要求（POST）を送り、詳細を取り直す", async () => {
    let joined = false;
    const posts: string[] = [];
    server.use(
      http.get("/api/channels/:channelId", () =>
        HttpResponse.json({
          ...detailBase,
          joined,
          ...(joined ? { memberCount: 1, members: [] } : {}),
        }),
      ),
      http.post("/api/channels/:channelId/join", ({ params }) => {
        posts.push(String(params.channelId));
        joined = true;
        return HttpResponse.json({
          channelId: ID,
          roomId: ID,
          joinedAt: "2026-11-09T00:00:00.000Z",
        });
      }),
    );
    renderWith(<ChannelDetailView channelId={ID} />);
    const button = await screen.findByRole("button", { name: "参加する" });
    expect(screen.queryByText(/参加者（/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(button);
    await waitFor(() => expect(posts).toEqual([ID]));
    expect(await screen.findByText("参加者（1人）")).toBeTruthy();
  });

  it("#200 AC-2: 参加に失敗すると、API のメッセージを role=alert で出し、参加ボタンは残る", async () => {
    respondDetail({});
    server.use(
      http.post("/api/channels/:channelId/join", () =>
        apiError(404, "NOT_FOUND", "参加できませんでした"),
      ),
    );
    renderWith(<ChannelDetailView channelId={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "参加する" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "参加できませんでした",
    );
    expect(screen.getByRole("button", { name: "参加する" })).toBeTruthy();
  });
});

describe("#200 AC-4 サイドバーの参加中のチャンネル（JoinedChannelsSection）", () => {
  const linkClassName = ({ isActive }: { isActive: boolean }) =>
    isActive ? "active" : "idle";

  it("#200 AC-4: 読み込み中は「読み込み中です」を出し、終わったら消す。0件の文は終わってから出す", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get("/api/channels", async () => {
        await gate;
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    renderWith(<JoinedChannelsSection linkClassName={linkClassName} />);
    expect(screen.getByText("読み込み中です")).toBeTruthy();
    expect(screen.queryByText("参加中のチャンネルはありません")).toBeNull();
    release?.();
    expect(
      await screen.findByText("参加中のチャンネルはありません"),
    ).toBeTruthy();
    expect(screen.queryByText("読み込み中です")).toBeNull();
  });

  it("#200 AC-4: 参加中が1件以上あるときは、0件の文を出さず、リンクだけを出す", async () => {
    respondChannels([channelItem("1", { name: "全社連絡", joined: true })]);
    renderWith(<JoinedChannelsSection linkClassName={linkClassName} />);
    await screen.findByRole("link", { name: "全社連絡" });
    expect(screen.queryByText("参加中のチャンネルはありません")).toBeNull();
    expect(screen.queryByText("読み込み中です")).toBeNull();
  });

  it("#200 AC-4: 取得に失敗したときは、エラーを出し、0件の文も読み込み中も出さない", async () => {
    server.use(
      http.get("/api/channels", () =>
        apiError(500, "INTERNAL", "取得できませんでした"),
      ),
    );
    renderWith(<JoinedChannelsSection linkClassName={linkClassName} />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "取得できませんでした",
    );
    expect(screen.queryByText("参加中のチャンネルはありません")).toBeNull();
    expect(screen.queryByText("読み込み中です")).toBeNull();
  });

  it("#200 AC-4: 次のページがあるときだけ「さらに表示」を出し、押すと続きを取って追加する（取得中は押せない）", async () => {
    const a = channelItem("1", { name: "チャンネルA", joined: true });
    const b = channelItem("2", { name: "チャンネルB", joined: true });
    const pages = respondTwoPages([a], [b]);
    renderWith(<JoinedChannelsSection linkClassName={linkClassName} />);
    await screen.findByRole("link", { name: "チャンネルA" });
    fireEvent.click(screen.getByRole("button", { name: "さらに表示" }));
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "さらに表示",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true),
    );
    pages.release();
    await screen.findByRole("link", { name: "チャンネルB" });
    expect(pages.cursors).toEqual([null, "cursor-2"]);
    expect(screen.getByRole("link", { name: "チャンネルA" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "さらに表示" })).toBeNull();
  });

  it("#200 AC-4: 次のページがなければ「さらに表示」を出さない。リンクは受け取った見た目を使い、押すと onNavigate を呼ぶ", async () => {
    respondChannels([channelItem("1", { name: "全社連絡", joined: true })]);
    const onNavigate = vi.fn();
    renderWith(
      <JoinedChannelsSection
        linkClassName={linkClassName}
        onNavigate={onNavigate}
      />,
    );
    const link = await screen.findByRole("link", { name: "全社連絡" });
    expect(screen.queryByRole("button", { name: "さらに表示" })).toBeNull();
    expect(link.className).toBe("idle");
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});

describe("#200 AC-4 一覧（ChannelList）の続き", () => {
  it("#200 AC-4: 次のページがあるときだけ「次のページ」を出し、押すと続き（cursor）を取って追加する。取得中は押せない", async () => {
    const a = channelItem("1", { name: "チャンネルA" });
    const b = channelItem("2", { name: "チャンネルB" });
    const pages = respondTwoPages([a], [b]);
    renderWith(<ChannelList departmentId="" />);
    await screen.findByRole("link", { name: "チャンネルA" });
    fireEvent.click(screen.getByRole("button", { name: "次のページ" }));
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "次のページ",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true),
    );
    pages.release();
    await screen.findByRole("link", { name: "チャンネルB" });
    expect(pages.cursors).toEqual([null, "cursor-2"]);
    expect(screen.queryByRole("button", { name: "次のページ" })).toBeNull();
  });

  it("#200 AC-4: 次のページがなければ「次のページ」を出さない", async () => {
    respondChannels([channelItem("1", { name: "チャンネルA" })]);
    renderWith(<ChannelList departmentId="" />);
    await screen.findByRole("link", { name: "チャンネルA" });
    expect(screen.queryByRole("button", { name: "次のページ" })).toBeNull();
  });
});

describe("#200 AC-3・AC-4 一覧の1行（ChannelSummary）", () => {
  it("#200 AC-3: 公開には「非公開」の印を出さず、非公開には出す", () => {
    const pub = renderWith(
      <ul>
        <ChannelSummary channel={channelItem("1", { visibility: "public" })} />
      </ul>,
    );
    expect(screen.queryByRole("img", { name: "非公開" })).toBeNull();
    pub.unmount();
    renderWith(
      <ul>
        <ChannelSummary channel={channelItem("2", { visibility: "private" })} />
      </ul>,
    );
    expect(screen.getByRole("img", { name: "非公開" })).toBeTruthy();
  });

  it("#200 AC-4: 部署があれば部署名を出し、会社直属（部署なし）なら部署名の欄を出さない", () => {
    const withDept = renderWith(
      <ul>
        <ChannelSummary
          channel={channelItem("1", {
            departmentId: DEPT_SALES.id,
            departmentName: DEPT_SALES.name,
          })}
        />
      </ul>,
    );
    expect(screen.getByText(DEPT_SALES.name)).toBeTruthy();
    withDept.unmount();
    const { container } = renderWith(
      <ul>
        <ChannelSummary channel={channelItem("2")} />
      </ul>,
    );
    expect(container.querySelector("span.text-text-muted")).toBeNull();
  });
});

describe("#200 AC-4 部署の絞り込み（DepartmentFilter）", () => {
  it("#200 AC-4: 選択肢は「すべて」と、一覧にある部署を1つずつ。部署のない（会社直属の）チャンネルは選択肢にしない", async () => {
    respondChannels([
      channelItem("1", { name: "全社連絡" }),
      channelItem("2", {
        departmentId: DEPT_SALES.id,
        departmentName: DEPT_SALES.name,
      }),
      channelItem("3", {
        departmentId: DEPT_SALES.id,
        departmentName: DEPT_SALES.name,
      }),
      channelItem("4", {
        departmentId: DEPT_DEV.id,
        departmentName: DEPT_DEV.name,
      }),
    ]);
    renderWith(<DepartmentFilter value="" onChange={() => {}} />);
    const filter = screen.getByRole("combobox", { name: /部署/ });
    await waitFor(() =>
      expect(within(filter).getAllByRole("option")).toHaveLength(3),
    );
    expect(
      within(filter)
        .getAllByRole("option")
        .map((o) => [o.textContent, (o as HTMLOptionElement).value]),
    ).toEqual([
      ["すべて", ""],
      [DEPT_SALES.name, DEPT_SALES.id],
      [DEPT_DEV.name, DEPT_DEV.id],
    ]);
  });

  it("#200 AC-4: 選ぶと、その部署の ID で onChange を呼ぶ", async () => {
    respondChannels([
      channelItem("2", {
        departmentId: DEPT_SALES.id,
        departmentName: DEPT_SALES.name,
      }),
    ]);
    const onChange = vi.fn();
    renderWith(<DepartmentFilter value="" onChange={onChange} />);
    const filter = screen.getByRole("combobox", { name: /部署/ });
    await waitFor(() =>
      expect(within(filter).getAllByRole("option")).toHaveLength(2),
    );
    fireEvent.change(filter, { target: { value: DEPT_SALES.id } });
    expect(onChange).toHaveBeenCalledWith(DEPT_SALES.id);
  });

  it("#200 AC-4: 選択肢のための一覧は、絞り込まない一覧と同じ取得を共有する（絞り込みなしの要求は1回だけ）", async () => {
    const recorded = respondChannels([channelItem("1", { name: "全社連絡" })]);
    renderWith(
      <>
        <DepartmentFilter value="" onChange={() => {}} />
        <ChannelList departmentId="" />
      </>,
    );
    await screen.findByRole("link", { name: "全社連絡" });
    expect(recorded.listRequests).toHaveLength(1);
    expect(recorded.listRequests[0]?.searchParams.has("departmentId")).toBe(
      false,
    );
  });
});

describe("#200 AC-4 参加後の取り直し（useJoinChannel）", () => {
  function Unrelated({ onFetch }: { onFetch: () => void }) {
    useQuery({
      queryKey: ["unrelated"],
      queryFn: async () => {
        onFetch();
        return 1;
      },
    });
    return null;
  }

  it("#200 AC-4: 参加すると、チャンネルの一覧（参加中）は取り直すが、チャンネルと関係のない取得は取り直さない", async () => {
    const recorded = respondChannels([
      channelItem("1", { name: "チャンネルA", joined: false }),
    ]);
    const onFetch = vi.fn();
    renderWith(
      <>
        <Unrelated onFetch={onFetch} />
        <JoinedChannelsSection linkClassName={() => "x"} />
        <ChannelList departmentId="" />
      </>,
    );
    const joinButton = await screen.findByRole("button", {
      name: "チャンネルAに参加する",
    });
    await waitFor(() => expect(onFetch).toHaveBeenCalledTimes(1));
    const before = recorded.listRequests.length;
    fireEvent.click(joinButton);
    // 参加中の一覧にも反映される（取り直された）
    await waitFor(() =>
      expect(screen.getAllByRole("link", { name: "チャンネルA" })).toHaveLength(
        2,
      ),
    );
    expect(recorded.listRequests.length).toBeGreaterThan(before);
    expect(onFetch).toHaveBeenCalledTimes(1);
  });
});

describe("#200 AC-2〜AC-4 API の形（channel-api）", () => {
  it("#200 AC-2: 一覧は items と nextCursor を返し、cursor・departmentId・joined をクエリで送る。空の departmentId は送らない", async () => {
    const recorded = respondChannels([
      channelItem("1", { joined: true, departmentId: DEPT_DEV.id }),
    ]);
    const page = await fetchChannels(
      { departmentId: DEPT_DEV.id, joined: true },
      "c-1",
    );
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
    const url = recorded.listRequests[0];
    expect(url?.searchParams.get("cursor")).toBe("c-1");
    expect(url?.searchParams.get("departmentId")).toBe(DEPT_DEV.id);
    expect(url?.searchParams.get("joined")).toBe("true");
    await fetchChannels({ departmentId: "" });
    const empty = recorded.listRequests[1];
    expect(empty?.searchParams.has("departmentId")).toBe(false);
    expect(empty?.searchParams.has("joined")).toBe(false);
    expect(empty?.searchParams.has("cursor")).toBe(false);
  });

  it("#200 AC-3: 一覧の項目の公開範囲は public・private だけ。それ以外の値や欠けた項目は、失敗にする", async () => {
    server.use(
      http.get("/api/channels", () =>
        HttpResponse.json({
          items: [{ ...channelItem("1"), visibility: "secret" }],
          nextCursor: null,
        }),
      ),
    );
    await expect(fetchChannels({})).rejects.toBeInstanceOf(Error);
    server.use(
      http.get("/api/channels", () =>
        HttpResponse.json({ items: [{ id: "x" }], nextCursor: null }),
      ),
    );
    await expect(fetchChannels({})).rejects.toBeInstanceOf(Error);
    server.use(
      http.get("/api/channels", () =>
        HttpResponse.json({
          items: [{ ...channelItem("1"), visibility: "private" }],
          nextCursor: "next",
        }),
      ),
    );
    const ok = await fetchChannels({});
    expect(ok.items[0]?.visibility).toBe("private");
    expect(ok.nextCursor).toBe("next");
  });

  it("#200 AC-2: 詳細の参加者は id と displayName を保つ。公開範囲が不正、参加者の ID が空なら失敗にする", async () => {
    respondDetail({
      joined: true,
      memberCount: 1,
      members: [{ id: "u1", displayName: "テスト太郎" }],
    });
    const detail = await fetchChannel(ID);
    expect(detail.members).toEqual([{ id: "u1", displayName: "テスト太郎" }]);
    expect(detail.memberCount).toBe(1);
    respondDetail({ visibility: "secret" });
    await expect(fetchChannel(ID)).rejects.toBeInstanceOf(Error);
    respondDetail({ joined: true, members: [{ id: "", displayName: "x" }] });
    await expect(fetchChannel(ID)).rejects.toBeInstanceOf(Error);
  });

  it("#200 AC-2: 参加の応答は channelId・roomId・joinedAt をそのまま返し、ID が空なら失敗にする", async () => {
    respondChannels([channelItem("1")]);
    const target = channelItem("1");
    const joined = await joinChannel(target.id);
    expect(joined).toEqual({
      channelId: target.id,
      roomId: target.id,
      joinedAt: "2026-11-09T00:00:00.000Z",
    });
    server.use(
      http.post("/api/channels/:channelId/join", () =>
        HttpResponse.json({ channelId: "", roomId: "x", joinedAt: "t" }),
      ),
    );
    await expect(joinChannel(target.id)).rejects.toBeInstanceOf(Error);
  });
});
