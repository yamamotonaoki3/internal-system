// #136 AC-1（1-2 AC-1・AC-4・AC-5）: /dms・/dms/new・/dms/:roomId のルートと、サイドバー（DM の欄）・下部メニュー（DM）からの入口。
// App を通して描画する（枠 AppShell のサイドバー・下部メニューを含む）。API は MSW で返す。データはすべて架空。
// 契約（実装前の仮置き。引き継ぎに明記）：
//  - /dms は DM の一覧（h1「ダイレクトメッセージ」）、/dms/new は相手の選択（h1「新しいDM」）、/dms/:roomId は DM の画面（S-06。DmView）
//  - サイドバー（nav「メインメニュー」）に DM の欄（DmSection）を、参加中のチャンネルの欄の直後に置く（「参加中のチャンネル」→「ダイレクトメッセージ」→ 固定リンク）
//  - DM の欄の取得に失敗しても、枠全体は壊さず、欄の中に role=alert を出す
//  - 下部メニューの「DM」は /dms。/dms にいる間は aria-current="page"
import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installDomStubs,
  renderApp,
  respondShellUser,
  type DomStubs,
} from "./test/app-shell-harness";
import {
  dmDetail,
  dmItem,
  dmRoomId,
  partnerName,
  respondDms,
} from "./test/dm-handlers";
import { respondChannels, channelItem } from "./test/channel-handlers";
import { respondMessages } from "./test/message-handlers";
import { respondProfileWorld } from "./test/profile-handlers";
import { server } from "./test/server";

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
  respondShellUser();
});
afterEach(() => {
  stubs.restore();
});

const menu = () => screen.findByRole("navigation", { name: "メインメニュー" });
const path = () => screen.getByTestId("path").textContent;

describe("#136 AC-1（1-2 AC-1・AC-5）ルート", () => {
  it("#136 AC-1（1-2 AC-5）: /dms は DM の一覧を出す", async () => {
    respondDms({ items: [dmItem(1)] });
    renderApp("/dms");
    await screen.findByRole("heading", {
      level: 1,
      name: "ダイレクトメッセージ",
    });
    const main = screen.getByRole("main");
    const link = await within(main).findByRole("link", {
      name: partnerName(1),
    });
    expect(link.getAttribute("href")).toBe(`/dms/${dmRoomId(1)}`);
  });

  it("#136 AC-1（1-2 AC-5）: /dms/new は相手の選択を出す", async () => {
    respondProfileWorld({ members: [] });
    renderApp("/dms/new");
    await screen.findByRole("heading", { level: 1, name: "新しいDM" });
    expect(
      within(screen.getByRole("main")).getByLabelText("表示名で検索"),
    ).toBeDefined();
  });

  it("#136 AC-1（1-2 AC-1）: /dms/:roomId は、その DM（S-06）の相手と入力欄を出す", async () => {
    respondDms({ items: [dmItem(1)], details: [dmDetail(1)] });
    respondMessages([]);
    renderApp(`/dms/${dmRoomId(1)}`);
    // ログイン状態の確認中の枠にも main があるため、入力欄が出てから main を取る
    await screen.findByRole("textbox", { name: "メッセージ" });
    const main = screen.getByRole("main");
    expect(
      within(main).getByRole("textbox", { name: "メッセージ" }),
    ).toBeDefined();
    expect(
      await within(main).findByRole("button", {
        name: new RegExp(partnerName(1)),
      }),
    ).toBeDefined();
  });

  it("#136 AC-1（1-2 AC-2）: /dms/:roomId が当事者でない（404）なら「見つかりません」を出す", async () => {
    const world = respondDms({ details: [] });
    renderApp(`/dms/${dmRoomId(9)}`);
    // ルートが無いための「見つかりません」と区別するため、DM の詳細を取りに行ったことを確かめる
    await waitFor(() => expect(world.detailRequests).toContain(dmRoomId(9)));
    await screen.findByText(/見つかりません/);
    expect(
      within(screen.getByRole("main")).getByText(/見つかりません/),
    ).toBeDefined();
    expect(screen.queryByRole("textbox", { name: "メッセージ" })).toBeNull();
  });
});

describe("#136 AC-1（1-2 AC-5）サイドバーの DM の欄", () => {
  it("#136 AC-1（1-2 AC-5）: DM の欄は参加中のチャンネルの直後にあり、DM のリンクと「新しいDM」を出す", async () => {
    respondChannels([channelItem("1", { name: "全社連絡", joined: true })]);
    respondDms({ items: [dmItem(1)] });
    renderApp("/");
    const nav = await menu();
    await within(nav).findByRole("link", { name: "全社連絡" });
    const dm = await within(nav).findByRole("link", { name: partnerName(1) });
    expect(dm.getAttribute("href")).toBe(`/dms/${dmRoomId(1)}`);
    const text = nav.textContent ?? "";
    const channelsAt = text.indexOf("参加中のチャンネル");
    const dmsAt = text.indexOf("ダイレクトメッセージ");
    const exploreAt = text.indexOf("チャンネルを探す");
    expect(channelsAt).toBeGreaterThanOrEqual(0);
    expect(dmsAt).toBeGreaterThan(channelsAt);
    expect(exploreAt).toBeGreaterThan(dmsAt);
  });

  it("#136 AC-1（1-2 AC-5）: サイドバーの「新しいDM」から /dms/new（相手の選択）へ進める", async () => {
    respondProfileWorld({ members: [] });
    respondDms({ items: [] });
    const { user } = renderApp("/");
    const nav = await menu();
    await user.click(
      await within(nav).findByRole("link", { name: /新しいDM/ }),
    );
    await waitFor(() => expect(path()).toBe("/dms/new"));
    await screen.findByRole("heading", { level: 1, name: "新しいDM" });
  });

  it("#136 AC-1（1-2 AC-5）: DM の欄の取得に失敗しても、枠全体は壊さず、欄の中に role=alert を出す", async () => {
    server.use(
      http.get("/api/dms", () =>
        HttpResponse.json(
          { code: "INTERNAL", message: "一時的なエラーが発生しました" },
          { status: 500 },
        ),
      ),
    );
    renderApp("/");
    const nav = await menu();
    expect((await within(nav).findByRole("alert")).textContent).toContain(
      "一時的なエラーが発生しました",
    );
    expect(
      within(nav).getByRole("link", { name: "チャンネルを探す" }),
    ).toBeDefined();
    await screen.findByRole("heading", { level: 1, name: "ホーム" });
  });
});

describe("#136 AC-1（1-2 AC-4）下部メニューの DM", () => {
  it("#136 AC-1（1-2 AC-4）: 下部メニューの「DM」から /dms へ進み、そのリンクが現在地（aria-current）になる", async () => {
    respondDms({ items: [dmItem(1)], details: [dmDetail(1)] });
    respondMessages([]);
    const { user } = renderApp("/");
    const bottom = await screen.findByRole("navigation", {
      name: "下部メニュー",
    });
    await user.click(within(bottom).getByRole("link", { name: "DM" }));
    await waitFor(() => expect(path()).toBe("/dms"));
    await waitFor(() =>
      expect(
        within(bottom)
          .getByRole("link", { name: "DM" })
          .getAttribute("aria-current"),
      ).toBe("page"),
    );
  });
});
