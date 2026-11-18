// #143（deps:check の no-features-to-pages）：ChannelsPage を描画するため、features の外（src の直下）に置く。
// #143-a a-AC-6（C-131）・a-AC-1〜a-AC-3: S-05 のヘッダーの「⋯」メニュー（ChannelManageMenu）と、共通の確認画面
// （名前・説明の編集 ChannelEditDialog、アーカイブ ChannelArchiveDialog、復元 ChannelRestoreDialog）を、利用者の操作で確かめる。API は MSW。データは架空。
// 認可はサーバーが判定し、メニューの出し分けは表示だけ（計画 #143-a「画面」）。
// 契約（実装前の仮置き。報告に明記）：
//   詳細（GET /api/channels/:id）に version と manage: { canRename, canEditDescription, canArchive } が足される。
//   ヘッダーの「⋯」ボタンは、名前「{チャンネル名}の操作」。manage のどれかが真のときだけ出す。押す（Enter でも）と role=menu を開き、
//     項目（role=menuitem）は「名前・説明を編集」（canRename か canEditDescription）、「アーカイブ」（canArchive）。Esc で閉じてフォーカスを「⋯」に戻す。
//   編集のダイアログ：role=dialog、名前に「編集」を含む。入力欄のラベルは「名前」（canRename が偽なら出さない）・「説明」、送信のボタンは「保存」、閉じるのは「キャンセル」。
//     画面の検査は shared/channel-name-rules.ts の規則（名前は整形後 1〜50 文字・使える文字、説明は 500 文字まで）。誤りは該当の欄に関連付けて（aria-invalid・aria-describedby）出し、送らない。
//     PATCH /api/channels/:id に { version, name?, description? } を送る。422 の fields は該当の欄のエラー、名前の重複の 409 は名前の欄に「同じ名前のチャンネルがあります」。
//     送信中は「保存」を押せない（二重送信の防止）。成功で閉じ、詳細を取り直す（再読み込みなしで見出しが変わる）。入力を変えている間は、離れる前の確認（beforeunload）を登録する。
//   アーカイブのダイアログ：role=dialog、名前「チャンネル「{名前}」をアーカイブしますか」。理由の欄（ラベル「理由」を含む。任意・500文字まで。残りの文字数を出す）。
//     「アーカイブ」→ 再認証（S-26。ダイアログ「再認証」）→ POST /api/channels/:id/delete { version, reason? }。成功で /channels へ移り「アーカイブしました」を出す。
//     409 は「この項目はすでに処理されています」を role=alert に出し、詳細を取り直す。閉じたらフォーカスを「⋯」に戻す。
//   復元のダイアログ：features/channels の index.ts から ChannelRestoreDialog を公開する。props { channelId, channelName, version, onClose, onRestored? }。
//     role=dialog（名前に「復元」を含む）、「復元」→ 再認証 → POST /api/channels/:id/restore { version }。409 は文を role=alert に出す。
// #143-b で足した確認（計画 #143-b 8.2 の F9・F10・F11）：
//   F9（#290）：「最新の内容を読み込む」の応答を待つ間は、名前・説明の欄と「保存」を無効にし、入力を失わない。応答の後は最新の内容を入れて有効に戻す。
//     失敗したら入力は保ったまま有効に戻す（失敗の場合は pages/ChannelManagePage.test.tsx で確かめる。S-05 では詳細の API の失敗で画面そのものがエラーになるため）。
//   F10（C-181 (9) の見直し）：アーカイブ・復元の成功で、channels に加えて unread・threads・notifications のキーも取り直す。名前・説明の変更では取り直さない。
//   F11：S-05 の「⋯」（onSelect を渡さない既存の呼び出し）は、編集の読み直しに詳細の API を使い、管理者用の1件の API を呼ばない。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, delay, http } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelsPage } from "./pages/ChannelsPage";
import { SHELL_USER, respondShellUser } from "./test/app-shell-harness";
import { TEST_PASSWORD } from "./test/auth-handlers";
import { respondChannels } from "./test/channel-handlers";
import { respondMessages } from "./test/message-handlers";
import { server } from "./test/server";
import { ReauthProvider } from "./features/auth/ReauthProvider";
import { ChannelDetailView, ChannelRestoreDialog } from "./features/channels";

