// #134 AC-1（1-3 AC-1・AC-5・AC-6）: チャンネルの詳細（S-05。ChannelDetailView）で、自分の投稿の「編集」「削除」を出す条件。API は MSW。データは架空。
// 契約（実装前の仮置き。計画 plan-134 の改訂1 の軽微2・計画レビューの補足・利用者の決定 U-3・U-9）：
//   チャンネルの詳細（EP-2-06。GET /api/channels/:channelId）の応答に readOnly（真偽。チャンネルの部署が無効＝C-143(1)）が必ずある。
//     readOnly がない応答は、契約違反として取得の失敗（role=alert）にする。
//   ChannelDetailView は RoomMessages に canModifyOwn = joined && !readOnly を渡す（投稿の権限 canPost とは分ける）。
//   参加中で読み取り専用でなければ、お知らせ専用の投稿権限がなくても（元オーナー。canPost が偽）、自分の投稿に「編集」「削除」を出す。
//   未参加・読み取り専用（部署が無効）なら出さない。他人の投稿には出さない。画面のボタンは表示の補助で、可否はサーバーが判定する。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { SHELL_USER, respondShellUser } from "../../test/app-shell-harness";
import { message, respondMessages } from "../../test/message-handlers";
import { server } from "../../test/server";
import { authKeys } from "../auth";
import { ReauthProvider } from "../auth/ReauthProvider";
import { ChannelDetailView } from "./components/ChannelDetailView";

const ID = "01JTESTROOM00000000000R001";
const OTHER = { id: "01JTESTUSER000000000000002", displayName: "testuser_002" };

beforeEach(() => {
  respondShellUser();
});

function respondDetail(body: Record<string, unknown>) {
  server.use(
    http.get("/api/channels/:channelId", () =>
      HttpResponse.json({
        id: ID,
        roomId: ID,
        name: "[E2E_TEST]編集の可否",
        description: "",
        visibility: "public",
        departmentId: "01JTESTDEPT000000000000S01",
        isCaseChannel: false,
        ...body,
      }),
    ),
  );
}

const joined = {
  joined: true,
  memberCount: 2,
  members: [
    { id: SHELL_USER.id, displayName: SHELL_USER.displayName },
    { id: OTHER.id, displayName: OTHER.displayName },
  ],
};

function renderDetail() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ReauthProvider>
          <ChannelDetailView channelId={ID} />
        </ReauthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return client;
}

function respondRoomMessages() {
  respondMessages([
    message(1, {
      author: { id: SHELL_USER.id, displayName: SHELL_USER.displayName },
      body: "[E2E_TEST]自分の投稿",
    }),
    message(2, { author: OTHER, body: "[E2E_TEST]他人の投稿" }),
  ]);
}

async function rowWith(text: string): Promise<HTMLElement> {
  const log = await screen.findByRole("log");
  return waitFor(() => {
    const row = within(log)
      .getAllByRole("listitem")
      .filter((li) => li.parentElement?.closest("li") === null)
      .find((li) => (li.textContent ?? "").includes(text));
    if (row === undefined) throw new Error(`「${text}」の行がありません`);
    return row;
  });
}

async function buttonsOf(text: string) {
  const row = await rowWith(text);
  return {
    edit: within(row).queryByRole("button", { name: "編集" }),
    remove: within(row).queryByRole("button", { name: "削除" }),
  };
}

/** 自分の投稿の行で「編集」「削除」が出るまで待つ（セッションの取得を待つため） */
async function expectOwnButtons() {
  await waitFor(async () => {
    const own = await buttonsOf("[E2E_TEST]自分の投稿");
    expect(own.edit).not.toBeNull();
    expect(own.remove).not.toBeNull();
  });
}

/** セッションと一覧が出そろってから、自分の投稿に「編集」「削除」が無いことを確かめる */
async function expectNoOwnButtons(client: QueryClient) {
  // セッションの取得が終わるまで待つ（利用者が分からないために出ていないだけ、を「無い」と判定しない）
  await waitFor(() =>
    expect(client.getQueryData(authKeys.session)).toBeDefined(),
  );
  await rowWith("[E2E_TEST]他人の投稿");
  const own = await buttonsOf("[E2E_TEST]自分の投稿");
  expect(own.edit).toBeNull();
  expect(own.remove).toBeNull();
}

describe("#134 AC-1（1-3 AC-1・AC-5・AC-6）S-05 の「編集」「削除」の出し分け", () => {
  it("#134 AC-1（1-3 AC-1・AC-5）: 参加中で読み取り専用でなければ、自分の投稿にだけ「編集」「削除」を出す", async () => {
    respondRoomMessages();
    respondDetail({ ...joined, canPost: true, readOnly: false });
    renderDetail();
    await expectOwnButtons();
    const other = await buttonsOf("[E2E_TEST]他人の投稿");
    expect(other.edit).toBeNull();
    expect(other.remove).toBeNull();
  });

  it("#134 AC-1（1-3 AC-5・U-3）: お知らせ専用で投稿の権限がない元オーナー（canPost が偽）でも、参加中なら自分の投稿に「編集」「削除」を出す", async () => {
    respondRoomMessages();
    respondDetail({ ...joined, canPost: false, readOnly: false });
    renderDetail();
    await expectOwnButtons();
    // 投稿の入力欄は出さない（投稿の権限とは分ける）
    expect(screen.queryByRole("textbox", { name: "メッセージ" })).toBeNull();
  });

  it("#134 AC-1（1-3 AC-6・U-9）: 部署が無効（readOnly が真）なら、参加中でも自分の投稿に「編集」「削除」を出さない", async () => {
    respondRoomMessages();
    respondDetail({ ...joined, canPost: true, readOnly: true });
    const client = renderDetail();
    await expectNoOwnButtons(client);
  });

  it("#134 AC-1（U-3）: 未参加の公開チャンネル（抜けた後）では、自分の過去の投稿にも「編集」「削除」を出さない", async () => {
    respondRoomMessages();
    respondDetail({ joined: false, canPost: false, readOnly: false });
    const client = renderDetail();
    expect(
      await screen.findByRole("button", { name: "参加する" }),
    ).toBeDefined();
    await expectNoOwnButtons(client);
  });

  it("#134 AC-1（改訂1 の軽微2・計画レビューの補足）: 部署のない会社直属のチャンネル（departmentId が null・readOnly が偽）では、自分の投稿に「編集」「削除」を出す", async () => {
    respondRoomMessages();
    respondDetail({
      ...joined,
      departmentId: null,
      canPost: true,
      readOnly: false,
    });
    renderDetail();
    await expectOwnButtons();
  });

  it("#134 AC-1（改訂1 の軽微2）: 詳細の応答に readOnly がなければ、取得の失敗（role=alert）として扱い、メッセージの一覧を出さない", async () => {
    respondRoomMessages();
    respondDetail({ ...joined, canPost: true });
    renderDetail();
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.queryByRole("log")).toBeNull();
  });

  it("#134 AC-1（改訂1 の軽微2）: 詳細の応答の readOnly が真偽でなければ、取得の失敗（role=alert）として扱う", async () => {
    respondRoomMessages();
    respondDetail({ ...joined, canPost: true, readOnly: "false" });
    renderDetail();
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.queryByRole("log")).toBeNull();
  });
});
