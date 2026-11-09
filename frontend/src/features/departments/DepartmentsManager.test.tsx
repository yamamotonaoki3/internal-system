// #196 AC-4（S-24）: 部署の一覧・改名・オーナーの交代の画面（DepartmentsManager と OwnerChangeDialog）。
// 契約（実装前の前提）：features/departments/DepartmentsManager.tsx が DepartmentsManager を名前付きで出す。
// 一覧は表（行に部署名・オーナーの表示名・所属人数・状態）、行ごとに「名前を変更」「オーナーを変更」のボタン。
// 改名の入力欄は「部署名」、確定は「保存」。オーナーの変更は名前「オーナーの変更」のダイアログで、
// 「新しいオーナー」「元部署の後任」の選択欄（select）と「変更する」ボタン。書き込みは再認証（withReauth）で包む。
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server";
import { installDomStubs, type DomStubs } from "../../test/app-shell-harness";
import { TEST_PASSWORD } from "../../test/auth-handlers";
import {
  ADMIN,
  CONFLICT_MESSAGE,
  DEV,
  MEMBER_DEV,
  MEMBER_SALES,
  OWNER_SALES,
  SALES,
  failWrite,
  renderDepartments,
  respondDepartments,
  respondReauth,
} from "../../test/department-harness";
import { DepartmentsManager } from "./DepartmentsManager";

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
});
afterEach(() => {
  stubs.restore();
  vi.restoreAllMocks();
});

function renderManager(
  reauthenticatedAt: string | null = new Date().toISOString(),
) {
  return renderDepartments(
    [{ path: "/departments", element: <DepartmentsManager /> }],
    { at: "/departments", reauthenticatedAt },
  );
}

const rowOf = (name: string) =>
  screen.findByRole("row", {
    name: new RegExp(name.replace(/[[\]]/g, "\\$&")),
  });

describe("#196 AC-4 部署の一覧（S-24）", () => {
  it("#196 AC-4（EP-2-03）: 部署名・オーナーの表示名・所属人数・状態を一覧に出す", async () => {
    respondDepartments();
    renderManager();
    const row = await rowOf(SALES.name);
    expect(row.textContent).toContain(OWNER_SALES.displayName);
    expect(row.textContent).toContain("2");
    expect(row.textContent).toContain("有効");
  });

  it("#196 AC-4（2-1 AC-14）: 部署の削除・無効化の操作は出さない", async () => {
    respondDepartments();
    renderManager();
    await rowOf(SALES.name);
    expect(screen.queryByRole("button", { name: /削除|無効/ })).toBeNull();
  });

  it("#196 AC-4: 作成の画面へのリンクがある", async () => {
    respondDepartments();
    renderManager();
    await rowOf(SALES.name);
    const link = screen.getByRole("link", { name: "部署を作成" });
    expect(link.getAttribute("href")).toBe("/departments/new");
  });

  it("#196 AC-4: 一覧の取得に失敗したら、空の一覧や成功として表示しない", async () => {
    server.use(
      http.get("/api/admin/departments", () =>
        HttpResponse.json(
          { code: "INTERNAL", message: "取得できません" },
          { status: 500 },
        ),
      ),
    );
    renderManager();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("row", { name: /UNIT_TEST/ })).toBeNull();
  });
});

