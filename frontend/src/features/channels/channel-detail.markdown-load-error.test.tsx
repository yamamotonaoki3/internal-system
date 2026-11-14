// #134 AC-2（コードレビューの指摘）: メッセージの本文の整形の部品（MarkdownBody）の動的読み込みが失敗したときの表示。API は MSW。データは架空。
// 契約（実装前の仮置き。統括から受け取った約束）：
//   MessageBody は React.lazy で ../markdown/MarkdownBody を読み込む。読み込みが失敗しても、画面全体を壊さない。
//   失敗したときは、本文を書いたままの文字（改行を保つ）で出し、「書式つきの表示を読み込めませんでした。再読み込みしてください。」を出す。
//   例外のメッセージ・スタック・ファイル名は画面に出さない。周り（見出し・ほかの行・入力欄）は残る。
// 読み込みの失敗は、vi.mock の factory で例外を投げて再現する（MessageBody の import() が失敗する）。
// 本物の部品は使わないため、整形した表示（.markdown-body）が出ないことも確かめる。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { respondShellUser } from "../../test/app-shell-harness";
import { message, respondMessages } from "../../test/message-handlers";
import { server } from "../../test/server";
import { ChannelDetailView } from "./components/ChannelDetailView";

/** 画面に出てはいけない、例外に含めた識別用の文字（架空のファイル名） */
const LEAK_MARKER = "TESTHASH134";

// vi.mock は先頭へ巻き上げられるため、factory の中では上の定数を使わず、同じ文字を直接書く
vi.mock("../messages/markdown/MarkdownBody", () => {
  throw new Error(
    "Failed to fetch dynamically imported module: https://example.com/assets/MarkdownBody-TESTHASH134.js",
  );
});

beforeEach(() => {
  respondShellUser();
});

const ID = "01JTESTROOM00000000000R001";
const CHANNEL_NAME = "[E2E_TEST]読み込み失敗チャンネル";

function respondDetail() {
  server.use(
    http.get("/api/channels/:channelId", () =>
      HttpResponse.json({
        id: ID,
        roomId: ID,
        name: CHANNEL_NAME,
        description: "",
        visibility: "public",
        departmentId: null,
        isCaseChannel: false,
        readOnly: false,
        joined: true,
        canPost: true,
        memberCount: 1,
        members: [
          { id: "01JTESTUSER000000000000001", displayName: "テスト太郎" },
        ],
      }),
    ),
  );
}

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

const NOTICE = /書式つきの表示を読み込めませんでした。?再読み込みしてください/;

const BODY_1 = "[E2E_TEST]**太字のつもり** と `コード`";
const BODY_2 = "[E2E_TEST]一行目\n二行目";
const BODY_3 = "[E2E_TEST]三件目の本文";

async function renderWithFailedLoad() {
  respondMessages([
    message(1, {
      body: BODY_1,
      author: { id: "01JTESTUSER000000000000001", displayName: "テスト太郎" },
    }),
    message(2, {
      body: BODY_2,
      author: { id: "01JTESTUSER000000000000002", displayName: "テスト花子" },
    }),
    message(3, { deleted: true, body: null }),
    message(4, {
      body: BODY_3,
      author: { id: "01JTESTUSER000000000000002", displayName: "テスト花子" },
    }),
  ]);
  respondDetail();
  const rendered = renderDetail();
  // 読み込みの失敗が反映されるまで待つ（案内が出る）
  await waitFor(() =>
    expect(screen.getAllByText(NOTICE).length).toBeGreaterThan(0),
  );
  return rendered;
}

describe("#134 AC-2 整形の部品の動的読み込みが失敗したとき", () => {
  it("#134 AC-2: 本文を書いたままの文字（記法の記号・改行を保つ）で出し、整形しない", async () => {
    await renderWithFailedLoad();
    const log = screen.getByRole("log");
    const texts = [...log.querySelectorAll("p")].map((p) => p.textContent);
    expect(texts).toContain(BODY_1);
    expect(texts).toContain(BODY_2);
    expect(texts).toContain(BODY_3);
    // 改行を保つ表示（whitespace-pre-wrap）で出す
    const body2 = [...log.querySelectorAll("p")].find(
      (p) => p.textContent === BODY_2,
    );
    expect(body2?.className).toMatch(/whitespace-pre-wrap/);
    expect(log.querySelector(".markdown-body, strong, code")).toBeNull();
  });

  it("#134 AC-2: 「書式つきの表示を読み込めませんでした。再読み込みしてください。」の案内を出す", async () => {
    await renderWithFailedLoad();
    expect(screen.getAllByText(NOTICE).length).toBeGreaterThan(0);
  });

  it("#134 AC-2: 周りの画面（見出し・ほかのメッセージ・入力欄・参加者）は残る", async () => {
    await renderWithFailedLoad();
    expect(
      screen.getByRole("heading", { level: 1, name: CHANNEL_NAME }),
    ).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "メッセージ" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /参加者/ })).toBeTruthy();
    expect(screen.getByRole("log")).toBeTruthy();
  });

  it("#134 AC-2: 例外のメッセージ・スタック・ファイル名を画面に出さない", async () => {
    const { container } = await renderWithFailedLoad();
    const text = container.textContent ?? "";
    expect(text).not.toContain(LEAK_MARKER);
    expect(text).not.toMatch(/Error:?/);
    expect(text).not.toMatch(/Failed to fetch/);
    expect(text).not.toMatch(/MarkdownBody/);
    expect(text).not.toMatch(/\.(?:js|tsx?)\b/);
    expect(text).not.toMatch(/vitest/i);
  });

  it("#134 AC-2: ほかの行に影響しない（各行の投稿者・本文・削除済みの表示がそれぞれ残る）", async () => {
    await renderWithFailedLoad();
    const items = within(screen.getByRole("log")).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[0]?.textContent).toContain("テスト太郎");
    expect(items[0]?.textContent).toContain(BODY_1);
    expect(items[1]?.textContent).toContain("テスト花子");
    expect(items[1]?.textContent).toContain(BODY_2);
    expect(items[2]?.textContent).toContain("このメッセージは削除されました");
    expect(items[3]?.textContent).toContain(BODY_3);
    // 本文の行どうしが入れ替わったり、別の行の本文を含んだりしない
    expect(items[0]?.textContent).not.toContain(BODY_3);
    expect(items[3]?.textContent).not.toContain(BODY_1);
  });
});