const ID = "01JTESTROOM00000000000M001";
const NAME = "E2E_TEST_管理用";
const MENU_BUTTON = `${NAME}の操作`;
const ARCHIVE_TITLE = `チャンネル「${NAME}」をアーカイブしますか`;
const ALREADY = "この項目はすでに処理されています";
const DUPLICATE = "同じ名前のチャンネルがあります";

type Manage = {
  canRename: boolean;
  canEditDescription: boolean;
  canArchive: boolean;
};
const ALL: Manage = {
  canRename: true,
  canEditDescription: true,
  canArchive: true,
};
const NONE: Manage = {
  canRename: false,
  canEditDescription: false,
  canArchive: false,
};

type World = {
  name: string;
  description: string;
  version: number;
  detailRequests: number;
  patches: unknown[];
  archives: unknown[];
  restores: unknown[];
  reauths: number;
};

function respondWorld(
  options: {
    manage?: Manage;
    patch?: () => Response | Promise<Response>;
    archive?: () => Response | Promise<Response>;
    restore?: () => Response | Promise<Response>;
  } = {},
): World {
  const world: World = {
    name: NAME,
    description: "[E2E_TEST]説明",
    version: 3,
    detailRequests: 0,
    patches: [],
    archives: [],
    restores: [],
    reauths: 0,
  };
  server.use(
    http.get("/api/channels/:channelId", () => {
      world.detailRequests += 1;
      return HttpResponse.json({
        id: ID,
        roomId: ID,
        name: world.name,
        description: world.description,
        visibility: "public",
        departmentId: "01JTESTDEPT000000000000S01",
        isCaseChannel: false,
        caseId: null,
        joined: true,
        canPost: true,
        readOnly: false,
        memberCount: 1,
        members: [{ id: SHELL_USER.id, displayName: SHELL_USER.displayName }],
        version: world.version,
        manage: options.manage ?? ALL,
      });
    }),
    http.post("/api/auth/reauthenticate", () => {
      world.reauths += 1;
      return HttpResponse.json({ reauthenticatedAt: new Date().toISOString() });
    }),
    http.patch("/api/channels/:channelId", async ({ request }) => {
      const body = (await request.json()) as {
        name?: string;
        description?: string;
      };
      world.patches.push(body);
      if (options.patch) return options.patch();
      world.name = body.name ?? world.name;
      world.description = body.description ?? world.description;
      world.version += 1;
      return HttpResponse.json({
        id: ID,
        name: world.name,
        description: world.description,
        version: world.version,
        updatedAt: "2026-11-17T00:00:00.000Z",
      });
    }),
    http.post("/api/channels/:channelId/delete", async ({ request }) => {
      world.archives.push(await request.json());
      if (options.archive) return options.archive();
      world.version += 1;
      return HttpResponse.json({
        id: ID,
        version: world.version,
        deletedAt: "2026-11-17T00:00:00.000Z",
      });
    }),
    http.post("/api/channels/:channelId/restore", async ({ request }) => {
      world.restores.push(await request.json());
      if (options.restore) return options.restore();
      return HttpResponse.json({
        id: ID,
        version: 5,
        restoredAt: "2026-11-17T00:00:00.000Z",
      });
    }),
  );
  respondMessages([]);
  respondChannels([]);
  return world;
}

function CurrentPath() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

function DetailRoute() {
  return <ChannelDetailView channelId={ID} />;
}

function renderDetail() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[`/channels/${ID}`]}>
      <QueryClientProvider client={client}>
        <ReauthProvider>
          <Routes>
            <Route path="/channels/:channelId" element={<DetailRoute />} />
            <Route path="/channels" element={<ChannelsPage />} />
          </Routes>
          <CurrentPath />
        </ReauthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { user, client };
}

const currentPath = () => screen.getByTestId("path").textContent;
const menuButton = () => screen.findByRole("button", { name: MENU_BUTTON });

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await menuButton());
  return screen.findByRole("menu");
}

async function openEdit(user: ReturnType<typeof userEvent.setup>) {
  const menu = await openMenu(user);
  await user.click(
    within(menu).getByRole("menuitem", { name: "名前・説明を編集" }),
  );
  return screen.findByRole("dialog", { name: /編集/ });
}

async function openArchive(user: ReturnType<typeof userEvent.setup>) {
  const menu = await openMenu(user);
  await user.click(within(menu).getByRole("menuitem", { name: "アーカイブ" }));
  return screen.findByRole("dialog", { name: ARCHIVE_TITLE });
}

