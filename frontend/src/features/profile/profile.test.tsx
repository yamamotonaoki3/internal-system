// #130 AC-1（0-4 AC-1・AC-3・AC-9・AC-11）・AC-2（6-1 AC-2・C-136・C-79）：ヘッダーのステータスボタン・アバターメニューの切り替え・
// プロフィール設定（S-19、/profile）を、App を通して描画し、MSW（test/profile-handlers.ts）の状態つきの応答で確かめる。
// jsdom には popover がないため、開閉は toggle イベント（fireToggle）で再現する。実際の開閉・Esc・フォーカス・画面幅の見え方は e2e/profile.spec.ts で確かめる。
// 公開形の仮定（契約。計画 1章「画面」）：
//  - ヘッダー（banner）の中に、名前に「ステータス」と現在の種類（在席など）を含むボタン。popovertarget で popover="auto" の要素を開く
//  - その popover の中に、5種類のボタン（在席・外出・欠席・休暇・会議中）と、ラベル「戻り予定」の日時の入力欄
//  - S-19：h1「プロフィール設定」。ラベル「表示名」の入力と「表示名を保存」、ステータスの5種類のラジオ（グループ名「ステータス」）・
//    「戻り予定」・「一言メッセージ」と「ステータスを保存」。部署・役職・メール・内線・本名は表示だけ
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  fireToggle,
  findHome,
  installDomStubs,
  renderApp,
  type DomStubs,
} from "../../test/app-shell-harness";
import { respondProfileWorld } from "../../test/profile-handlers";

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
});
afterEach(() => {
  stubs.restore();
});

/** S-19 の h1 が出るまで待ってから main を返す（ログイン状態の確認中の枠にも main があるため） */
async function profileMain() {
  await screen.findByRole("heading", { level: 1, name: "プロフィール設定" });
  return screen.getByRole("main");
}

const STATUS_LABELS = ["在席", "外出", "欠席", "休暇", "会議中"];

async function headerStatus() {
  const banner = await screen.findByRole("banner");
  const trigger = await within(banner).findByRole("button", {
    name: /ステータス/,
  });
  const panelId = trigger.getAttribute("popovertarget");
  if (panelId === null)
    throw new Error("ステータスの popover を指していません");
  const panel = document.getElementById(panelId);
  if (panel === null) throw new Error("ステータスの popover がありません");
  return { trigger, panel };
}

