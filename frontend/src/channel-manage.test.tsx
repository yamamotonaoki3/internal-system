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
import { beforeEach, describe, expect, it } from "vitest";
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
  return { user };
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