describe("#196 AC-1・AC-4 部署の改名", () => {
  it("#196 AC-1・AC-4（2-1 AC-13）: 改名を送ると、再読込なしで一覧の名前が変わる。本文は前後空白を除いた名前と版", async () => {
    const { sent } = respondDepartments();
    const { user } = renderManager();
    const row = await rowOf(SALES.name);
    await user.click(within(row).getByRole("button", { name: "名前を変更" }));
    const input = screen.getByRole("textbox", { name: "部署名" });
    await user.clear(input);
    await user.type(input, " [[UNIT_TEST]営業改 ");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await rowOf("[UNIT_TEST]営業改")).toBeTruthy();
    expect(sent).toEqual([
      {
        method: "PATCH",
        path: `/api/admin/departments/${SALES.id}`,
        body: { name: "[UNIT_TEST]営業改", version: SALES.version },
      },
    ]);
  });

  it.each([
    ["空", ""],
    ["空白だけ", "   "],
    ["51文字", "A".repeat(51)],
  ])(
    "#196 AC-1（2-1 AC-12）: 部署名が%sなら送らずに入力エラーを示す",
    async (_label, name) => {
      const { sent } = respondDepartments();
      const { user } = renderManager();
      const row = await rowOf(SALES.name);
      await user.click(within(row).getByRole("button", { name: "名前を変更" }));
      const input = screen.getByRole("textbox", { name: "部署名" });
      // maxLength の有無によらず値を入れる（入力の制限ではなく、送る前の検証を確かめる）
      fireEvent.change(input, { target: { value: name } });
      await user.click(screen.getByRole("button", { name: "保存" }));
      await waitFor(() =>
        expect(
          screen
            .getByRole("textbox", { name: "部署名" })
            .getAttribute("aria-invalid"),
        ).toBe("true"),
      );
      expect(sent).toEqual([]);
    },
  );

  it("#196 AC-3・AC-4（7-1 2026-11-08承認）: 名前の衝突（409）は案内の文言を表示し、一覧の名前は変わらない", async () => {
    respondDepartments();
    failWrite("patch", "/api/admin/departments/:id", 409, {
      code: "CONFLICT",
      message: CONFLICT_MESSAGE,
    });
    const { user } = renderManager();
    const row = await rowOf(SALES.name);
    await user.click(within(row).getByRole("button", { name: "名前を変更" }));
    const input = screen.getByRole("textbox", { name: "部署名" });
    await user.clear(input);
    await user.type(input, "[[UNIT_TEST]開発");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText(CONFLICT_MESSAGE)).toBeTruthy();
    expect(await rowOf(SALES.name)).toBeTruthy();
  });

  it("#196 AC-1・AC-4（0-5）: 再認証が要るときは再認証のダイアログを出し、キャンセルすると送らない", async () => {
    const { sent } = respondDepartments();
    const reauth = respondReauth();
    const { user } = renderManager(null);
    const row = await rowOf(SALES.name);
    await user.click(within(row).getByRole("button", { name: "名前を変更" }));
    const input = screen.getByRole("textbox", { name: "部署名" });
    await user.clear(input);
    await user.type(input, "[[UNIT_TEST]営業改");
    await user.click(screen.getByRole("button", { name: "保存" }));
    const dialog = await screen.findByRole("dialog", { name: "再認証" });
    await user.click(
      within(dialog).getByRole("button", { name: "キャンセル" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "再認証" })).toBeNull(),
    );
    expect(sent).toEqual([]);
    expect(reauth.calls()).toBe(0);
    expect(await rowOf(SALES.name)).toBeTruthy();
  });

  it("#196 AC-1・AC-4（0-5）: 再認証に成功すると、改名を1回だけ送る", async () => {
    const { sent } = respondDepartments();
    respondReauth();
    const { user } = renderManager(null);
    const row = await rowOf(SALES.name);
    await user.click(within(row).getByRole("button", { name: "名前を変更" }));
    const input = screen.getByRole("textbox", { name: "部署名" });
    await user.clear(input);
    await user.type(input, "[[UNIT_TEST]営業改");
    await user.click(screen.getByRole("button", { name: "保存" }));
    const dialog = await screen.findByRole("dialog", { name: "再認証" });
    await user.type(within(dialog).getByLabelText("パスワード"), TEST_PASSWORD);
    await user.click(within(dialog).getByRole("button", { name: "再認証" }));
    expect(await rowOf("[UNIT_TEST]営業改")).toBeTruthy();
    expect(sent.filter((s) => s.method === "PATCH")).toHaveLength(1);
  });
});