async function reauthenticate(user: ReturnType<typeof userEvent.setup>) {
  const reauth = await screen.findByRole("dialog", { name: "再認証" });
  await user.type(within(reauth).getByLabelText("パスワード"), TEST_PASSWORD);
  await user.click(within(reauth).getByRole("button", { name: "再認証" }));
}

/** 欄のエラーの文（aria-describedby が指す要素の文）をつなげて返す */
function describedText(input: HTMLElement): string {
  const ids = (input.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter((id) => id !== "");
  return ids
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

beforeEach(() => {
  respondShellUser();
});

describe("#143 a-AC-6（C-131）ヘッダーの「⋯」メニューの出し分け", () => {
  it("#143 a-AC-6: manage がすべて偽なら「⋯」を出さない", async () => {
    respondWorld({ manage: NONE });
    renderDetail();
    await screen.findByRole("heading", { name: NAME });
    expect(screen.queryByRole("button", { name: MENU_BUTTON })).toBeNull();
  });

  it("#143 a-AC-6: すべて真なら「名前・説明を編集」と「アーカイブ」の2つを、この順に出す", async () => {
    respondWorld({ manage: ALL });
    const { user } = renderDetail();
    const menu = await openMenu(user);
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent?.trim()),
    ).toEqual(["名前・説明を編集", "アーカイブ"]);
  });

  it("#143 a-AC-6（2-6 AC-5②④）: 説明だけ変えられる（部署の専用など）なら「名前・説明を編集」だけを出し、アーカイブは出さない", async () => {
    respondWorld({
      manage: { canRename: false, canEditDescription: true, canArchive: false },
    });
    const { user } = renderDetail();
    const menu = await openMenu(user);
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent?.trim()),
    ).toEqual(["名前・説明を編集"]);
  });

  it("#143 a-AC-6（screens S-39 のアクセシビリティ）: キーボード（Enter）で開き、Esc で閉じてフォーカスを「⋯」に戻す", async () => {
    respondWorld();
    const { user } = renderDetail();
    const button = await menuButton();
    button.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("menu")).toBeDefined();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(button);
  });

  it("#143 軽微1（ADR-0015・共通の部品への置き換えの後も）: 開くと先頭の項目にフォーカスし、↓・↑で項目を巡回し、Enter で選んだ項目のダイアログを開く", async () => {
    respondWorld();
    const { user } = renderDetail();
    const button = await menuButton();
    button.focus();
    await user.keyboard("{Enter}");
    const menu = await screen.findByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    expect(items).toHaveLength(2);
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(items[1]);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(items[0]);
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(items[1]);
    await user.keyboard("{Enter}");
    expect(
      await screen.findByRole("dialog", { name: ARCHIVE_TITLE }),
    ).toBeDefined();
  });
});

