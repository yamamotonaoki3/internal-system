// #130 AC-1（0-4 AC-4・AC-5・AC-10）・AC-2（6-1 AC-4）・AC-3（7-3 AC-1〜AC-4）：社員一覧（S-20、/members）・プロフィールカード（S-27）・
// ステータスの代理設定のダイアログを、App を通して描画し、MSW（test/profile-handlers.ts）の状態つきの応答で確かめる。
// 時刻に依存するテスト（戻り予定の超過）は vi.useFakeTimers（Date だけ）で固定する。
// jsdom には popover がないため、カードの開閉は toggle イベント（fireToggle）で再現する。Esc・外側クリック・フォーカスの戻りの実際は e2e/profile.spec.ts。
// 公開形の仮定（契約。計画 1章「画面」）：
//  - h1「社員一覧」。表（table）の1行が1人。表示名はボタン（popovertarget でカードの popover を開く）
//  - 部署の絞り込みはラベル「部署」の選択（候補は GET /api/users/departments。先頭は「すべての部署」）
//  - 「さらに表示」で nextCursor の続きを足す
//  - 代理設定は行のボタン「ステータスを代理設定」→ dialog「ステータスの代理設定」。5種類のラジオ・「戻り予定」・「設定する」
//  - カードは本名・部署・ステータス・一言・戻り予定を出し、「閉じる」ボタンを持つ
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import {
  SHELL_USER,
  fireToggle,
  installDomStubs,
  renderApp,
  type DomStubs,
} from "../../test/app-shell-harness";
import {
  DEPT_DEV,
  DEPT_SALES,
  member,
  respondProfileWorld,
} from "../../test/profile-handlers";
import { server } from "../../test/server";

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
});
afterEach(() => {
  stubs.restore();
  vi.useRealTimers();
});

async function membersTable() {
  // ログイン状態の確認中の枠にも main があるため、h1 が出てから main を取る
  await screen.findByRole("heading", { level: 1, name: "社員一覧" });
  const main = screen.getByRole("main");
  return { main, table: await within(main).findByRole("table") };
}

async function rowOf(name: string) {
  const { table } = await membersTable();
  const button = await within(table).findByRole("button", { name });
  const row = button.closest("tr");
  if (row === null) throw new Error(`${name} の行がありません`);
  return row as HTMLElement;
}

describe("#130 AC-3（7-3 AC-1・AC-2）社員一覧の表示", () => {
  it("#130 AC-3（7-3 AC-1）: サイドバーの「社員一覧」から /members に進める", async () => {
    respondProfileWorld({ members: [member(1)] });
    const { user } = renderApp("/");
    const side = within(
      await screen.findByRole("navigation", { name: "メインメニュー" }),
    );
    await user.click(side.getByRole("link", { name: "社員一覧" }));
    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toBe("/members"),
    );
    await membersTable();
  });

  it("#130 AC-3（7-3 AC-2）・AC-2（6-1 AC-4）: 表示名・部署・内線・メール・ステータスが1行に出る。メールは mailto のリンク、内線はリンクでない", async () => {
    respondProfileWorld({
      members: [
        member(1, {
          status: { kind: "meeting", returnAt: null, message: null },
        }),
      ],
    });
    renderApp("/members");
    const row = within(await rowOf("テスト社員001"));
    expect(row.getByText("[E2E_TEST]営業部130")).toBeDefined();
    expect(row.getByText("会議中")).toBeDefined();
    const mail = row.getByRole("link", { name: "testuser_001@example.com" });
    expect(mail.getAttribute("href")).toBe("mailto:testuser_001@example.com");
    const extension = row.getByText("1001");
    expect(extension.closest("a")).toBeNull();
    // 本名は一覧に出さない（カードだけ）
    expect(row.queryByText("テスト本名001")).toBeNull();
  });

  it("#130 AC-3（7-3 AC-1）: 一覧の取得に失敗したら、エラーを知らせる", async () => {
    respondProfileWorld();
    server.use(
      http.get("/api/users", () =>
        HttpResponse.json(
          { code: "INTERNAL", message: "一時的なエラーが発生しました" },
          { status: 500 },
        ),
      ),
    );
    renderApp("/members");
    await screen.findByRole("heading", { level: 1, name: "社員一覧" });
    const main = screen.getByRole("main");
    expect(await within(main).findByRole("alert")).toBeDefined();
  });

  it("#130 AC-3（7-3 AC-1）: 0件なら、空であることを知らせる（表の行は出さない）", async () => {
    respondProfileWorld({ members: [] });
    renderApp("/members");
    await screen.findByRole("heading", { level: 1, name: "社員一覧" });
    const main = screen.getByRole("main");
    expect(
      await within(main).findByText(/社員がいません|該当する社員/),
    ).toBeDefined();
  });

  it("#130 AC-1（0-4 AC-3・AC-9）: script タグを含む表示名・一言は、文字として表示する", async () => {
    respondProfileWorld({
      members: [
        member(1, {
          displayName: "<script>window.__x=1</script>",
          status: {
            kind: "away",
            returnAt: null,
            message: "<img src=x onerror=alert(1)>",
          },
        }),
      ],
    });
    renderApp("/members");
    expect(await rowOf("<script>window.__x=1</script>")).toBeDefined();
    expect(document.querySelector("main script")).toBeNull();
    expect(document.querySelector("main img[src='x']")).toBeNull();
  });
});

