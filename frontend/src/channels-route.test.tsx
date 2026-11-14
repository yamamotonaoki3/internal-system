// #200 AC-4（2-3 AC-1・AC-2、画面 S-09・サイドバー）: /channels・/channels/:channelId の経路と、サイドバーの「参加中のチャンネル」。
// App を通して描画する（枠 AppShell のサイドバーを含む）。API は MSW で返す。データはすべて架空。
// 契約（実装前。引き継ぎに明記）：
//  - サイドバー（nav「メインメニュー」）に、固定リンク「チャンネルを探す」（/channels）と、参加中のチャンネルのリンク（/channels/:id）を出す
//  - 参加中の取得は GET /api/channels?joined=true。失敗すると nav の中に role=alert を出し、枠全体は壊さない
//  - /channels/:channelId はチャンネルの名前を見出し（h1）に出す。見つからない（404）ときは「見つかりません」を出す
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
  DEPT_SALES,
  channelItem,
  respondChannels,
} from "./test/channel-handlers";
import { server } from "./test/server";

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
  respondShellUser();
});
afterEach(() => {
  stubs.restore();
});

const general = channelItem("1", { name: "全社連絡", joined: true });
const sales = channelItem("2", {
  name: "[E2E_TEST]営業部",
  departmentId: DEPT_SALES.id,
  departmentName: DEPT_SALES.name,
});

// 枠はセッションの確認の後に出るため、出るまで待つ
const menu = () => screen.findByRole("navigation", { name: "メインメニュー" });

describe("#200 AC-4 サイドバー", () => {
  it("#200 AC-4: 固定リンク「チャンネルを探す」（/channels）がある", async () => {
    respondChannels([]);
    renderApp("/");
    await screen.findByRole("navigation", { name: "メインメニュー" });
    const link = await within(await menu()).findByRole("link", {
      name: "チャンネルを探す",
    });
    expect(link.getAttribute("href")).toBe("/channels");
  });

  it("#200 AC-4: 参加中のチャンネルだけをリンクで出す（未参加は出さない）", async () => {
    const recorded = respondChannels([general, sales]);
    renderApp("/");
    const link = await within(await menu()).findByRole("link", {
      name: "全社連絡",
    });
    expect(link.getAttribute("href")).toBe(`/channels/${general.id}`);
    expect(
      within(await menu()).queryByRole("link", { name: "[E2E_TEST]営業部" }),
    ).toBeNull();
    expect(
      recorded.listRequests.every(
        (url) => url.searchParams.get("joined") === "true",
      ),
    ).toBe(true);
  });

  it("#200 AC-4: 参加中の取得に失敗しても、枠（メニュー）は出て、nav の中に role=alert を出す", async () => {
    server.use(
      http.get("/api/channels", () =>
        HttpResponse.json(
          { code: "INTERNAL", message: "エラーが発生しました" },
          { status: 500 },
        ),
      ),
    );
    renderApp("/");
    const alert = await within(await menu()).findByRole("alert");
    expect(alert.textContent).toContain("エラーが発生しました");
    expect(
      within(await menu()).getByRole("link", { name: "チャンネルを探す" }),
    ).toBeTruthy();
  });
});

describe("#200 AC-4 /channels", () => {
  it("#200 AC-4: /channels で S-09 が開き、参加すると同じ画面のサイドバーに参加したチャンネルが出る", async () => {
    const recorded = respondChannels([general, sales]);
    const { user } = renderApp("/channels");
    expect(
      await screen.findByRole("heading", { name: "チャンネルを探す" }),
    ).toBeTruthy();
    // 参加前：サイドバーに営業部は出ない
    await within(await menu()).findByRole("link", { name: "全社連絡" });
    expect(
      within(await menu()).queryByRole("link", { name: "[E2E_TEST]営業部" }),
    ).toBeNull();

    const main = screen.getByRole("main");
    const button = await within(main).findByRole("button", {
      name: (n) => n.includes("[E2E_TEST]営業部") && n.includes("参加"),
    });
    await user.click(button);
    await waitFor(() => expect(recorded.joinRequests).toEqual([sales.id]));
    // 参加後：サイドバーに出る（一覧とサイドバーの両方を取り直す）
    const sidebarLink = await within(await menu()).findByRole("link", {
      name: "[E2E_TEST]営業部",
    });
    expect(sidebarLink.getAttribute("href")).toBe(`/channels/${sales.id}`);
  });

  it("#200 AC-4: 現在のページ（チャンネルを探す）のリンクに aria-current=page が付く", async () => {
    respondChannels([]);
    renderApp("/channels");
    const link = await within(await menu()).findByRole("link", {
      name: "チャンネルを探す",
    });
    expect(link.getAttribute("aria-current")).toBe("page");
  });
});

describe("#200 AC-2 /channels/:channelId", () => {
  it("#200 AC-2: チャンネルの名前を見出し（h1）に出す", async () => {
    respondChannels([general]);
    server.use(
      http.get("/api/channels/:channelId", ({ params }) =>
        HttpResponse.json({
          id: params.channelId,
          roomId: params.channelId,
          name: "全社連絡",
          description: "全社への連絡",
          visibility: "public",
          departmentId: null,
          joined: true,
          isCaseChannel: false,
          // #201：詳細の応答に canPost が加わった
          canPost: true,
          // #134：詳細の応答に readOnly（部署が無効）が加わった
          readOnly: false,
          memberCount: 1,
          members: [
            { id: "01JTESTUSER000000000000001", displayName: "テスト太郎" },
          ],
        }),
      ),
    );
    renderApp(`/channels/${general.id}`);
    expect(
      await screen.findByRole("heading", { level: 1, name: "全社連絡" }),
    ).toBeTruthy();
  });

  it("#200 AC-3: 見つからない（404。存在しない・参加していない非公開）ときは「見つかりません」を出し、名前などを出さない", async () => {
    respondChannels([]);
    const requested: string[] = [];
    server.use(
      http.get("/api/channels/:channelId", ({ params }) => {
        requested.push(String(params.channelId));
        return HttpResponse.json(
          { code: "NOT_FOUND", message: "見つかりません" },
          { status: 404 },
        );
      }),
    );
    renderApp("/channels/01JTESTCHAN00000000000999");
    expect(await screen.findByText(/見つかりません/)).toBeTruthy();
    // 画面の振り分けの「ページが見つかりません」ではなく、詳細の API を呼んだ結果であること
    expect(requested).toEqual(["01JTESTCHAN00000000000999"]);
  });
});
