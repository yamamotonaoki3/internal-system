// #134 AC-2（Codex のコードレビュー2回目の指摘）: 整形の部品（MarkdownBody）の読み込みには成功し、描画の途中で例外が出たときの表示。API は MSW。データは架空。
// 契約（実装前の仮置き。統括の決定）：
//   動的読み込みの失敗だけを「書式つきの表示を読み込めませんでした。再読み込みしてください。」にする（channel-detail.markdown-load-error.test.tsx）。
//   それ以外の描画中の例外は、その本文を書いたままの文字（改行を保つ）で出し、「この本文は書式つきで表示できませんでした。」を出す。
//   再読み込みは勧めない。例外のメッセージ・スタック・ファイル名は画面に出さない。周り（見出し・ほかの行・入力欄）は残る。
// 再現の方法：vi.mock で MarkdownBody を偽の部品にする。本文に RENDER_FAIL を含む行だけ描画で例外を投げ、ほかの行は外枠 markdown-body で出す。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { respondShellUser } from "../../test/app-shell-harness";
import { message, respondMessages } from "../../test/message-handlers";
import { server } from "../../test/server";
import { ChannelDetailView } from "./components/ChannelDetailView";

/** 画面に出てはいけない、例外に含めた識別用の文字 */
const LEAK_MARKER = "TESTRENDER134";

// vi.mock は先頭へ巻き上げられるため、factory の中では上の定数を使わず、同じ文字を直接書く
vi.mock("../messages/markdown/MarkdownBody", () => ({
  MarkdownBody: ({ body }: { body: string }) => {
    if (body.includes("RENDER_FAIL"))
      throw new TypeError(
        "Cannot read properties of undefined (reading 'children') at remarkRestrict (https://example.com/assets/remark-restrict-TESTRENDER134.js:1:23)",
      );
    return <div className="markdown-body">{body}</div>;
  },
}));

let uncaught: unknown[];
const onWindowError = (event: ErrorEvent) => {
  uncaught.push(event.error ?? event.message);
};

beforeEach(() => {
  respondShellUser();
  uncaught = [];
  window.addEventListener("error", onWindowError);
});

afterEach(() => {
  window.removeEventListener("error", onWindowError);
});

const ID = "01JTESTROOM00000000000R001";
const CHANNEL_NAME = "[E2E_TEST]描画失敗チャンネル";

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

const RENDER_NOTICE = /この本文は書式つきで表示できませんでした。?/;

const BODY_OK_1 = "[E2E_TEST]**一件目** は整形できる";
const BODY_FAIL = "[E2E_TEST]RENDER_FAIL **二件目**\n二行目";
const BODY_OK_3 = "[E2E_TEST]三件目は整形できる";

/** 描画の失敗を含む一覧を出し、整形できる行の表示（読み込みの成功）を待つ */
async function renderWithRenderError() {
  respondMessages([
    message(1, {
      body: BODY_OK_1,
      author: { id: "01JTESTUSER000000000000001", displayName: "テスト太郎" },
    }),
    message(2, {
      body: BODY_FAIL,
      author: { id: "01JTESTUSER000000000000002", displayName: "テスト花子" },
    }),
    message(3, { deleted: true, body: null }),
    message(4, {
      body: BODY_OK_3,
      author: { id: "01JTESTUSER000000000000002", displayName: "テスト花子" },
    }),
  ]);
  respondDetail();
  const rendered = renderDetail();
  await waitFor(() =>
    expect(
      screen.getByRole("log").querySelectorAll(".markdown-body"),
    ).toHaveLength(2),
  );
  const items = within(screen.getByRole("log")).getAllByRole("listitem");
  return { ...rendered, items };
}

describe("#134 AC-2 整形の部品の読み込みには成功し、描画で例外が出たとき", () => {
  it("#134 AC-2: 例外の出た本文は書いたままの文字（記法の記号・改行を保つ）で出し、「この本文は書式つきで表示できませんでした。」を出す", async () => {
    const { items } = await renderWithRenderError();
    const failed = items[1];
    if (failed === undefined) throw new Error("2行目がありません");
    const body = [...failed.querySelectorAll("p")].find(
      (p) => p.textContent === BODY_FAIL,
    );
    expect(body, failed.innerHTML).toBeDefined();
    expect(body?.className).toMatch(/whitespace-pre-wrap/);
    expect(failed.querySelector(".markdown-body")).toBeNull();
    expect(within(failed).getByText(RENDER_NOTICE)).toBeTruthy();
  });

  it("#134 AC-2: 描画の例外では「読み込めませんでした」「再読み込み」を出さない（読み込みの失敗と区別する）", async () => {
    const { container } = await renderWithRenderError();
    await waitFor(() =>
      expect(screen.getAllByText(RENDER_NOTICE)).toHaveLength(1),
    );
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/読み込めませんでした/);
    expect(text).not.toMatch(/再読み込み/);
  });

  it("#134 AC-2: 描画の例外のメッセージ・スタック・ファイル名を画面に出さず、捕捉されない例外も出さない", async () => {
    const { container } = await renderWithRenderError();
    await waitFor(() =>
      expect(screen.getAllByText(RENDER_NOTICE)).toHaveLength(1),
    );
    const text = container.textContent ?? "";
    expect(text).not.toContain(LEAK_MARKER);
    expect(text).not.toMatch(/Error/);
    expect(text).not.toMatch(/Cannot read properties/);
    expect(text).not.toMatch(/remarkRestrict|remark-restrict/);
    expect(text).not.toMatch(/\.(?:js|tsx?)\b/);
    expect(uncaught).toEqual([]);
  });

  it("#134 AC-2: 周りの画面（見出し・入力欄・参加者）とほかの行（整形・削除済みの表示）は残り、案内は例外の出た行だけに出る", async () => {
    const { items } = await renderWithRenderError();
    await waitFor(() =>
      expect(screen.getAllByText(RENDER_NOTICE)).toHaveLength(1),
    );
    expect(
      screen.getByRole("heading", { level: 1, name: CHANNEL_NAME }),
    ).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "メッセージ" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /参加者/ })).toBeTruthy();
    expect(items).toHaveLength(4);
    expect(items[0]?.querySelector(".markdown-body")?.textContent).toBe(
      BODY_OK_1,
    );
    expect(items[0]?.textContent).toContain("テスト太郎");
    expect(items[1]?.textContent).toContain("テスト花子");
    expect(items[2]?.textContent).toContain("このメッセージは削除されました");
    expect(items[3]?.querySelector(".markdown-body")?.textContent).toBe(
      BODY_OK_3,
    );
    for (const index of [0, 2, 3])
      expect(items[index]?.textContent).not.toMatch(RENDER_NOTICE);
  });
});