describe("#143 a-AC-1・a-AC-6 名前・説明の編集のダイアログ", () => {
  it("#143 a-AC-1: 名前と説明を変えて「保存」すると、読んだ版と一緒に1回だけ送り、閉じて、再読み込みなしで見出しが変わる。再認証は求めない", async () => {
    const world = respondWorld();
    const { user } = renderDetail();
    const dialog = await openEdit(user);
    const name = within(dialog).getByLabelText(/名前/);
    await user.clear(name);
    await user.type(name, "E2E_TEST_新しい名前");
    const description = within(dialog).getByLabelText(/説明/);
    await user.clear(description);
    await user.type(description, "新しい説明");
    await user.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(world.patches).toEqual([
        { version: 3, name: "E2E_TEST_新しい名前", description: "新しい説明" },
      ]),
    );
    expect(
      await screen.findByRole("heading", { name: "E2E_TEST_新しい名前" }),
    ).toBeDefined();
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /編集/ })).toBeNull(),
    );
    expect(world.reauths).toBe(0);
  });

  it("#143 a-AC-1（2-6 AC-5④）: 名前を変えられない（canRename が偽）なら、名前の欄を出さず、説明だけを送る", async () => {
    const world = respondWorld({
      manage: { canRename: false, canEditDescription: true, canArchive: false },
    });
    const { user } = renderDetail();
    const dialog = await openEdit(user);
    expect(within(dialog).queryByLabelText(/名前/)).toBeNull();
    const description = within(dialog).getByLabelText(/説明/);
    await user.clear(description);
    await user.type(description, "説明だけ");
    await user.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(world.patches).toEqual([{ version: 3, description: "説明だけ" }]),
    );
  });

  it.each([
    ["空", ""],
    ["51 文字", "あ".repeat(51)],
    ["使えない文字", "管理!"],
  ])(
    "#143 a-AC-1（2-2 AC-13）: 名前が%sなら、名前の欄にエラーを関連付け、送らない",
    async (_label, value) => {
      const world = respondWorld();
      const { user } = renderDetail();
      const dialog = await openEdit(user);
      const name = within(dialog).getByLabelText(/名前/);
      fireEvent.change(name, { target: { value } });
      await user.click(within(dialog).getByRole("button", { name: "保存" }));
      await waitFor(() =>
        expect(name.getAttribute("aria-invalid")).toBe("true"),
      );
      expect(describedText(name).trim()).not.toBe("");
      expect(world.patches).toEqual([]);
    },
  );

  it("#143 a-AC-1（2-2 AC-13）: 説明が 501 文字なら、説明の欄にエラーを関連付け、送らない", async () => {
    const world = respondWorld();
    const { user } = renderDetail();
    const dialog = await openEdit(user);
    const description = within(dialog).getByLabelText(/説明/);
    fireEvent.change(description, { target: { value: "あ".repeat(501) } });
    await user.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(description.getAttribute("aria-invalid")).toBe("true"),
    );
    expect(world.patches).toEqual([]);
  });

  it("#143 a-AC-1（422）: サーバーの 422 の fields に description があれば、説明の欄だけにエラーを出し、ダイアログを閉じない", async () => {
    respondWorld({
      patch: () =>
        HttpResponse.json(
          {
            code: "VALIDATION_ERROR",
            message: "入力内容を確かめてください",
            fields: ["description"],
          },
          { status: 422 },
        ),
    });
    const { user } = renderDetail();
    const dialog = await openEdit(user);
    await user.type(within(dialog).getByLabelText(/説明/), "追記");
    await user.click(within(dialog).getByRole("button", { name: "保存" }));
    const description = within(dialog).getByLabelText(/説明/);
    await waitFor(() =>
      expect(description.getAttribute("aria-invalid")).toBe("true"),
    );
    expect(
      within(dialog).getByLabelText(/名前/).getAttribute("aria-invalid"),
    ).not.toBe("true");
    expect(screen.getByRole("dialog", { name: /編集/ })).toBeDefined();
  });

  it("#143 a-AC-1（2-2 AC-13）: 名前の重複の 409 は、名前の欄に「同じ名前のチャンネルがあります」を関連付ける", async () => {
    respondWorld({
      patch: () =>
        HttpResponse.json(
          { code: "CONFLICT", message: DUPLICATE },
          { status: 409 },
        ),
    });
    const { user } = renderDetail();
    const dialog = await openEdit(user);
    const name = within(dialog).getByLabelText(/名前/);
    await user.clear(name);
    await user.type(name, "E2E_TEST_重複");
    await user.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(describedText(name)).toContain(DUPLICATE));
    expect(name.getAttribute("aria-invalid")).toBe("true");
  });

  it("#143 a-AC-6（二重送信の防止）: 送信中は「保存」を押せず、2回押しても1回だけ送る", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const world = respondWorld({
      patch: async () => {
        await held;
        return HttpResponse.json({
          id: ID,
          name: NAME,
          description: "x",
          version: 4,
          updatedAt: "2026-11-17T00:00:00.000Z",
        });
      },
    });
    const { user } = renderDetail();
    const dialog = await openEdit(user);
    await user.type(within(dialog).getByLabelText(/説明/), "追記");
    const save = within(dialog).getByRole("button", { name: "保存" });
    await user.click(save);
    await waitFor(() => expect(save).toHaveProperty("disabled", true));
    fireEvent.click(save);
    expect(world.patches).toHaveLength(1);
    release();
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /編集/ })).toBeNull(),
    );
    expect(world.patches).toHaveLength(1);
  });

  it("#143 a-AC-6（離れる前の確認）: 入力を変えている間は、ページを離れる前の確認（beforeunload）を出す。変えていなければ出さない", async () => {
    respondWorld();
    const { user } = renderDetail();
    const dialog = await openEdit(user);
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    await user.type(within(dialog).getByLabelText(/説明/), "変更");
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });
});

