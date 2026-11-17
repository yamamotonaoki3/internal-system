// #143-b b-AC-1（2-6 AC-5①⑥、S-39、C-131・D-1・D-6、決定 Q2）: チャンネル管理の画面（pages/ChannelManagePage.tsx）を、利用者の操作で確かめる
// （計画 #143-b 8.2 の F1〜F5）。API は MSW（test/channel-admin-handlers.ts）。認可はサーバーが毎回行い、画面の出し分けは表示だけ。
// 契約（計画 5.5。文言で定めのないものは計画の案）：
//   見出し h1「チャンネル管理」。絞り込み：「名前で検索」の欄と「状態」の選択（すべて・使用中・アーカイブ中。初期値「すべて」）。「検索」で確定する。
//   行（role=row）の列：名前（リンクにしない）・種類（通常／部署の専用／お知らせ専用／全社連絡）・公開／非公開・部署（無効なら「（無効）」、
//     会社直属は「会社直属」）・状態（使用中／アーカイブ中）・参加者数・操作（「{名前}の操作」の「⋯」）。
//   「⋯」の項目は manage のとおり（名前・説明を編集／アーカイブ／復元）。物理削除の項目はない。
//   アーカイブ・復元のダイアログはページが持つ（一覧の取り直しで行が消えても完了の表示が出る）。完了の文はページの上に
//     「チャンネル「{名前}」をアーカイブしました」「チャンネル「{名前}」を復元しました」。チャンネルの詳細へは移らない。
//   編集の「最新の内容を読み込む」は 1件の API（GET /api/admin/channels/:id）を呼ぶ（詳細の API を呼ばない）。
//   4つの状態：「読み込み中です」／エラー（role=alert と「再読み込み」）／「該当するチャンネルはありません」／行。「さらに読み込む」。
//   422 の fields: ["q"] は名前の欄のエラー（aria-invalid）。
// データは架空。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { ReauthProvider } from "../features/auth/ReauthProvider";
import { TEST_PASSWORD } from "../test/auth-handlers";
import {
  DESCRIPTION_ONLY_MANAGE,
  adminChannel,
  adminChannelId,
  adminChannelName,
  archivedAdminChannel,
  deferred,
  respondAdminChannel,
  respondAdminChannels,
  respondChannelAdminSession,
  respondManageWrites,
  type AdminChannel,
} from "../test/channel-admin-handlers";
import { server } from "../test/server";
import { ChannelManagePage } from "./ChannelManagePage";

type User = ReturnType<typeof userEvent.setup>;

function CurrentPath() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/channel-management"]}>
        <ReauthProvider>
          <Routes>
            <Route path="/channel-management" element={<ChannelManagePage />} />
            <Route path="*" element={<p>別の画面</p>} />
          </Routes>
          <CurrentPath />
        </ReauthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user, client };
}

const page = (items: AdminChannel[], nextCursor: string | null = null) => ({
  items,
  nextCursor,
});

/** 名前を含む行（role=row）を待って返す */
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

async function openRowMenu(user: User, name: string) {
  const row = await findRow(name);
  await user.click(within(row).getByRole("button", { name: `${name}の操作` }));
  return screen.findByRole("menu");
}

const menuLabels = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole("menuitem")
    .map((item) => item.textContent?.trim());

async function reauthenticate(user: User) {
  const reauth = await screen.findByRole("dialog", { name: "再認証" });
  await user.type(within(reauth).getByLabelText("パスワード"), TEST_PASSWORD);
  await user.click(within(reauth).getByRole("button", { name: "再認証" }));
}

beforeEach(() => {
  respondChannelAdminSession();
});

