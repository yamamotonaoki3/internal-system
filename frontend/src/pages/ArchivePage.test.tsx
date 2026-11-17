// #143-b b-AC-2（2-6 AC-6、S-38、C-124・C-132、決定 Q2）: アーカイブの画面（pages/ArchivePage.tsx）を、利用者の操作で確かめる
// （計画 #143-b 8.2 の F5・F6）。API は MSW（test/channel-admin-handlers.ts）。
// 契約（計画 5.5。文言で定めのないものは計画の案）：
//   見出し h1「アーカイブ」、小見出し「アーカイブしたチャンネル」。並びはサーバーの順（アーカイブした日時の新しい順）。絞り込みはない。
//   行（role=row）：名前・部署・アーカイブした人・日時（日本時間）・理由（なければ「（なし）」）・操作「復元」（canRestore のときだけ）。
//   「復元」→ 復元のダイアログ（a の部品）→ 再認証 → POST /api/channels/:id/restore { version }。成功でページの上に「チャンネル「{名前}」を復元しました」、一覧を取り直す。
//   409・404 はダイアログに文。閉じたら一覧を取り直す。物理削除のボタンはない（#143-c）。
//   4つの状態：「読み込み中です」／エラー（role=alert と「再読み込み」）／「アーカイブしたチャンネルはありません」／行。「さらに読み込む」。
// データは架空。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { ReauthProvider } from "../features/auth/ReauthProvider";
import { TEST_PASSWORD } from "../test/auth-handlers";
import {
  adminChannelId,
  adminChannelName,
  archivedItem,
  deferred,
  respondArchivedItems,
  respondChannelAdminSession,
  respondManageWrites,
  type ArchivedItem,
} from "../test/channel-admin-handlers";
import { ArchivePage } from "./ArchivePage";

type User = ReturnType<typeof userEvent.setup>;
const ALREADY = "この項目はすでに処理されています";

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/archive"]}>
        <ReauthProvider>
          <Routes>
            <Route path="/archive" element={<ArchivePage />} />
          </Routes>
        </ReauthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user };
}

const page = (items: ArchivedItem[], nextCursor: string | null = null) => ({
  items,
  nextCursor,
});

async function findRow(name: string) {
  await waitFor(() =>
    expect(
      screen
        .queryAllByRole("row")
        .some((row) => row.textContent?.includes(name)),
    ).toBe(true),
  );
  const found = screen
    .getAllByRole("row")
    .find((row) => row.textContent?.includes(name));
  if (found === undefined) throw new Error(`${name} の行がありません`);
  return found;
}

const rowOf = (name: string) =>
  screen.queryAllByRole("row").find((row) => row.textContent?.includes(name));

async function reauthenticate(user: User) {
  const reauth = await screen.findByRole("dialog", { name: "再認証" });
  await user.type(within(reauth).getByLabelText("パスワード"), TEST_PASSWORD);
  await user.click(within(reauth).getByRole("button", { name: "再認証" }));
}

async function openRestore(user: User, name: string) {
  const row = await findRow(name);
  await user.click(within(row).getByRole("button", { name: "復元" }));
  return screen.findByRole("dialog", {
    name: `チャンネル「${name}」を復元しますか`,
  });
}

beforeEach(() => {
  respondChannelAdminSession();
});