describe("#143 重大1（コードレビュー1回目）編集のダイアログの版の基準", () => {
  const STALE =
    "ほかの人が先に変更しました。最新の内容を読み込んでから、もう一度編集してください";
  const conflict = () =>
    HttpResponse.json(
      {
        code: "CONFLICT",
        message: "ほかの人が先に変更しました。読み込み直してください",
      },
      { status: 409 },
    );

  it("#143 重大1: ダイアログを開いた後に、詳細の再取得で版が進んでも、保存は開いた時点の版で送る", async () => {
    const world = respondWorld();
    const { user, client } = renderDetail();
    const dialog = await openEdit(user);
    const before = world.detailRequests;
    world.version = 4;
    await client.invalidateQueries();
    await waitFor(() => expect(world.detailRequests).toBeGreaterThan(before));
    await user.type(within(dialog).getByLabelText(/説明/), "追記");
    await user.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(world.patches).toHaveLength(1));
    expect(world.patches[0]).toMatchObject({ version: 3 });
  });

  it("#143 重大1: 版の 409 の後は、入力を保ったまま文言と「最新の内容を読み込む」を出し、もう一度「保存」を押しても送らない", async () => {
    const world = respondWorld({ patch: conflict });
    const { user } = renderDetail();
    const dialog = await openEdit(user);
    const description = within(dialog).getByLabelText(/説明/);
    await user.type(description, "追記");
    await user.click(within(dialog).getByRole("button", { name: "保存" }));
    expect(await within(dialog).findByText(STALE)).toBeDefined();
    expect(
      within(dialog).getByRole("button", { name: "最新の内容を読み込む" }),
    ).toBeDefined();
    expect((description as HTMLTextAreaElement).value).toBe(
      "[E2E_TEST]説明追記",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(world.detailRequests).toBeGreaterThan(0));
    expect(world.patches).toHaveLength(1);
  });

  it("#143 重大1: 「最新の内容を読み込む」で、欄が最新の名前・説明になり、その後の保存は新しい版で送る", async () => {
    // 1回目だけ 409。その間に、ほかの人が名前・説明・版を変えている
    const world: World = respondWorld({
      patch: () => {
        if (world.patches.length === 1) {
          world.name = "E2E_TEST_他人の名前";
          world.description = "他人の説明";
          world.version = 5;
          return conflict();
        }
        return HttpResponse.json({
          id: ID,
          name: world.name,
          description: "自分の説明",
          version: 6,
          updatedAt: "2026-11-17T00:00:00.000Z",
        });
      },
    });
    const { user } = renderDetail();
    const dialog = await openEdit(user);
    await user.type(within(dialog).getByLabelText(/説明/), "追記");
    await user.click(within(dialog).getByRole("button", { name: "保存" }));
    await user.click(
      await within(dialog).findByRole("button", {
        name: "最新の内容を読み込む",
      }),
    );
    const name = within(dialog).getByLabelText(/名前/) as HTMLInputElement;
    const description = within(dialog).getByLabelText(
      /説明/,
    ) as HTMLTextAreaElement;
    await waitFor(() => expect(name.value).toBe("E2E_TEST_他人の名前"));
    expect(description.value).toBe("他人の説明");
    await user.clear(description);
    await user.type(description, "自分の説明");
    await user.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(world.patches).toHaveLength(2));
    expect(world.patches[1]).toMatchObject({
      version: 5,
      description: "自分の説明",
    });
  });
});