describe("#130 AC-3（7-3 AC-3）部署での絞り込みとページング", () => {
  it("#130 AC-3（7-3 AC-3）: 部署を選ぶと departmentId で取り直し、その部署の社員だけが出る", async () => {
    const world = respondProfileWorld({
      members: [
        member(1),
        member(2, { department: DEPT_DEV, displayName: "テスト開発者" }),
      ],
    });
    const { user } = renderApp("/members");
    const { main } = await membersTable();
    await rowOf("テスト社員001");
    const select = await within(main).findByRole("combobox", { name: "部署" });
    await within(select).findByRole("option", { name: DEPT_DEV.name });
    await user.selectOptions(select, DEPT_DEV.id);
    await waitFor(() =>
      expect(
        world.listRequests.some(
          (url) => url.searchParams.get("departmentId") === DEPT_DEV.id,
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(
        within(main).queryByRole("button", { name: "テスト社員001" }),
      ).toBeNull(),
    );
    expect(
      within(main).getByRole("button", { name: "テスト開発者" }),
    ).toBeDefined();
    expect(
      within(select).getByRole("option", { name: DEPT_SALES.name }),
    ).toBeDefined();
  });

  it("#130 AC-3（7-3 AC-3）: nextCursor があれば「さらに表示」で続きを足し、重複しない", async () => {
    const world = respondProfileWorld({
      members: Array.from({ length: 21 }, (_v, i) => member(i + 1)),
    });
    const { user } = renderApp("/members");
    const { main, table } = await membersTable();
    await within(table).findByRole("button", { name: "テスト社員020" });
    expect(
      within(table).queryByRole("button", { name: "テスト社員021" }),
    ).toBeNull();
    await user.click(within(main).getByRole("button", { name: "さらに表示" }));
    expect(
      await within(table).findByRole("button", { name: "テスト社員021" }),
    ).toBeDefined();
    expect(
      world.listRequests.some(
        (url) => url.searchParams.get("cursor") === "c20",
      ),
    ).toBe(true);
    expect(
      within(table).getAllByRole("button", { name: "テスト社員001" }),
    ).toHaveLength(1);
    await waitFor(() =>
      expect(
        within(main).queryByRole("button", { name: "さらに表示" }),
      ).toBeNull(),
    );
  });
});

describe("#130 AC-1（0-4 AC-4）戻り予定の超過（時刻固定）", () => {
  it("#130 AC-1（0-4 AC-4）: 戻り予定を過ぎた人に「戻り予定を過ぎています」を出し、ステータスの表示は変えない。前の人には出さない", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-11T03:00:00.000Z"));
    respondProfileWorld({
      members: [
        member(1, {
          status: {
            kind: "away",
            returnAt: "2026-11-11T02:59:59.000Z",
            message: null,
          },
        }),
        member(2, {
          status: {
            kind: "away",
            returnAt: "2026-11-11T03:00:01.000Z",
            message: null,
          },
        }),
      ],
    });
    renderApp("/members");
    const overdue = within(await rowOf("テスト社員001"));
    expect(overdue.getByText("外出")).toBeDefined();
    expect(overdue.getByText("戻り予定を過ぎています")).toBeDefined();
    const ahead = within(await rowOf("テスト社員002"));
    expect(ahead.getByText("外出")).toBeDefined();
    expect(ahead.queryByText("戻り予定を過ぎています")).toBeNull();
  });

  it("#130 AC-1（0-4 AC-4・P-4）: 判定は描画したときの時刻で行う（同じ戻り予定でも、時刻が後なら超過になる）", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-11T05:00:00.000Z"));
    respondProfileWorld({
      members: [
        member(2, {
          status: {
            kind: "away",
            returnAt: "2026-11-11T03:00:01.000Z",
            message: null,
          },
        }),
      ],
    });
    renderApp("/members");
    const row = within(await rowOf("テスト社員002"));
    expect(row.getByText("戻り予定を過ぎています")).toBeDefined();
    expect(row.getByText("外出")).toBeDefined();
  });
});