describe("#143-b b-AC-2 S-38 の一覧（F6）", () => {
  it("#143-b b-AC-2（F6・決定 Q2）: 見出し「アーカイブ」と小見出し「アーカイブしたチャンネル」。種類はチャンネルで取得し、絞り込みの欄はない", async () => {
    const calls = respondArchivedItems(() => page([archivedItem(1)]));
    renderPage();
    expect(
      await screen.findByRole("heading", { level: 1, name: "アーカイブ" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "アーカイブしたチャンネル" }),
    ).toBeTruthy();
    await findRow(adminChannelName(1));
    expect(["channel", null]).toContain(calls[0]?.get("type") ?? null);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("#143-b b-AC-2（F6・2-6 AC-6）: 行に名前・部署・アーカイブした人・日本時間の日時・理由を出す。理由がなければ「（なし）」。サーバーの順のまま並べる", async () => {
    respondArchivedItems(() =>
      page([
        archivedItem(2, { deletedAt: "2026-11-16T15:30:00.000Z" }),
        archivedItem(1, { reason: null }),
      ]),
    );
    renderPage();
    const newer = await findRow(adminChannelName(2));
    for (const text of [
      "[E2E_TEST]部署143b",
      "testuser_143b_owner",
      "2026-11-17",
      "00:30",
      "[E2E_TEST]統合のため",
    ])
      expect(newer.textContent, text).toContain(text);
    const older = await findRow(adminChannelName(1));
    expect(older.textContent).toContain("（なし）");
    expect(older.textContent).toContain("2026-11-15");
    expect(older.textContent).toContain("09:00");
    const rows = screen
      .getAllByRole("row")
      .filter((row) => row.textContent?.includes("E2E_TEST_143b管理"));
    expect(
      rows.map((row) => row.textContent?.includes(adminChannelName(2))),
    ).toEqual([true, false]);
  });

  it("#143-b b-AC-2（F6）: 「復元」は canRestore の行だけ。物理削除のボタンはない（#143-c）", async () => {
    respondArchivedItems(() =>
      page([archivedItem(1), archivedItem(2, { canRestore: false })]),
    );
    renderPage();
    const restorable = await findRow(adminChannelName(1));
    expect(
      within(restorable).getByRole("button", { name: "復元" }),
    ).toBeTruthy();
    const other = await findRow(adminChannelName(2));
    expect(within(other).queryByRole("button", { name: "復元" })).toBeNull();
    expect(screen.queryByRole("button", { name: /削除/ })).toBeNull();
  });
});

describe("#143-b b-AC-2 S-38 の復元（F3 (b)・F6）", () => {
  it("#143-b b-AC-2（F6・F3 (b)）: 「復元」→ 再認証で一覧の版を1回送り、行が消えても、ページの上に完了の文を出す", async () => {
    let restored = false;
    const calls = respondArchivedItems(() =>
      page(restored ? [archivedItem(2)] : [archivedItem(1), archivedItem(2)]),
    );
    const sent = respondManageWrites({
      restore: () => {
        restored = true;
        return HttpResponse.json({
          id: adminChannelId(1),
          version: 5,
          restoredAt: "2026-11-17T00:00:00.000Z",
        });
      },
    });
    const { user } = renderPage();
    const dialog = await openRestore(user, adminChannelName(1));
    expect(sent.reauths).toBe(0);
    await user.click(within(dialog).getByRole("button", { name: "復元" }));
    await reauthenticate(user);
    expect(
      await screen.findByText(
        `チャンネル「${adminChannelName(1)}」を復元しました`,
      ),
    ).toBeTruthy();
    expect(sent.restores).toEqual([
      { id: adminChannelId(1), body: { version: 4 } },
    ]);
    await waitFor(() => expect(rowOf(adminChannelName(1))).toBeUndefined());
    expect(rowOf(adminChannelName(2))).toBeDefined();
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("#143-b b-AC-2（F6）: 409 はダイアログに「この項目はすでに処理されています」を出し、閉じると一覧を取り直す", async () => {
    const calls = respondArchivedItems(() => page([archivedItem(1)]));
    respondManageWrites({
      restore: () =>
        HttpResponse.json(
          { code: "CONFLICT", message: ALREADY },
          { status: 409 },
        ),
    });
    const { user } = renderPage();
    const dialog = await openRestore(user, adminChannelName(1));
    await user.click(within(dialog).getByRole("button", { name: "復元" }));
    await reauthenticate(user);
    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      ALREADY,
    );
    const before = calls.length;
    await user.click(
      within(dialog).getByRole("button", { name: "キャンセル" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /復元/ })).toBeNull(),
    );
    await waitFor(() => expect(calls.length).toBeGreaterThan(before));
  });

  it("#143-b b-AC-2（F6・2-6 AC-6）: 再認証をやめたら、復元を送らない", async () => {
    respondArchivedItems(() => page([archivedItem(1)]));
    const sent = respondManageWrites();
    const { user } = renderPage();
    const dialog = await openRestore(user, adminChannelName(1));
    await user.click(within(dialog).getByRole("button", { name: "復元" }));
    const reauth = await screen.findByRole("dialog", { name: "再認証" });
    await user.click(
      within(reauth).getByRole("button", { name: "キャンセル" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "再認証" })).toBeNull(),
    );
    expect(sent.restores).toEqual([]);
  });
});

describe("#143-b b-AC-2 4つの状態と続き（F5）", () => {
  it("#143-b b-AC-2（F5）: 応答を待つ間は「読み込み中です」", async () => {
    const gate = deferred();
    respondArchivedItems(async () => {
      await gate.promise;
      return page([archivedItem(1)]);
    });
    renderPage();
    expect(await screen.findByText("読み込み中です")).toBeTruthy();
    gate.release();
    await findRow(adminChannelName(1));
  });

  it("#143-b b-AC-2（F5）: 失敗は role=alert で知らせ、「再読み込み」で取り直す", async () => {
    let fail = true;
    respondArchivedItems(() =>
      fail
        ? HttpResponse.json(
            { code: "INTERNAL_ERROR", message: "内部エラー" },
            { status: 500 },
          )
        : page([archivedItem(1)]),
    );
    const { user } = renderPage();
    expect(await screen.findByRole("alert")).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole("button", { name: "再読み込み" }));
    await findRow(adminChannelName(1));
  });

  it("#143-b b-AC-2（F5）: 0件は「アーカイブしたチャンネルはありません」", async () => {
    respondArchivedItems(() => page([]));
    renderPage();
    expect(
      await screen.findByText("アーカイブしたチャンネルはありません"),
    ).toBeTruthy();
  });

  it("#143-b b-AC-2（F5）: 「さらに読み込む」でカーソルを送り、前の行も残す", async () => {
    const calls = respondArchivedItems((params) =>
      params.get("cursor") === "next-1"
        ? page([archivedItem(2)])
        : page([archivedItem(1)], "next-1"),
    );
    const { user } = renderPage();
    await findRow(adminChannelName(1));
    await user.click(screen.getByRole("button", { name: "さらに読み込む" }));
    await findRow(adminChannelName(2));
    expect(rowOf(adminChannelName(1))).toBeDefined();
    expect(calls.at(-1)?.get("cursor")).toBe("next-1");
  });
});