describe("#143 a-AC-2・a-AC-6 アーカイブのダイアログ", () => {
  it("#143 a-AC-2（2-6 AC-6）: 理由を入れて「アーカイブ」→ 再認証すると、版と理由を1回送り、/channels へ移って「アーカイブしました」を出す", async () => {
    const world = respondWorld();
    const { user } = renderDetail();
    const dialog = await openArchive(user);
    await user.type(within(dialog).getByLabelText(/理由/), "統合のため");
    expect(world.reauths).toBe(0);
    await user.click(
      within(dialog).getByRole("button", { name: "アーカイブ" }),
    );
    await reauthenticate(user);
    await waitFor(() =>
      expect(world.archives).toEqual([{ version: 3, reason: "統合のため" }]),
    );
    await waitFor(() => expect(currentPath()).toBe("/channels"));
    expect(await screen.findByText("アーカイブしました")).toBeDefined();
  });

  it("#143 a-AC-2（2-6 AC-6）: 再認証をやめたら、アーカイブを送らない", async () => {
    const world = respondWorld();
    const { user } = renderDetail();
    const dialog = await openArchive(user);
    await user.click(
      within(dialog).getByRole("button", { name: "アーカイブ" }),
    );
    const reauth = await screen.findByRole("dialog", { name: "再認証" });
    await user.click(
      within(reauth).getByRole("button", { name: "キャンセル" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "再認証" })).toBeNull(),
    );
    expect(world.archives).toEqual([]);
    expect(currentPath()).toBe(`/channels/${ID}`);
  });

  it("#143 a-AC-2（V-48）: 理由の残りの文字数を出し、501 文字では欄にエラーを関連付けて送らない", async () => {
    const world = respondWorld();
    const { user } = renderDetail();
    const dialog = await openArchive(user);
    const reason = within(dialog).getByLabelText(/理由/);
    expect(dialog.textContent).toContain("500");
    await user.type(reason, "あいうえお");
    expect(dialog.textContent).toContain("495");
    fireEvent.change(reason, { target: { value: "あ".repeat(501) } });
    await user.click(
      within(dialog).getByRole("button", { name: "アーカイブ" }),
    );
    await waitFor(() =>
      expect(reason.getAttribute("aria-invalid")).toBe("true"),
    );
    expect(world.reauths).toBe(0);
    expect(world.archives).toEqual([]);
  });

  it("#143 a-AC-2: 409 は「この項目はすでに処理されています」を出し、チャンネルの詳細を取り直す。移動しない", async () => {
    const world = respondWorld({
      archive: () =>
        HttpResponse.json(
          { code: "CONFLICT", message: ALREADY },
          { status: 409 },
        ),
    });
    const { user } = renderDetail();
    const dialog = await openArchive(user);
    const before = world.detailRequests;
    await user.click(
      within(dialog).getByRole("button", { name: "アーカイブ" }),
    );
    await reauthenticate(user);
    expect((await screen.findByRole("alert")).textContent).toContain(ALREADY);
    await waitFor(() => expect(world.detailRequests).toBeGreaterThan(before));
    expect(currentPath()).toBe(`/channels/${ID}`);
  });

  it("#143 a-AC-6（screens S-39 のアクセシビリティ）: 閉じたらフォーカスを「⋯」に戻す", async () => {
    respondWorld();
    const { user } = renderDetail();
    const dialog = await openArchive(user);
    await user.click(
      within(dialog).getByRole("button", { name: "キャンセル" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: ARCHIVE_TITLE })).toBeNull(),
    );
    expect(document.activeElement).toBe(await menuButton());
  });

  it("#143 a-AC-6（二重送信の防止）: 送信中は「アーカイブ」を押せない", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const world = respondWorld({
      archive: async () => {
        await held;
        await delay(0);
        return HttpResponse.json({
          id: ID,
          version: 4,
          deletedAt: "2026-11-17T00:00:00.000Z",
        });
      },
    });
    const { user } = renderDetail();
    const dialog = await openArchive(user);
    const button = within(dialog).getByRole("button", { name: "アーカイブ" });
    await user.click(button);
    await reauthenticate(user);
    await waitFor(() => expect(world.archives).toHaveLength(1));
    await waitFor(() => expect(button).toHaveProperty("disabled", true));
    fireEvent.click(button);
    release();
    await waitFor(() => expect(currentPath()).toBe("/channels"));
    expect(world.archives).toHaveLength(1);
  });
});