describe("#143-b b-AC-1 S-39 の絞り込みと列（F1）", () => {
  it("#143-b b-AC-1（F1・D-6）: 見出し「チャンネル管理」。初期値は状態「すべて」・名前なしで1回だけ取得する", async () => {
    const calls = respondAdminChannels(() => page([adminChannel(1)]));
    renderPage();
    expect(
      await screen.findByRole("heading", { level: 1, name: "チャンネル管理" }),
    ).toBeTruthy();
    await findRow(adminChannelName(1));
    expect(calls).toHaveLength(1);
    expect(["all", null]).toContain(calls[0]?.get("state") ?? null);
    expect(calls[0]?.has("q")).toBe(false);
    const state = screen.getByLabelText("状態");
    if (!(state instanceof HTMLSelectElement))
      throw new Error("状態の欄が select ではありません");
    expect(state.selectedOptions[0]?.textContent).toBe("すべて");
    expect([...state.options].map((option) => option.textContent)).toEqual([
      "すべて",
      "使用中",
      "アーカイブ中",
    ]);
  });

  it("#143-b b-AC-1（F1・決定 Q2）: 名前と状態を入れても「検索」まで取得せず、「検索」で q と state を送る", async () => {
    const calls = respondAdminChannels(() => page([adminChannel(1)]));
    const { user } = renderPage();
    await findRow(adminChannelName(1));
    await user.type(screen.getByLabelText("名前で検索"), "営業");
    await user.selectOptions(screen.getByLabelText("状態"), "使用中");
    expect(calls).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "検索" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]?.get("q")).toBe("営業");
    expect(calls[1]?.get("state")).toBe("active");
  });

  it("#143-b b-AC-1（F1・D-1・D-3）: 行に種類の文字の印・公開／非公開・部署（無効は「（無効）」、会社直属）・状態・参加者数を出す。名前はリンクにしない", async () => {
    respondAdminChannels(() =>
      page([
        adminChannel(1, { memberCount: 17 }),
        adminChannel(2, {
          purpose: "department",
          visibility: "private",
          manage: DESCRIPTION_ONLY_MANAGE,
        }),
        adminChannel(3, {
          purpose: "announcement",
          manage: DESCRIPTION_ONLY_MANAGE,
        }),
        adminChannel(4, {
          purpose: "company_general",
          department: null,
          manage: DESCRIPTION_ONLY_MANAGE,
        }),
        archivedAdminChannel(5, {
          department: {
            id: "01JTEST143BDEPT00000000009",
            name: "[E2E_TEST]無効部署",
            isActive: false,
          },
        }),
      ]),
    );
    renderPage();
    const normal = await findRow(adminChannelName(1));
    for (const text of ["通常", "公開", "[E2E_TEST]部署143b", "使用中", "17"])
      expect(normal.textContent, text).toContain(text);
    expect(within(normal).queryByRole("link")).toBeNull();
    const dedicated = await findRow(adminChannelName(2));
    expect(dedicated.textContent).toContain("部署の専用");
    expect(dedicated.textContent).toContain("非公開");
    expect((await findRow(adminChannelName(3))).textContent).toContain(
      "お知らせ専用",
    );
    const general = await findRow(adminChannelName(4));
    expect(general.textContent).toContain("全社連絡");
    expect(general.textContent).toContain("会社直属");
    const archived = await findRow(adminChannelName(5));
    expect(archived.textContent).toContain("アーカイブ中");
    expect(archived.textContent).toContain("[E2E_TEST]無効部署（無効）");
  });
});

describe("#143-b b-AC-1 行の「⋯」（F2）", () => {
  it("#143-b b-AC-1（F2・D-1）: 通常は編集とアーカイブ、部署の専用・お知らせ専用・全社連絡は編集だけ、アーカイブ中は復元だけ。物理削除の項目はない", async () => {
    respondAdminChannels(() =>
      page([
        adminChannel(1),
        adminChannel(2, {
          purpose: "department",
          manage: DESCRIPTION_ONLY_MANAGE,
        }),
        adminChannel(3, {
          purpose: "announcement",
          manage: DESCRIPTION_ONLY_MANAGE,
        }),
        adminChannel(4, {
          purpose: "company_general",
          department: null,
          manage: DESCRIPTION_ONLY_MANAGE,
        }),
        archivedAdminChannel(5),
      ]),
    );
    const { user } = renderPage();
    const expected: [number, string[]][] = [
      [1, ["名前・説明を編集", "アーカイブ"]],
      [2, ["名前・説明を編集"]],
      [3, ["名前・説明を編集"]],
      [4, ["名前・説明を編集"]],
      [5, ["復元"]],
    ];
    for (const [n, labels] of expected) {
      const menu = await openRowMenu(user, adminChannelName(n));
      expect(menuLabels(menu), adminChannelName(n)).toEqual(labels);
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    }
    expect(screen.queryByRole("button", { name: /削除/ })).toBeNull();
  });

  it("#143-b b-AC-1（F2・D-1）: 部署の専用の編集のダイアログは、説明の欄だけ（名前の欄がない）", async () => {
    respondAdminChannels(() =>
      page([
        adminChannel(2, {
          purpose: "department",
          manage: DESCRIPTION_ONLY_MANAGE,
        }),
      ]),
    );
    const { user } = renderPage();
    const menu = await openRowMenu(user, adminChannelName(2));
    await user.click(
      within(menu).getByRole("menuitem", { name: "名前・説明を編集" }),
    );
    const dialog = await screen.findByRole("dialog", { name: /編集/ });
    expect(within(dialog).queryByLabelText(/名前/)).toBeNull();
    expect(within(dialog).getByLabelText(/説明/)).toBeTruthy();
  });
});

