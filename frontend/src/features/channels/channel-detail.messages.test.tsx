// #201 AC-1・AC-5（画面 S-05）: チャンネルの詳細にメッセージを出し、参加の状態と canPost で入力欄を出し分ける。API は MSW。データは架空。
// 契約（実装前の仮置き）：
//   詳細の応答に canPost（真偽）がある。ChannelDetailView の中で RoomMessages を出す。
//   参加中で canPost 真：入力欄（名前「メッセージ」の textbox）。
//   参加中で canPost 偽（お知らせ専用の権限なし）：入力欄を出さず、「オーナーと全体管理者」を含む案内を出す。
//   未参加の公開：入力欄を出さず「参加する」を出す。メッセージの一覧は読める。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { respondShellUser } from "../../test/app-shell-harness";
import { message, respondMessages } from "../../test/message-handlers";
import { server } from "../../test/server";
import { ChannelDetailView } from "./components/ChannelDetailView";

// #136：S-05 の参加者の「DMを送る」を自分に出さないため、ChannelDetailView がセッション（GET /api/auth/session）を取る。
// 想定外の要求を残さないよう、ログイン済み（testuser_001）の応答を、各テストの前に用意する（確かめる内容は変えない）
beforeEach(() => {
  respondShellUser();
});

const ID = "01JTESTROOM00000000000R001";

function respondDetail(body: Record<string, unknown>) {
  server.use(
    http.get("/api/channels/:channelId", () =>
      HttpResponse.json({
        id: ID,
        roomId: ID,
        name: "[E2E_TEST]詳細チャンネル",
        description: "",
        visibility: "public",
        departmentId: null,
        isCaseChannel: false,
        // #134：詳細の応答に readOnly（部署が無効）が加わった
        readOnly: false,
        ...body,
      }),
    ),
  );
}

const joinedBase = {
  joined: true,
  memberCount: 1,
  members: [{ id: "01JTESTUSER000000000000001", displayName: "テスト太郎" }],
};

function renderDetail() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ChannelDetailView channelId={ID} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const inputBox = () => screen.queryByRole("textbox", { name: "メッセージ" });

describe("#201 AC-1・AC-5 S-05 のメッセージと入力欄の出し分け", () => {
  it("#201 AC-1: 参加中で投稿できるなら、メッセージの一覧と入力欄を出す", async () => {
    respondMessages([message(1, { body: "[E2E_TEST]既存の投稿" })]);
    respondDetail({ ...joinedBase, canPost: true });
    renderDetail();
    expect(
      await screen.findByRole("textbox", { name: "メッセージ" }),
    ).toBeTruthy();
    expect(
      await within(await screen.findByRole("log")).findByText(
        "[E2E_TEST]既存の投稿",
      ),
    ).toBeTruthy();
  });

  it("#201 AC-5: 参加中でも投稿できない（お知らせ専用の権限なし）なら、入力欄を出さず案内を出す", async () => {
    respondMessages([message(1)]);
    respondDetail({ ...joinedBase, canPost: false });
    renderDetail();
    expect(await screen.findByText(/オーナーと全体管理者/)).toBeTruthy();
    expect(inputBox()).toBeNull();
  });

  it("#201 AC-1: 未参加の公開チャンネルは、投稿を読めるが、入力欄は出さず「参加する」を出す", async () => {
    respondMessages([message(1, { body: "[E2E_TEST]読める投稿" })]);
    respondDetail({ joined: false, canPost: false });
    renderDetail();
    expect(
      await screen.findByRole("button", { name: "参加する" }),
    ).toBeTruthy();
    expect(
      await within(await screen.findByRole("log")).findByText(
        "[E2E_TEST]読める投稿",
      ),
    ).toBeTruthy();
    expect(inputBox()).toBeNull();
  });

  it("#201 AC-1: 詳細が404（見えない）なら、メッセージの一覧も入力欄も出さない", async () => {
    respondDetail({});
    server.use(
      http.get("/api/channels/:channelId", () =>
        HttpResponse.json({ code: "NOT_FOUND", message: "x" }, { status: 404 }),
      ),
    );
    renderDetail();
    expect(await screen.findByText("チャンネルが見つかりません")).toBeTruthy();
    expect(screen.queryByRole("log")).toBeNull();
    expect(inputBox()).toBeNull();
  });
});