describe("#143 a-AC-3 復元のダイアログ（S-39・S-38 が使う共通の部品）", () => {
  function renderRestore() {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const user = userEvent.setup();
    const closed: string[] = [];
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ReauthProvider>
            <ChannelRestoreDialog
              channelId={ID}
              channelName={NAME}
              version={4}
              onClose={() => closed.push("closed")}
            />
          </ReauthProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    return { user, closed };
  }

  it("#143 a-AC-3（2-6 AC-6）: 確認で「復元」→ 再認証すると、版を1回送る", async () => {
    const world = respondWorld();
    const { user } = renderRestore();
    const dialog = await screen.findByRole("dialog", { name: /復元/ });
    expect(dialog.textContent).toContain(NAME);
    await user.click(within(dialog).getByRole("button", { name: "復元" }));
    await reauthenticate(user);
    await waitFor(() => expect(world.restores).toEqual([{ version: 4 }]));
  });

  it("#143 a-AC-3: 409 は文を role=alert に出す", async () => {
    respondWorld({
      restore: () =>
        HttpResponse.json(
          { code: "CONFLICT", message: ALREADY },
          { status: 409 },
        ),
    });
    const { user } = renderRestore();
    const dialog = await screen.findByRole("dialog", { name: /復元/ });
    await user.click(within(dialog).getByRole("button", { name: "復元" }));
    await reauthenticate(user);
    expect((await screen.findByRole("alert")).textContent).toContain(ALREADY);
  });
});

/** 詳細（GET /api/channels/:id）の応答の本文（respondWorld と同じ形） */
function detailBody(fields: {
  name: string;
  description: string;
  version: number;
}) {
  return {
    id: ID,
    roomId: ID,
    name: fields.name,
    description: fields.description,
    visibility: "public",
    departmentId: "01JTESTDEPT000000000000S01",
    isCaseChannel: false,
    caseId: null,
    joined: true,
    canPost: true,
    readOnly: false,
    memberCount: 1,
    members: [{ id: SHELL_USER.id, displayName: SHELL_USER.displayName }],
    version: fields.version,
    manage: ALL,
  };
}

const versionConflict = () =>
  HttpResponse.json(
    {
      code: "CONFLICT",
      message: "ほかの人が先に変更しました。読み込み直してください",
    },
    { status: 409 },
  );

/** 版の 409 を起こして「最新の内容を読み込む」を出したダイアログを返す（説明に「追記」を足した状態） */
async function staleDialog(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await openEdit(user);
  await user.type(within(dialog).getByLabelText(/説明/), "追記");
  await user.click(within(dialog).getByRole("button", { name: "保存" }));
  await within(dialog).findByRole("button", { name: "最新の内容を読み込む" });
  return dialog;
}

describe("#290（#143-b b-AC-4・F9）「最新の内容を読み込む」の応答を待つ間の入力", () => {
  it("#290 AC-1（#143-b b-AC-4）: 応答を保留している間は、名前・説明の欄と「保存」が無効で、入力しても値が変わらない。応答の後は最新の内容が入り、有効に戻り、保存は新しい版で送る", async () => {
    let patchCount = 0;
    const world: World = respondWorld({
      patch: () => {
        patchCount += 1;
        if (patchCount === 1) return versionConflict();
        return HttpResponse.json({
          id: ID,
          name: "E2E_TEST_最新の名前",
          description: "自分の説明",
          version: 8,
          updatedAt: "2026-11-17T00:00:00.000Z",
        });
      },
    });
    const { user } = renderDetail();
    const dialog = await staleDialog(user);
    let releaseLatest: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseLatest = resolve;
    });
    server.use(
      http.get("/api/channels/:channelId", async () => {
        await gate;
        return HttpResponse.json(
          detailBody({
            name: "E2E_TEST_最新の名前",
            description: "最新の説明",
            version: 7,
          }),
        );
      }),
    );
    const name = within(dialog).getByLabelText(/名前/) as HTMLInputElement;
    const description = within(dialog).getByLabelText(
      /説明/,
    ) as HTMLTextAreaElement;
    const save = within(dialog).getByRole("button", { name: "保存" });
    await user.click(
      within(dialog).getByRole("button", { name: "最新の内容を読み込む" }),
    );
    await waitFor(() => expect(description.disabled).toBe(true));
    expect(name.disabled).toBe(true);
    expect(save).toHaveProperty("disabled", true);
    await user.type(description, "失われる入力");
    expect(description.value).toBe("[E2E_TEST]説明追記");
    releaseLatest();
    await waitFor(() => expect(description.value).toBe("最新の説明"));
    expect(name.value).toBe("E2E_TEST_最新の名前");
    await waitFor(() => expect(description.disabled).toBe(false));
    expect(name.disabled).toBe(false);
    expect(save).toHaveProperty("disabled", false);
    await user.clear(description);
    await user.type(description, "自分の説明");
    await user.click(save);
    await waitFor(() => expect(world.patches).toHaveLength(2));
    expect(world.patches[1]).toMatchObject({
      version: 7,
      description: "自分の説明",
    });
  });
});