describe("#143-b b-AC-1 アーカイブ・復元の完了の表示（F3）", () => {
  it("#143-b b-AC-1（F3 (a)）: 「使用中」で絞り込んでアーカイブすると、取り直しで行が消えても、ページの上に完了の文が出る。詳細へ移らない", async () => {
    let archived = false;
    const calls = respondAdminChannels(() =>
      page(archived ? [adminChannel(2)] : [adminChannel(1), adminChannel(2)]),
    );
    const sent = respondManageWrites({
      archive: () => {
        archived = true;
        return HttpResponse.json({
          id: adminChannelId(1),
          version: 4,
          deletedAt: "2026-11-17T00:00:00.000Z",
        });
      },
    });
    const { user } = renderPage();
    await findRow(adminChannelName(1));
    await user.selectOptions(screen.getByLabelText("状態"), "使用中");
    await user.click(screen.getByRole("button", { name: "検索" }));
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));
    const menu = await openRowMenu(user, adminChannelName(1));
    await user.click(
      within(menu).getByRole("menuitem", { name: "アーカイブ" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: `チャンネル「${adminChannelName(1)}」をアーカイブしますか`,
    });
    await user.click(
      within(dialog).getByRole("button", { name: "アーカイブ" }),
    );
    await reauthenticate(user);
    expect(
      await screen.findByText(
        `チャンネル「${adminChannelName(1)}」をアーカイブしました`,
      ),
    ).toBeTruthy();
    expect(sent.archives).toHaveLength(1);
    expect(sent.archives[0]).toMatchObject({
      id: adminChannelId(1),
      body: { version: 3 },
    });
    await waitFor(() => expect(rowOf(adminChannelName(1))).toBeUndefined());
    expect(rowOf(adminChannelName(2))).toBeDefined();
    expect(screen.getByTestId("path").textContent).toBe("/channel-management");
    expect(calls.at(-1)?.get("state")).toBe("active");
  });

  it("#143-b b-AC-1（F3）: アーカイブ中の行を「復元」すると、再認証の後に版を送り、ページの上に完了の文、一覧を取り直す", async () => {
    let restored = false;
    const calls = respondAdminChannels(() =>
      page([restored ? adminChannel(5) : archivedAdminChannel(5)]),
    );
    const sent = respondManageWrites({
      restore: () => {
        restored = true;
        return HttpResponse.json({
          id: adminChannelId(5),
          version: 5,
          restoredAt: "2026-11-17T00:00:00.000Z",
        });
      },
    });
    const { user } = renderPage();
    const menu = await openRowMenu(user, adminChannelName(5));
    await user.click(within(menu).getByRole("menuitem", { name: "復元" }));
    const dialog = await screen.findByRole("dialog", { name: /復元/ });
    await user.click(within(dialog).getByRole("button", { name: "復元" }));
    await reauthenticate(user);
    expect(
      await screen.findByText(
        `チャンネル「${adminChannelName(5)}」を復元しました`,
      ),
    ).toBeTruthy();
    expect(sent.restores).toEqual([
      { id: adminChannelId(5), body: { version: 3 } },
    ]);
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() =>
      expect(rowOf(adminChannelName(5))?.textContent).toContain("使用中"),
    );
    expect(screen.getByTestId("path").textContent).toBe("/channel-management");
  });

  it("#143-b b-AC-1（F3 (b)）: 「アーカイブ中」で絞り込んで復元し、取り直しで行が消えても、完了の文が出る", async () => {
    let restored = false;
    respondAdminChannels((params) =>
      page(
        params.get("state") === "archived" && restored
          ? []
          : [archivedAdminChannel(5)],
      ),
    );
    respondManageWrites({
      restore: () => {
        restored = true;
        return HttpResponse.json({
          id: adminChannelId(5),
          version: 5,
          restoredAt: "2026-11-17T00:00:00.000Z",
        });
      },
    });
    const { user } = renderPage();
    await findRow(adminChannelName(5));
    await user.selectOptions(screen.getByLabelText("状態"), "アーカイブ中");
    await user.click(screen.getByRole("button", { name: "検索" }));
    const menu = await openRowMenu(user, adminChannelName(5));
    await user.click(within(menu).getByRole("menuitem", { name: "復元" }));
    const dialog = await screen.findByRole("dialog", { name: /復元/ });
    await user.click(within(dialog).getByRole("button", { name: "復元" }));
    await reauthenticate(user);
    expect(
      await screen.findByText(
        `チャンネル「${adminChannelName(5)}」を復元しました`,
      ),
    ).toBeTruthy();
    await waitFor(() => expect(rowOf(adminChannelName(5))).toBeUndefined());
  });
});

