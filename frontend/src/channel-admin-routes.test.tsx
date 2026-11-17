// #143-b b-AC-1〜b-AC-3（2-6 AC-5①・AC-6、S-38・S-39、C-124）: /channel-management（S-39）と /archive（S-38）の入口とガードを、App を通して確かめる
// （計画 #143-b 8.2 の F7 と、F3 (c)）。表示の制御であり、認可はサーバー（API）が行う。
// 契約：
//   /channel-management は perm.channel.edit、/archive は perm.channel.delete を持つ人だけが画面（h1「チャンネル管理」「アーカイブ」）を開ける。
//   持たない人は「ページが見つかりません」で、一覧の API を呼ばない。セッションの確認中は誤って拒否せず「確認中です」を出す。
//   サイドバー：管理メニューの「部署」に「チャンネル管理」、管理メニューの外（details の外）に独立の「アーカイブ」。
//   F3 (c)：アーカイブの成功の後、一覧を先に返して行が消え、別の再取得（未読）を保留・解除した後にも、完了の表示が届く。
// データは架空（testuser_001・E2E_TEST_）。
import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SHELL_USER,
  installDomStubs,
  renderApp,
  type DomStubs,
} from "./test/app-shell-harness";
import { TEST_PASSWORD } from "./test/auth-handlers";
import {
  CHANNEL_DELETE_PERMISSION,
  CHANNEL_EDIT_PERMISSION,
  adminChannel,
  adminChannelId,
  adminChannelName,
  archivedItem,
  deferred,
  respondAdminChannels,
  respondArchivedItems,
  respondChannelAdminSession,
  respondManageWrites,
} from "./test/channel-admin-handlers";
import { server } from "./test/server";

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
});
afterEach(() => {
  stubs.restore();
});

const BOTH = [CHANNEL_EDIT_PERMISSION, CHANNEL_DELETE_PERMISSION];

async function mainArea() {
  await screen.findAllByRole("navigation", { name: "メインメニュー" });
  return screen.getByRole("main");
}

describe("#143-b b-AC-3 直接アクセスのガード（F7）", () => {
  it.each([
    ["/channel-management", "チャンネル管理"],
    ["/archive", "アーカイブ"],
  ])(
    "#143-b b-AC-3（F7）: %s はセッションの確認中は「確認中です」を出し、権限が確定したら画面を出す",
    async (path, heading) => {
      const gate = deferred();
      server.use(
        http.get("/api/auth/session", async () => {
          await gate.promise;
          return HttpResponse.json({
            user: SHELL_USER,
            permissions: BOTH,
            mustChangePassword: false,
            reauthenticatedAt: null,
          });
        }),
      );
      respondAdminChannels(() => ({ items: [], nextCursor: null }));
      respondArchivedItems(() => ({ items: [], nextCursor: null }));
      renderApp(path);
      expect(await screen.findByText("確認中です")).toBeTruthy();
      expect(
        screen.queryByRole("heading", { name: "ページが見つかりません" }),
      ).toBeNull();
      gate.release();
      expect(
        await screen.findByRole("heading", { level: 1, name: heading }),
      ).toBeTruthy();
    },
  );

  it.each([
    ["一般メンバー（権限なし）", "/channel-management", []],
    ["一般メンバー（権限なし）", "/archive", []],
    [
      "アーカイブの権限だけ",
      "/channel-management",
      [CHANNEL_DELETE_PERMISSION],
    ],
    ["チャンネル管理の権限だけ", "/archive", [CHANNEL_EDIT_PERMISSION]],
    [
      "ほかの管理権限だけ",
      "/channel-management",
      ["perm.workspace.manage", "perm.channel.request.approve.owner"],
    ],
  ])(
    "#143-b b-AC-3（2-6 AC-5①・F7）: %s は、%s を直接開いても「ページが見つかりません」で、一覧の API を呼ばない",
    async (_label, path, permissions) => {
      respondChannelAdminSession(permissions);
      const listCalls = respondAdminChannels(() => ({
        items: [],
        nextCursor: null,
      }));
      const archivedCalls = respondArchivedItems(() => ({
        items: [],
        nextCursor: null,
      }));
      renderApp(path);
      expect(
        await screen.findByRole("heading", { name: "ページが見つかりません" }),
      ).toBeTruthy();
      expect(listCalls).toHaveLength(0);
      expect(archivedCalls).toHaveLength(0);
    },
  );
});