describe("#143-b b-AC-5（F10。C-181 (9) の見直し）成功の後に取り直すキー", () => {
  /** invalidateQueries に渡されたキーの先頭の部分 */
  function invalidatedRoots(calls: readonly unknown[][]) {
    return new Set(
      calls.map(
        (call) =>
          ((call[0] as { queryKey?: readonly unknown[] } | undefined)
            ?.queryKey ?? [])[0],
      ),
    );
  }

  it("#143-b b-AC-5（F10）: アーカイブの成功で、channels に加えて unread・threads・notifications を取り直す", async () => {
    respondWorld();
    const { user, client } = renderDetail();
    const spy = vi.spyOn(client, "invalidateQueries");
    const dialog = await openArchive(user);
    // S-05 を開いたときの既読の送信も unread を取り直すため、操作を始めた後の呼び出しだけを数える
    const start = spy.mock.calls.length;
    await user.click(
      within(dialog).getByRole("button", { name: "アーカイブ" }),
    );
    await reauthenticate(user);
    await waitFor(() => expect(currentPath()).toBe("/channels"));
    const roots = invalidatedRoots(spy.mock.calls.slice(start));
    for (const root of ["channels", "unread", "threads", "notifications"])
      expect(roots.has(root), root).toBe(true);
  });

  it("#143-b b-AC-5（F10）: 名前・説明の変更の成功では、channels だけを取り直し、unread・threads・notifications は取り直さない", async () => {
    const world = respondWorld();
    const { user, client } = renderDetail();
    const spy = vi.spyOn(client, "invalidateQueries");
    const dialog = await openEdit(user);
    await user.type(within(dialog).getByLabelText(/説明/), "追記");
    const start = spy.mock.calls.length;
    await user.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(world.patches).toHaveLength(1));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /編集/ })).toBeNull(),
    );
    const roots = invalidatedRoots(spy.mock.calls.slice(start));
    expect(roots.has("channels")).toBe(true);
    for (const root of ["unread", "threads", "notifications"])
      expect(roots.has(root), root).toBe(false);
  });

  it("#143-b b-AC-5（F10）: 復元の成功で、channels に加えて unread・threads・notifications を取り直す", async () => {
    const world = respondWorld();
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const spy = vi.spyOn(client, "invalidateQueries");
    const user = userEvent.setup();
    const restored: string[] = [];
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ReauthProvider>
            <ChannelRestoreDialog
              channelId={ID}
              channelName={NAME}
              version={4}
              onClose={() => undefined}
              onRestored={() => restored.push("restored")}
            />
          </ReauthProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    const dialog = await screen.findByRole("dialog", { name: /復元/ });
    await user.click(within(dialog).getByRole("button", { name: "復元" }));
    await reauthenticate(user);
    await waitFor(() => expect(world.restores).toHaveLength(1));
    await waitFor(() => expect(restored).toEqual(["restored"]));
    const roots = invalidatedRoots(spy.mock.calls);
    for (const root of ["channels", "unread", "threads", "notifications"])
      expect(roots.has(root), root).toBe(true);
  });
});

describe("#143-b F11 S-05 の「⋯」の動きが変わらない（回帰）", () => {
  it("#143-b F11: S-05 の編集の「最新の内容を読み込む」は詳細の API を使い、管理者用の1件の API（/api/admin/channels/:id）を呼ばない。復元の項目は出ない", async () => {
    let adminCalls = 0;
    server.use(
      http.get("/api/admin/channels/:channelId", () => {
        adminCalls += 1;
        return HttpResponse.json(
          { code: "FORBIDDEN", message: "この操作を行う権限がありません" },
          { status: 403 },
        );
      }),
    );
    const world = respondWorld({ patch: versionConflict });
    const { user } = renderDetail();
    const menu = await openMenu(user);
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent?.trim()),
    ).not.toContain("復元");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    const dialog = await staleDialog(user);
    const before = world.detailRequests;
    await user.click(
      within(dialog).getByRole("button", { name: "最新の内容を読み込む" }),
    );
    await waitFor(() => expect(world.detailRequests).toBeGreaterThan(before));
    expect(adminCalls).toBe(0);
  });
});