describe("#143-b b-AC-1 編集の「最新の内容を読み込む」（F4）", () => {
  it("#143-b b-AC-1（F4）: 版の 409 の後の「最新の内容を読み込む」は 1件の API（EP-2-43）を呼び、詳細の API（EP-2-06）を呼ばない。保存は新しい版で送る", async () => {
    respondAdminChannels(() =>
      page([adminChannel(1, { visibility: "private" })]),
    );
    const latestCalls = respondAdminChannel(() =>
      adminChannel(1, {
        name: "E2E_TEST_143b他人の名前",
        description: "他人の説明",
        version: 7,
      }),
    );
    let detailCalls = 0;
    server.use(
      http.get("/api/channels/:channelId", () => {
        detailCalls += 1;
        return HttpResponse.json(
          { code: "NOT_FOUND", message: "チャンネルが見つかりません" },
          { status: 404 },
        );
      }),
    );
    let patches = 0;
    const sent = respondManageWrites({
      patch: () => {
        patches += 1;
        if (patches === 1)
          return HttpResponse.json(
            {
              code: "CONFLICT",
              message: "ほかの人が先に変更しました。読み込み直してください",
            },
            { status: 409 },
          );
        return HttpResponse.json({
          id: adminChannelId(1),
          name: "E2E_TEST_143b他人の名前",
          description: "自分の説明",
          version: 8,
          updatedAt: "2026-11-17T00:00:00.000Z",
        });
      },
    });
    const { user } = renderPage();
    const menu = await openRowMenu(user, adminChannelName(1));
    await user.click(
      within(menu).getByRole("menuitem", { name: "名前・説明を編集" }),
    );
    const dialog = await screen.findByRole("dialog", { name: /編集/ });
    await user.type(within(dialog).getByLabelText(/説明/), "追記");
    await user.click(within(dialog).getByRole("button", { name: "保存" }));
    await user.click(
      await within(dialog).findByRole("button", {
        name: "最新の内容を読み込む",
      }),
    );
    const name = within(dialog).getByLabelText(/名前/) as HTMLInputElement;
    await waitFor(() => expect(name.value).toBe("E2E_TEST_143b他人の名前"));
    expect(latestCalls).toEqual([adminChannelId(1)]);
    expect(detailCalls).toBe(0);
    const description = within(dialog).getByLabelText(
      /説明/,
    ) as HTMLTextAreaElement;
    await user.clear(description);
    await user.type(description, "自分の説明");
    await user.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(sent.patches).toHaveLength(2));
    expect(sent.patches[1]?.body).toMatchObject({
      version: 7,
      description: "自分の説明",
    });
  });
});

