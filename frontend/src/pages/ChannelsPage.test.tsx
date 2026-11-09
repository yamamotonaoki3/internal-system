// #200 AC-4（2-3 AC-1・AC-2、画面 S-09）: チャンネル一覧と参加の画面。API は MSW で返す。データはすべて架空。
// 画面の契約（実装前。引き継ぎに明記）：
//  - 見出し（h1）「チャンネルを探す」
//  - 一覧は listitem。チャンネル名は /channels/:id へのリンク。参加済みは文字「参加済み」を出し、参加ボタンを出さない
//  - 未参加には、チャンネル名と「参加」を含む名前のボタン（例「○○に参加する」）を出す。送信中は押せない
//  - 部署の絞り込みは、アクセシブルな名前に「部署」を含む combobox。選択肢「すべて」と、一覧にある部署の名前。選ぶと departmentId で取り直す
//  - 読み込み中は「読み込み中」、0件は「参加できるチャンネルがありません」、失敗は role=alert に API のメッセージ
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import {
  DEPT_DEV,
  DEPT_SALES,
  channelItem,
  respondChannels,
} from "../test/channel-handlers";
import { server } from "../test/server";
import { ChannelsPage } from "./ChannelsPage";

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ChannelsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const joinButtonOf = (name: string) =>
  screen.queryByRole("button", {
    name: (accessibleName) =>
      accessibleName.includes(name) && accessibleName.includes("参加"),
  });

const general = channelItem("1", { name: "全社連絡" });
const sales = channelItem("2", {
  name: "[E2E_TEST]営業部",
  departmentId: DEPT_SALES.id,
  departmentName: DEPT_SALES.name,
});
const dev = channelItem("3", {
  name: "[E2E_TEST]開発部",
  departmentId: DEPT_DEV.id,
  departmentName: DEPT_DEV.name,
});