describe("#130 AC-2（6-1 AC-2・C-136）ヘッダーのステータスボタン", () => {
  it("#130 AC-2（C-136）: ヘッダーに現在の種類（文字）を出し、読み上げの名前にも種類を含む", async () => {
    respondProfileWorld({
      self: { status: { kind: "meeting", returnAt: null, message: null } },
    });
    renderApp("/");
    await findHome();
    const { trigger } = await headerStatus();
    await waitFor(() => expect(trigger.textContent).toContain("会議中"));
    // 767px 以下では文字を隠すが、読み上げの名前には残す（見た目の確認は E2E）
    expect(trigger.getAttribute("aria-label") ?? trigger.textContent).toMatch(
      /会議中/,
    );
  });

  it("#130 AC-2（6-1 AC-3・C-136）: 押すと popover（auto）に5種類が出る", async () => {
    respondProfileWorld();
    renderApp("/");
    await findHome();
    const { trigger, panel } = await headerStatus();
    expect(panel.getAttribute("popover")).toBe("auto");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireToggle(panel, "open");
    await waitFor(() =>
      expect(trigger.getAttribute("aria-expanded")).toBe("true"),
    );
    for (const label of STATUS_LABELS)
      expect(
        within(panel).getByRole("button", { name: new RegExp(label) }),
      ).toBeDefined();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("#130 AC-2（6-1 AC-2）: 種類を選ぶと PATCH /api/me/profile が呼ばれ、再読込なしでヘッダーの表示が変わる", async () => {
    const world = respondProfileWorld();
    const { user } = renderApp("/");
    await findHome();
    const { trigger, panel } = await headerStatus();
    await waitFor(() => expect(trigger.textContent).toContain("在席"));
    fireToggle(panel, "open");
    await user.click(within(panel).getByRole("button", { name: /外出/ }));
    await waitFor(() => expect(world.patchBodies).toHaveLength(1));
    expect(world.patchBodies[0]).toMatchObject({ status: "away" });
    expect(world.patchBodies[0]).not.toHaveProperty("displayName");
    await waitFor(() => expect(trigger.textContent).toContain("外出"));
  });

  it("#130 AC-2（6-1 AC-2・0-4 AC-4）: 戻り予定を入れてから選ぶと、その日時が送られる", async () => {
    const world = respondProfileWorld();
    const { user } = renderApp("/");
    await findHome();
    const { panel } = await headerStatus();
    fireToggle(panel, "open");
    const input = within(panel).getByLabelText("戻り予定");
    // jsdom の datetime-local は1文字ずつの入力を受け付けないため、値をまとめて変える
    fireEvent.change(input, { target: { value: "2099-01-02T15:30" } });
    await user.click(within(panel).getByRole("button", { name: /会議中/ }));
    await waitFor(() => expect(world.patchBodies).toHaveLength(1));
    const sent = world.patchBodies[0];
    expect(sent).toMatchObject({ status: "meeting" });
    expect(typeof sent?.returnAt).toBe("string");
    expect(new Date(String(sent?.returnAt)).getTime()).toBe(
      new Date("2099-01-02T15:30").getTime(),
    );
  });

  it("#130 AC-2（6-1 AC-2）: 在席を選ぶと戻り予定を送らない（または null）", async () => {
    const world = respondProfileWorld({
      self: {
        status: {
          kind: "away",
          returnAt: "2099-01-02T06:30:00.000Z",
          message: null,
        },
      },
    });
    const { user } = renderApp("/");
    await findHome();
    const { panel } = await headerStatus();
    fireToggle(panel, "open");
    await user.click(within(panel).getByRole("button", { name: /在席/ }));
    await waitFor(() => expect(world.patchBodies).toHaveLength(1));
    expect(world.patchBodies[0]?.status).toBe("available");
    expect(world.patchBodies[0]?.returnAt ?? null).toBeNull();
  });

  it("#130 AC-2（6-1 AC-2）: 送信に失敗したら表示を変えず、エラーを知らせる", async () => {
    const world = respondProfileWorld();
    world.failNextPatch = {
      status: 500,
      body: { code: "INTERNAL", message: "一時的なエラーが発生しました" },
    };
    const { user } = renderApp("/");
    await findHome();
    const { trigger, panel } = await headerStatus();
    fireToggle(panel, "open");
    await user.click(within(panel).getByRole("button", { name: /欠席/ }));
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(trigger.textContent).toContain("在席");
    expect(trigger.textContent).not.toContain("欠席");
  });
});

describe("#130 AC-2（6-1 AC-2・C-79）アバターメニューのステータス", () => {
  it("#130 AC-2（6-1 AC-2）: アバターメニューからも切り替えられ、ヘッダーの表示も変わる", async () => {
    const world = respondProfileWorld();
    const { user } = renderApp("/");
    await findHome();
    const logout = screen.getByRole("button", { name: "ログアウト" });
    const avatarPanel = logout.closest<HTMLElement>("[popover]");
    if (avatarPanel === null) throw new Error("アバターメニューがありません");
    fireToggle(avatarPanel, "open");
    await user.click(within(avatarPanel).getByRole("button", { name: /休暇/ }));
    await waitFor(() =>
      expect(world.patchBodies[0]).toMatchObject({ status: "vacation" }),
    );
    const { trigger } = await headerStatus();
    await waitFor(() => expect(trigger.textContent).toContain("休暇"));
  });
});

describe("#130 AC-1（0-4 AC-1・AC-9・AC-11）S-19 プロフィール設定", () => {
  it("#130 AC-1（0-4 AC-11）: 部署・役職・メール・内線・本名を表示だけで出す（入力欄にしない）", async () => {
    respondProfileWorld();
    renderApp("/profile");
    const main = await profileMain();
    for (const text of [
      "テスト花子",
      "testuser_001@example.com",
      "1001",
      "テスト係",
      "[E2E_TEST]営業部130",
    ])
      expect(await within(main).findByText(text)).toBeDefined();
    for (const label of [/本名/, /メール/, /内線/, /役職/, /部署/])
      expect(within(main).queryByRole("textbox", { name: label })).toBeNull();
  });

  it("#130 AC-1（0-4 AC-9）: 表示名を変えると PATCH で送り、再読込なしでヘッダーのアバターの名前も変わる", async () => {
    const world = respondProfileWorld();
    const { user } = renderApp("/profile");
    const main = await profileMain();
    const input = await within(main).findByRole("textbox", { name: "表示名" });
    await waitFor(() =>
      expect((input as HTMLInputElement).value).toBe("testuser_001"),
    );
    await user.clear(input);
    await user.type(input, "テスト改名");
    await user.click(
      within(main).getByRole("button", { name: "表示名を保存" }),
    );
    await waitFor(() =>
      expect(world.patchBodies).toEqual([{ displayName: "テスト改名" }]),
    );
    expect(
      await screen.findByRole("button", {
        name: "アカウントメニュー（テスト改名）",
      }),
    ).toBeDefined();
  });

  it.each([
    ["空", ""],
    ["31文字", "あ".repeat(31)],
  ])(
    "#130 AC-1（0-4 AC-9）: 表示名が%sなら画面でエラーにし、API を呼ばない",
    async (_label, value) => {
      const world = respondProfileWorld();
      const { user } = renderApp("/profile");
      const main = await profileMain();
      const input = await within(main).findByRole("textbox", {
        name: "表示名",
      });
      await user.clear(input);
      if (value !== "") await user.type(input, value);
      await user.click(
        within(main).getByRole("button", { name: "表示名を保存" }),
      );
      await waitFor(() =>
        expect(input.getAttribute("aria-invalid")).toBe("true"),
      );
      expect(world.patchBodies).toHaveLength(0);
    },
  );

  it("#130 AC-1（0-4 AC-9）: サーバーの VALIDATION_ERROR の fields を、その欄のエラーとして出す", async () => {
    const world = respondProfileWorld();
    world.failNextPatch = {
      status: 422,
      body: {
        code: "VALIDATION_ERROR",
        message: "入力内容を確かめてください",
        fields: ["displayName"],
      },
    };
    const { user } = renderApp("/profile");
    const main = await profileMain();
    const input = await within(main).findByRole("textbox", { name: "表示名" });
    await user.clear(input);
    await user.type(input, "テスト改名");
    await user.click(
      within(main).getByRole("button", { name: "表示名を保存" }),
    );
    await waitFor(() =>
      expect(input.getAttribute("aria-invalid")).toBe("true"),
    );
  });

  it("#130 AC-1（0-4 AC-3）: 一言が101文字なら画面でエラーにし、API を呼ばない。100文字なら送る", async () => {
    const world = respondProfileWorld();
    const { user } = renderApp("/profile");
    const main = await profileMain();
    const message = await within(main).findByRole("textbox", {
      name: "一言メッセージ",
    });
    await user.click(message);
    await user.paste("あ".repeat(101));
    await user.click(
      within(main).getByRole("button", { name: "ステータスを保存" }),
    );
    await waitFor(() =>
      expect(message.getAttribute("aria-invalid")).toBe("true"),
    );
    expect(world.patchBodies).toHaveLength(0);
    await user.clear(message);
    await user.click(message);
    await user.paste("あ".repeat(100));
    await user.click(
      within(main).getByRole("button", { name: "ステータスを保存" }),
    );
    await waitFor(() => expect(world.patchBodies).toHaveLength(1));
    expect(world.patchBodies[0]).toMatchObject({
      statusMessage: "あ".repeat(100),
    });
  });

  it("#130 AC-1（0-4 AC-1）・AC-2（6-1 AC-3）: S-19 のステータスは5種類のラジオで、現在の値が選ばれている", async () => {
    respondProfileWorld({
      self: {
        status: { kind: "absent", returnAt: null, message: "テスト体調不良" },
      },
    });
    renderApp("/profile");
    const main = await profileMain();
    const group = await within(main).findByRole("radiogroup", {
      name: "ステータス",
    });
    for (const label of STATUS_LABELS)
      expect(within(group).getByRole("radio", { name: label })).toBeDefined();
    await waitFor(() =>
      expect(
        (within(group).getByRole("radio", { name: "欠席" }) as HTMLInputElement)
          .checked,
      ).toBe(true),
    );
    expect(
      (
        within(main).getByRole("textbox", {
          name: "一言メッセージ",
        }) as HTMLInputElement
      ).value,
    ).toBe("テスト体調不良");
  });

  it("#130 AC-2（6-1 AC-2）: ヘッダーで切り替えると、開いている S-19 の値も変わる", async () => {
    respondProfileWorld();
    const { user } = renderApp("/profile");
    const main = await profileMain();
    const group = await within(main).findByRole("radiogroup", {
      name: "ステータス",
    });
    const { panel } = await headerStatus();
    fireToggle(panel, "open");
    await user.click(within(panel).getByRole("button", { name: /会議中/ }));
    await waitFor(() =>
      expect(
        (
          within(group).getByRole("radio", {
            name: "会議中",
          }) as HTMLInputElement
        ).checked,
      ).toBe(true),
    );
  });

  it("#130 AC-1（0-4 AC-3・AC-9）: script タグを含む表示名・一言は、文字として表示する", async () => {
    respondProfileWorld({
      self: {
        displayName: "<script>window.__x=1</script>",
        status: {
          kind: "away",
          returnAt: null,
          message: "<img src=x onerror=alert(1)>",
        },
      },
    });
    renderApp("/profile");
    const main = await profileMain();
    const input = await within(main).findByRole("textbox", { name: "表示名" });
    await waitFor(() =>
      expect((input as HTMLInputElement).value).toBe(
        "<script>window.__x=1</script>",
      ),
    );
    expect(document.querySelector("main script")).toBeNull();
    expect(document.querySelector("main img[src='x']")).toBeNull();
  });
});