describe("#130 AC-1（0-4 AC-5）代理設定の操作", () => {
  it("#130 AC-1（0-4 AC-5）: canSetStatus が true の他人の行には操作が出て、false の行・自分の行（true でも）には出ない", async () => {
    respondProfileWorld({
      members: [
        member(1, { canSetStatus: true }),
        member(2, { canSetStatus: false }),
        member(3, {
          id: SHELL_USER.id,
          displayName: SHELL_USER.displayName,
          canSetStatus: true,
        }),
      ],
    });
    renderApp("/members");
    const name = "ステータスを代理設定";
    expect(
      within(await rowOf("テスト社員001")).getByRole("button", { name }),
    ).toBeDefined();
    expect(
      within(await rowOf("テスト社員002")).queryByRole("button", { name }),
    ).toBeNull();
    expect(
      within(await rowOf(SHELL_USER.displayName)).queryByRole("button", {
        name,
      }),
    ).toBeNull();
  });

  it("#130 AC-1（0-4 AC-5）: ダイアログで種類を選んで設定すると PUT が呼ばれ、再読込なしで行の表示が変わる", async () => {
    const world = respondProfileWorld({
      members: [member(1, { canSetStatus: true })],
    });
    const { user } = renderApp("/members");
    const row = await rowOf("テスト社員001");
    await user.click(
      within(row).getByRole("button", { name: "ステータスを代理設定" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "ステータスの代理設定",
    });
    await user.click(within(dialog).getByRole("radio", { name: "欠席" }));
    await user.click(within(dialog).getByRole("button", { name: "設定する" }));
    await waitFor(() => expect(world.putRequests).toHaveLength(1));
    expect(world.putRequests[0]?.userId).toBe(member(1).id);
    expect(world.putRequests[0]?.body).toMatchObject({ status: "absent" });
    expect(world.putRequests[0]?.body).not.toHaveProperty("statusMessage");
    await waitFor(() => expect(within(row).getByText("欠席")).toBeDefined());
  });

  it("#130 AC-1（0-4 AC-5・AC-4）: 戻り予定を入れて設定すると、その日時が送られる", async () => {
    const world = respondProfileWorld({
      members: [member(1, { canSetStatus: true })],
    });
    const { user } = renderApp("/members");
    const row = await rowOf("テスト社員001");
    await user.click(
      within(row).getByRole("button", { name: "ステータスを代理設定" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "ステータスの代理設定",
    });
    await user.click(within(dialog).getByRole("radio", { name: "外出" }));
    fireEvent.change(within(dialog).getByLabelText("戻り予定"), {
      target: { value: "2099-01-02T15:30" },
    });
    await user.click(within(dialog).getByRole("button", { name: "設定する" }));
    await waitFor(() => expect(world.putRequests).toHaveLength(1));
    const sent = world.putRequests[0]?.body;
    expect(sent?.status).toBe("away");
    expect(new Date(String(sent?.returnAt)).getTime()).toBe(
      new Date("2099-01-02T15:30").getTime(),
    );
  });

  it("#130 AC-1（0-4 AC-5）: 403 が返ったらエラーを知らせ、行の表示は変えない", async () => {
    respondProfileWorld({ members: [member(1, { canSetStatus: true })] });
    server.use(
      http.put("/api/users/:userId/status", () =>
        HttpResponse.json(
          { code: "FORBIDDEN", message: "この操作は許可されていません" },
          { status: 403 },
        ),
      ),
    );
    const { user } = renderApp("/members");
    const row = await rowOf("テスト社員001");
    await user.click(
      within(row).getByRole("button", { name: "ステータスを代理設定" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "ステータスの代理設定",
    });
    await user.click(within(dialog).getByRole("radio", { name: "欠席" }));
    await user.click(within(dialog).getByRole("button", { name: "設定する" }));
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(within(row).getByText("在席")).toBeDefined();
  });
});

describe("#130 AC-1（0-4 AC-10）・AC-3（7-3 AC-4）プロフィールカード S-27", () => {
  async function openCard(name: string, viaKeyboard: boolean) {
    const row = await rowOf(name);
    const trigger = within(row).getByRole("button", { name });
    const panelId = trigger.getAttribute("popovertarget");
    if (panelId === null) throw new Error("カードの popover を指していません");
    return { trigger, panelId, viaKeyboard };
  }

  it("#130 AC-1（0-4 AC-10）・AC-3（7-3 AC-4）: 表示名ボタンを Enter で開くと、本名・部署・ステータス・一言・戻り予定が出る", async () => {
    const world = respondProfileWorld({
      members: [
        member(1, {
          status: {
            kind: "meeting",
            returnAt: "2099-01-02T06:30:00.000Z",
            message: "テスト会議中です",
          },
        }),
      ],
    });
    const { user } = renderApp("/members");
    const { trigger, panelId } = await openCard("テスト社員001", true);
    trigger.focus();
    await user.keyboard("{Enter}");
    const panel = document.getElementById(panelId);
    if (panel === null) throw new Error("カードの popover がありません");
    expect(panel.getAttribute("popover")).not.toBeNull();
    fireToggle(panel, "open");
    const card = within(panel);
    expect(await card.findByText("テスト本名001")).toBeDefined();
    expect(card.getByText("[E2E_TEST]営業部130")).toBeDefined();
    expect(card.getByText("会議中")).toBeDefined();
    expect(card.getByText("テスト会議中です")).toBeDefined();
    expect(card.getByRole("button", { name: "閉じる" })).toBeDefined();
    expect(world.cardRequests).toContain(member(1).id);
  });

  it("#130 AC-1（0-4 AC-10）: 閉じるボタンで閉じ、フォーカスが表示名ボタンに戻る", async () => {
    respondProfileWorld({ members: [member(1)] });
    const { user } = renderApp("/members");
    const { trigger, panelId } = await openCard("テスト社員001", true);
    await user.click(trigger);
    const panel = document.getElementById(panelId);
    if (panel === null) throw new Error("カードの popover がありません");
    fireToggle(panel, "open");
    await within(panel).findByText("テスト本名001");
    const close = within(panel).getByRole("button", { name: "閉じる" });
    await user.click(close);
    // 閉じるボタンは popover を閉じる（popovertargetaction=hide か hidePopover の呼び出し）
    expect(
      close.getAttribute("popovertargetaction") === "hide" ||
        stubs.hidePopover.mock.calls.length > 0,
    ).toBe(true);
    fireToggle(panel, "closed");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    await waitFor(() =>
      expect(trigger.getAttribute("aria-expanded")).toBe("false"),
    );
  });

  it("#130 AC-1（0-4 AC-10）: Esc（ブラウザが閉じた toggle）でも、フォーカスが表示名ボタンに戻る", async () => {
    respondProfileWorld({ members: [member(1)] });
    const { user } = renderApp("/members");
    const { trigger, panelId } = await openCard("テスト社員001", true);
    await user.click(trigger);
    const panel = document.getElementById(panelId);
    if (panel === null) throw new Error("カードの popover がありません");
    fireToggle(panel, "open");
    const close = await within(panel).findByRole("button", { name: "閉じる" });
    close.focus();
    fireToggle(panel, "closed");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("#130 AC-1（0-4 AC-10・AC-11）: カードの取得に失敗したら、エラーを知らせ本名を出さない", async () => {
    respondProfileWorld({ members: [member(1)] });
    server.use(
      http.get("/api/users/:userId/profile-card", () =>
        HttpResponse.json(
          { code: "NOT_FOUND", message: "見つかりませんでした" },
          { status: 404 },
        ),
      ),
    );
    const { user } = renderApp("/members");
    const { trigger, panelId } = await openCard("テスト社員001", true);
    await user.click(trigger);
    const panel = document.getElementById(panelId);
    if (panel === null) throw new Error("カードの popover がありません");
    fireToggle(panel, "open");
    expect(await within(panel).findByRole("alert")).toBeDefined();
    expect(within(panel).queryByText("テスト本名001")).toBeNull();
  });
});