describe("#200 AC-4 チャンネル一覧（S-09）", () => {
  it("#200 AC-4: 見出し「チャンネルを探す」と、チャンネル名のリンク（/channels/:id）を出す", async () => {
    respondChannels([general, sales]);
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "チャンネルを探す" }),
    ).toBeTruthy();
    const link = await screen.findByRole("link", { name: "全社連絡" });
    expect(link.getAttribute("href")).toBe(`/channels/${general.id}`);
  });

  it("#200 AC-4: 読み込み中を出し、終わったら一覧に替わる", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get("/api/channels", async () => {
        await gate;
        return HttpResponse.json({ items: [general], nextCursor: null });
      }),
    );
    renderPage();
    expect(screen.getByText(/読み込み中/)).toBeTruthy();
    release?.();
    expect(await screen.findByRole("link", { name: "全社連絡" })).toBeTruthy();
    expect(screen.queryByText(/読み込み中/)).toBeNull();
  });

  it("#200 AC-4: 0件のときは「参加できるチャンネルがありません」を出す", async () => {
    respondChannels([]);
    renderPage();
    expect(
      await screen.findByText(/参加できるチャンネルがありません/),
    ).toBeTruthy();
  });

  it("#200 AC-4: 取得に失敗すると、API のメッセージを role=alert で出し、一覧は出さない", async () => {
    server.use(
      http.get("/api/channels", () =>
        HttpResponse.json(
          { code: "INTERNAL", message: "エラーが発生しました" },
          { status: 500 },
        ),
      ),
    );
    renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("エラーが発生しました");
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("#200 AC-4: 参加済みは文字「参加済み」を出して参加ボタンを出さず、未参加には参加ボタンを出す", async () => {
    respondChannels([{ ...general, joined: true }, sales]);
    renderPage();
    const generalRow = (
      await screen.findByRole("link", { name: "全社連絡" })
    ).closest("li");
    expect(generalRow).not.toBeNull();
    expect(
      within(generalRow as HTMLElement).getByText("参加済み"),
    ).toBeTruthy();
    expect(joinButtonOf("全社連絡")).toBeNull();
    expect(joinButtonOf("[E2E_TEST]営業部")).not.toBeNull();
  });

  it("#200 AC-4: 参加ボタンを押すと POST /api/channels/:id/join を1回送り、成功すると一覧が取り直されて「参加済み」になる", async () => {
    const recorded = respondChannels([general, sales]);
    renderPage();
    await screen.findByRole("link", { name: "[E2E_TEST]営業部" });
    fireEvent.click(joinButtonOf("[E2E_TEST]営業部") as HTMLElement);
    await waitFor(() => expect(recorded.joinRequests).toEqual([sales.id]));
    await waitFor(() => expect(joinButtonOf("[E2E_TEST]営業部")).toBeNull());
    const row = screen
      .getByRole("link", { name: "[E2E_TEST]営業部" })
      .closest("li");
    expect(within(row as HTMLElement).getByText("参加済み")).toBeTruthy();
    // 参加していないほうのボタンは残る
    expect(joinButtonOf("全社連絡")).not.toBeNull();
  });

  it("#200 AC-4: 参加の送信中は、そのボタンを押せず、二重に送らない", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let posts = 0;
    respondChannels([sales]);
    server.use(
      http.post("/api/channels/:channelId/join", async () => {
        posts += 1;
        await gate;
        return HttpResponse.json({
          channelId: sales.id,
          roomId: sales.id,
          joinedAt: "2026-11-09T00:00:00.000Z",
        });
      }),
    );
    renderPage();
    await screen.findByRole("link", { name: "[E2E_TEST]営業部" });
    const button = joinButtonOf("[E2E_TEST]営業部") as HTMLElement;
    fireEvent.click(button);
    await waitFor(() =>
      expect(
        (joinButtonOf("[E2E_TEST]営業部") as HTMLButtonElement).disabled,
      ).toBe(true),
    );
    fireEvent.click(joinButtonOf("[E2E_TEST]営業部") as HTMLElement);
    release?.();
    await waitFor(() => expect(joinButtonOf("[E2E_TEST]営業部")).toBeNull());
    expect(posts).toBe(1);
  });

  it("#200 AC-4: 参加に失敗すると、API のメッセージを role=alert で出し、参加済みにはせず、もう一度押せる", async () => {
    respondChannels([sales]);
    server.use(
      http.post("/api/channels/:channelId/join", () =>
        HttpResponse.json(
          { code: "NOT_FOUND", message: "チャンネルが見つかりません" },
          { status: 404 },
        ),
      ),
    );
    renderPage();
    await screen.findByRole("link", { name: "[E2E_TEST]営業部" });
    fireEvent.click(joinButtonOf("[E2E_TEST]営業部") as HTMLElement);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("チャンネルが見つかりません");
    const button = joinButtonOf("[E2E_TEST]営業部") as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.disabled).toBe(false);
  });

  it("#200 AC-4: 部署の絞り込みで departmentId を付けて取り直し、「すべて」で付けない", async () => {
    const recorded = respondChannels([general, sales, dev]);
    renderPage();
    await screen.findByRole("link", { name: "[E2E_TEST]開発部" });
    const filter = screen.getByRole("combobox", { name: /部署/ });
    expect(within(filter).getByRole("option", { name: "すべて" })).toBeTruthy();
    fireEvent.change(filter, { target: { value: DEPT_DEV.id } });
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: "[E2E_TEST]営業部" }),
      ).toBeNull(),
    );
    expect(screen.getByRole("link", { name: "[E2E_TEST]開発部" })).toBeTruthy();
    expect(
      recorded.listRequests.some(
        (url) => url.searchParams.get("departmentId") === DEPT_DEV.id,
      ),
    ).toBe(true);
    fireEvent.change(screen.getByRole("combobox", { name: /部署/ }), {
      target: { value: "" },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "[E2E_TEST]営業部" }),
      ).toBeTruthy(),
    );
    const last = recorded.listRequests.at(-1);
    expect(last?.searchParams.has("departmentId")).toBe(false);
  });

  it("#200 AC-3: 参加中の非公開チャンネルは「非公開」と分かる表示で出る", async () => {
    respondChannels([
      channelItem("4", {
        name: "[E2E_TEST]非公開の相談",
        visibility: "private",
        joined: true,
      }),
    ]);
    renderPage();
    const row = (
      await screen.findByRole("link", { name: "[E2E_TEST]非公開の相談" })
    ).closest("li");
    expect(
      within(row as HTMLElement).getByRole("img", { name: "非公開" }),
    ).toBeTruthy();
  });
});