describe("#290（#143-b b-AC-4・F9）S-39 の編集の読み込みの失敗", () => {
  it("#290 AC-1（#143-b b-AC-4）: 「最新の内容を読み込む」が失敗したら、入力は保ったまま欄と「保存」を有効に戻し、文を出す", async () => {
    respondAdminChannels(() => page([adminChannel(1)]));
    respondAdminChannel(() =>
      HttpResponse.json(
        { code: "INTERNAL_ERROR", message: "内部エラー" },
        { status: 500 },
      ),
    );
    respondManageWrites({
      patch: () =>
        HttpResponse.json(
          {
            code: "CONFLICT",
            message: "ほかの人が先に変更しました。読み込み直してください",
          },
          { status: 409 },
        ),
    });
    const { user } = renderPage();
    const menu = await openRowMenu(user, adminChannelName(1));
    await user.click(
      within(menu).getByRole("menuitem", { name: "名前・説明を編集" }),
    );
    const dialog = await screen.findByRole("dialog", { name: /編集/ });
    const description = within(dialog).getByLabelText(
      /説明/,
    ) as HTMLTextAreaElement;
    await user.type(description, "追記");
    await user.click(within(dialog).getByRole("button", { name: "保存" }));
    await user.click(
      await within(dialog).findByRole("button", {
        name: "最新の内容を読み込む",
      }),
    );
    await waitFor(() =>
      expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(1),
    );
    await waitFor(() => expect(description.disabled).toBe(false));
    expect(description.value).toBe("[E2E_TEST]説明追記");
    expect(
      (within(dialog).getByLabelText(/名前/) as HTMLInputElement).disabled,
    ).toBe(false);
    expect(within(dialog).getByRole("button", { name: "保存" })).toHaveProperty(
      "disabled",
      false,
    );
  });
});

describe("#143-b b-AC-1 4つの状態と続き（F5）", () => {
  it("#143-b b-AC-1（F5）: 応答を待つ間は「読み込み中です」", async () => {
    const gate = deferred();
    respondAdminChannels(async () => {
      await gate.promise;
      return page([adminChannel(1)]);
    });
    renderPage();
    expect(await screen.findByText("読み込み中です")).toBeTruthy();
    gate.release();
    await findRow(adminChannelName(1));
    expect(screen.queryByText("読み込み中です")).toBeNull();
  });

  it("#143-b b-AC-1（F5）: 失敗は role=alert で知らせ、「再読み込み」で取り直す", async () => {
    let fail = true;
    const calls = respondAdminChannels(() =>
      fail
        ? HttpResponse.json(
            { code: "INTERNAL_ERROR", message: "内部エラー" },
            { status: 500 },
          )
        : page([adminChannel(1)]),
    );
    const { user } = renderPage();
    expect(await screen.findByRole("alert")).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole("button", { name: "再読み込み" }));
    await findRow(adminChannelName(1));
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("#143-b b-AC-1（F5）: 0件は「該当するチャンネルはありません」", async () => {
    respondAdminChannels(() => page([]));
    renderPage();
    expect(
      await screen.findByText("該当するチャンネルはありません"),
    ).toBeTruthy();
  });

  it("#143-b b-AC-1（F5）: 続きがあれば「さらに読み込む」で、同じ絞り込みとカーソルで次を取り、前の行も残す", async () => {
    const calls = respondAdminChannels((params) =>
      params.get("cursor") === "next-1"
        ? page([adminChannel(2)])
        : page([adminChannel(1)], "next-1"),
    );
    const { user } = renderPage();
    await findRow(adminChannelName(1));
    await user.click(screen.getByRole("button", { name: "さらに読み込む" }));
    await findRow(adminChannelName(2));
    expect(rowOf(adminChannelName(1))).toBeDefined();
    expect(calls.at(-1)?.get("cursor")).toBe("next-1");
    expect(screen.queryByRole("button", { name: "さらに読み込む" })).toBeNull();
  });

  it('#143-b b-AC-1（F5）: 422 の fields: ["q"] は、名前の欄のエラーとして関連付ける', async () => {
    respondAdminChannels((params) =>
      params.has("q")
        ? HttpResponse.json(
            {
              code: "VALIDATION_ERROR",
              message: "入力内容を確かめてください",
              fields: ["q"],
            },
            { status: 422 },
          )
        : page([adminChannel(1)]),
    );
    const { user } = renderPage();
    await findRow(adminChannelName(1));
    const q = screen.getByLabelText("名前で検索");
    await user.type(q, "あ");
    await user.click(screen.getByRole("button", { name: "検索" }));
    await waitFor(() => expect(q.getAttribute("aria-invalid")).toBe("true"));
  });
});