describe("#143-b b-AC-1・b-AC-2 サイドバーの入口（F7）", () => {
  it("#143-b b-AC-1（D-6）・b-AC-2（C-124）: 権限のある人には、管理メニューの中に「チャンネル管理」、管理メニューの外に「アーカイブ」が出る", async () => {
    respondChannelAdminSession(BOTH);
    renderApp("/");
    await waitFor(() =>
      expect(
        screen.getAllByRole("link", { name: "チャンネル管理" }).length,
      ).toBeGreaterThan(0),
    );
    const manage = screen.getAllByRole("link", { name: "チャンネル管理" });
    for (const link of manage) {
      expect(link.getAttribute("href")).toBe("/channel-management");
      expect(link.closest("details")).not.toBeNull();
    }
    const archive = screen.getAllByRole("link", { name: "アーカイブ" });
    expect(archive.length).toBeGreaterThan(0);
    for (const link of archive) {
      expect(link.getAttribute("href")).toBe("/archive");
      expect(link.closest("details")).toBeNull();
    }
  });

  it("#143-b b-AC-3: 権限のない人には、どちらの入口も出ない", async () => {
    respondChannelAdminSession([]);
    renderApp("/");
    await waitFor(() =>
      expect(
        screen.queryAllByRole("link", { name: "チャンネルを探す" }).length,
      ).toBeGreaterThan(0),
    );
    expect(screen.queryByRole("link", { name: "チャンネル管理" })).toBeNull();
    expect(screen.queryByRole("link", { name: "アーカイブ" })).toBeNull();
  });

  it("#143-b b-AC-2: サイドバーの「アーカイブ」から S-38 を開ける", async () => {
    respondChannelAdminSession(BOTH);
    respondArchivedItems(() => ({
      items: [archivedItem(1)],
      nextCursor: null,
    }));
    const { user } = renderApp("/");
    const links = await screen.findAllByRole("link", { name: "アーカイブ" });
    const first = links[0];
    if (first === undefined) throw new Error("リンクがありません");
    await user.click(first);
    expect(
      await screen.findByRole("heading", { level: 1, name: "アーカイブ" }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toBe("/archive"),
    );
  });
});

describe("#143-b b-AC-1 完了の表示と、ほかの再取得の保留（F3 (c)）", () => {
  it("#143-b b-AC-1（F3 (c)）: アーカイブの後、一覧を先に返して行が消え、未読の再取得を保留・解除した後にも、完了の文が届く", async () => {
    respondChannelAdminSession(BOTH);
    let archived = false;
    const gate = deferred();
    let heldUnread = 0;
    respondAdminChannels(() => ({
      items: archived ? [adminChannel(2)] : [adminChannel(1), adminChannel(2)],
      nextCursor: null,
    }));
    server.use(
      http.get("/api/me/unread", async () => {
        if (archived) {
          heldUnread += 1;
          await gate.promise;
        }
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    respondManageWrites({
      archive: () => {
        archived = true;
        return HttpResponse.json({
          id: adminChannelId(1),
          version: 4,
          deletedAt: "2026-11-17T00:00:00.000Z",
        });
      },
    });
    const { user } = renderApp("/channel-management");
    const main = await mainArea();
    const name = adminChannelName(1);
    const rowOf = () =>
      within(main)
        .queryAllByRole("row")
        .find((row) => row.textContent?.includes(name));
    await waitFor(() => expect(rowOf()).toBeDefined());
    const row = rowOf();
    if (row === undefined) throw new Error("行がありません");
    await user.click(
      within(row).getByRole("button", { name: `${name}の操作` }),
    );
    const menu = await screen.findByRole("menu");
    await user.click(
      within(menu).getByRole("menuitem", { name: "アーカイブ" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: `チャンネル「${name}」をアーカイブしますか`,
    });
    await user.click(
      within(dialog).getByRole("button", { name: "アーカイブ" }),
    );
    const reauth = await screen.findByRole("dialog", { name: "再認証" });
    await user.type(within(reauth).getByLabelText("パスワード"), TEST_PASSWORD);
    await user.click(within(reauth).getByRole("button", { name: "再認証" }));

    // 一覧は先に返って行が消える。未読の再取得は保留されている
    await waitFor(() => expect(rowOf()).toBeUndefined());
    await waitFor(() => expect(heldUnread).toBeGreaterThan(0));

    gate.release();
    expect(
      await within(main).findByText(
        `チャンネル「${name}」をアーカイブしました`,
      ),
    ).toBeTruthy();
    expect(rowOf()).toBeUndefined();
    expect(screen.getByTestId("path").textContent).toBe("/channel-management");
  });
});