describe("#196 AC-2・AC-4 オーナーの交代（OwnerChangeDialog）", () => {
  async function openOwnerDialog(
    user: ReturnType<typeof renderManager>["user"],
    departmentName: string,
  ) {
    const row = await rowOf(departmentName);
    await user.click(
      within(row).getByRole("button", { name: "オーナーを変更" }),
    );
    return screen.findByRole("dialog", { name: "オーナーの変更" });
  }

  it("#196 AC-2（0-8 AC-4）: 一般社員を選ぶと後任の欄を出さずに交代を送り、再読込なしで一覧のオーナーが変わる", async () => {
    const { sent } = respondDepartments();
    const { user } = renderManager();
    const dialog = await openOwnerDialog(user, SALES.name);
    const owner = within(dialog).getByRole("combobox", {
      name: "新しいオーナー",
    });
    await within(dialog).findByRole("option", {
      name: MEMBER_SALES.displayName,
    });
    await user.selectOptions(owner, MEMBER_SALES.id);
    expect(
      within(dialog).queryByRole("combobox", { name: "元部署の後任" }),
    ).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "変更する" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "オーナーの変更" }),
      ).toBeNull(),
    );
    const row = await rowOf(SALES.name);
    await waitFor(() =>
      expect(row.textContent).toContain(MEMBER_SALES.displayName),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      method: "PUT",
      path: `/api/departments/${SALES.id}/owner`,
      body: { ownerUserId: MEMBER_SALES.id, version: SALES.version },
    });
    const body = sent[0]?.body as {
      previousDepartmentSuccessorUserId?: unknown;
    };
    expect(body.previousDepartmentSuccessorUserId ?? null).toBeNull();
  });

  it("#196 AC-2（0-8 AC-10）: 別部署の現オーナーを選ぶと、元部署の有効な一般社員だけを後任の候補に出し、後任つきで送る", async () => {
    const { sent } = respondDepartments();
    const { user } = renderManager();
    const dialog = await openOwnerDialog(user, DEV.name);
    const owner = within(dialog).getByRole("combobox", {
      name: "新しいオーナー",
    });
    await within(dialog).findByRole("option", {
      name: OWNER_SALES.displayName,
    });
    await user.selectOptions(owner, OWNER_SALES.id);
    const successor = await within(dialog).findByRole("combobox", {
      name: "元部署の後任",
    });
    const options = within(successor)
      .getAllByRole("option")
      .map((o) => o.textContent ?? "");
    expect(options).toContain(MEMBER_SALES.displayName);
    // 全体管理者・本人・他部署の社員は後任に出さない
    expect(options).not.toContain(ADMIN.displayName);
    expect(options).not.toContain(OWNER_SALES.displayName);
    expect(options).not.toContain(MEMBER_DEV.displayName);
    await user.selectOptions(successor, MEMBER_SALES.id);
    await user.click(within(dialog).getByRole("button", { name: "変更する" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toEqual({
      ownerUserId: OWNER_SALES.id,
      previousDepartmentSuccessorUserId: MEMBER_SALES.id,
      version: DEV.version,
    });
    // 元部署（営業）の行も、再読込なしで後任に変わる
    const salesRow = await rowOf(SALES.name);
    await waitFor(() =>
      expect(salesRow.textContent).toContain(MEMBER_SALES.displayName),
    );
  });

  it("#196 AC-2（0-8 AC-10）: 別部署の現オーナーを選んで後任を選ばなければ、送らずにエラーを示す", async () => {
    const { sent } = respondDepartments();
    const { user } = renderManager();
    const dialog = await openOwnerDialog(user, DEV.name);
    const owner = within(dialog).getByRole("combobox", {
      name: "新しいオーナー",
    });
    await within(dialog).findByRole("option", {
      name: OWNER_SALES.displayName,
    });
    await user.selectOptions(owner, OWNER_SALES.id);
    await within(dialog).findByRole("combobox", { name: "元部署の後任" });
    await user.click(within(dialog).getByRole("button", { name: "変更する" }));
    expect(
      await within(dialog).findByText(/後任/, { selector: "[role=alert], p" }),
    ).toBeTruthy();
    expect(sent).toEqual([]);
  });

  it("#196 AC-2（0-8 AC-5）: 全体管理者を選ぶと後任の欄は出さない", async () => {
    respondDepartments();
    const { user } = renderManager();
    const dialog = await openOwnerDialog(user, SALES.name);
    const owner = within(dialog).getByRole("combobox", {
      name: "新しいオーナー",
    });
    await within(dialog).findByRole("option", { name: ADMIN.displayName });
    await user.selectOptions(owner, ADMIN.id);
    expect(
      within(dialog).queryByRole("combobox", { name: "元部署の後任" }),
    ).toBeNull();
  });

  it("#196 AC-2: 422・409 の応答はダイアログの中に表示し、一覧のオーナーは変わらない", async () => {
    respondDepartments();
    failWrite("put", "/api/departments/:id/owner", 409, {
      code: "CONFLICT",
      message: "ほかの人が先に変更しました。最新の内容を確かめてください",
    });
    const { user } = renderManager();
    const dialog = await openOwnerDialog(user, SALES.name);
    const owner = within(dialog).getByRole("combobox", {
      name: "新しいオーナー",
    });
    await within(dialog).findByRole("option", {
      name: MEMBER_SALES.displayName,
    });
    await user.selectOptions(owner, MEMBER_SALES.id);
    await user.click(within(dialog).getByRole("button", { name: "変更する" }));
    expect(await within(dialog).findByRole("alert")).toBeTruthy();
    const row = await rowOf(SALES.name);
    expect(row.textContent).toContain(OWNER_SALES.displayName);
  });

  it("#196 AC-2（0-8 AC-2）: 再認証をキャンセルすると、交代を送らない", async () => {
    const { sent } = respondDepartments();
    const { user } = renderManager(null);
    const dialog = await openOwnerDialog(user, SALES.name);
    const owner = within(dialog).getByRole("combobox", {
      name: "新しいオーナー",
    });
    await within(dialog).findByRole("option", {
      name: MEMBER_SALES.displayName,
    });
    await user.selectOptions(owner, MEMBER_SALES.id);
    await user.click(within(dialog).getByRole("button", { name: "変更する" }));
    const reauth = await screen.findByRole("dialog", { name: "再認証" });
    await user.click(
      within(reauth).getByRole("button", { name: "キャンセル" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "再認証" })).toBeNull(),
    );
    expect(sent).toEqual([]);
  });

  it("#196 AC-2: 現在のオーナーは新しいオーナーの候補に出さない", async () => {
    respondDepartments();
    const { user } = renderManager();
    const dialog = await openOwnerDialog(user, SALES.name);
    await within(dialog).findByRole("option", {
      name: MEMBER_SALES.displayName,
    });
    expect(
      within(dialog).queryByRole("option", { name: OWNER_SALES.displayName }),
    ).toBeNull();
  });
});
