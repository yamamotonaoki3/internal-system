// #196 AC-1・AC-2・AC-4（S-08）: 部署作成の画面（DepartmentCreateForm）。
// 契約（実装前の前提）：features/departments/DepartmentCreateForm.tsx が DepartmentCreateForm を名前付きで出す。
// 入力欄は「部署名」「説明」、オーナーの選択欄（select）「オーナー」（既定は指名しない＝値が空）、
// 別部署の現オーナーを選んだときだけ「元部署の後任」の選択欄が出る。送信は「作成」ボタン。再認証（withReauth）で包む。
// 成功したら /departments（一覧）へ移り、作った部署が再読込なしで一覧に出る。
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStubs, type DomStubs } from "../../test/app-shell-harness";
import { TEST_PASSWORD } from "../../test/auth-handlers";
import {
  ADMIN,
  CONFLICT_MESSAGE,
  MEMBER_DEV,
  MEMBER_SALES,
  OWNER_SALES,
  failWrite,
  renderDepartments,
  respondDepartments,
  respondReauth,
} from "../../test/department-harness";
import { DepartmentCreateForm } from "./DepartmentCreateForm";
import { DepartmentsManager } from "./DepartmentsManager";

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
});
afterEach(() => {
  stubs.restore();
  vi.restoreAllMocks();
});

function renderCreate(
  reauthenticatedAt: string | null = new Date().toISOString(),
) {
  return renderDepartments(
    [
      { path: "/departments/new", element: <DepartmentCreateForm /> },
      { path: "/departments", element: <DepartmentsManager /> },
    ],
    { at: "/departments/new", reauthenticatedAt },
  );
}

describe("#196 AC-1・AC-4 部署の作成（S-08）", () => {
  it("#196 AC-1（2-1 AC-2）: 指名しなければオーナーを送らずに作成し、一覧へ移って新しい部署が出る", async () => {
    const { sent } = respondDepartments();
    const { user } = renderCreate();
    await user.type(
      screen.getByRole("textbox", { name: "部署名" }),
      " [[UNIT_TEST]新部署 ",
    );
    await user.click(screen.getByRole("button", { name: "作成" }));
    expect(
      await screen.findByRole("row", { name: /\[UNIT_TEST\]新部署/ }),
    ).toBeTruthy();
    expect(sent).toHaveLength(1);
    const body = sent[0]?.body as Record<string, unknown>;
    expect(body.name).toBe("[UNIT_TEST]新部署");
    expect(body.ownerUserId ?? null).toBeNull();
    expect(body.previousDepartmentSuccessorUserId ?? null).toBeNull();
  });

  it("#196 AC-1: 説明を入れると一緒に送る", async () => {
    const { sent } = respondDepartments();
    const { user } = renderCreate();
    await user.type(
      screen.getByRole("textbox", { name: "部署名" }),
      "[[UNIT_TEST]説明つき",
    );
    await user.type(
      screen.getByRole("textbox", { name: "説明" }),
      "テスト用の説明",
    );
    await user.click(screen.getByRole("button", { name: "作成" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toMatchObject({
      name: "[UNIT_TEST]説明つき",
      description: "テスト用の説明",
    });
  });

  it("#196 AC-2（2-1 AC-2）: 一般社員を指名すると、その人を送る（後任の欄は出ない）", async () => {
    const { sent } = respondDepartments();
    const { user } = renderCreate();
    await user.type(
      screen.getByRole("textbox", { name: "部署名" }),
      "[[UNIT_TEST]指名",
    );
    const owner = screen.getByRole("combobox", { name: "オーナー" });
    await screen.findByRole("option", { name: MEMBER_DEV.displayName });
    await user.selectOptions(owner, MEMBER_DEV.id);
    expect(screen.queryByRole("combobox", { name: "元部署の後任" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "作成" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toMatchObject({ ownerUserId: MEMBER_DEV.id });
  });

  it("#196 AC-2（2-1 AC-18）: 別部署の現オーナーを指名すると元部署の後任を選ぶ欄が出て、後任つきで送る", async () => {
    const { sent } = respondDepartments();
    const { user } = renderCreate();
    await user.type(
      screen.getByRole("textbox", { name: "部署名" }),
      "[[UNIT_TEST]後任つき",
    );
    const owner = screen.getByRole("combobox", { name: "オーナー" });
    await screen.findByRole("option", { name: OWNER_SALES.displayName });
    await user.selectOptions(owner, OWNER_SALES.id);
    const successor = await screen.findByRole("combobox", {
      name: "元部署の後任",
    });
    const options = within(successor)
      .getAllByRole("option")
      .map((o) => o.textContent ?? "");
    expect(options).toContain(MEMBER_SALES.displayName);
    expect(options).not.toContain(ADMIN.displayName);
    expect(options).not.toContain(MEMBER_DEV.displayName);
    await user.selectOptions(successor, MEMBER_SALES.id);
    await user.click(screen.getByRole("button", { name: "作成" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toMatchObject({
      ownerUserId: OWNER_SALES.id,
      previousDepartmentSuccessorUserId: MEMBER_SALES.id,
    });
  });

  it("#196 AC-2（0-8 AC-10）: 別部署の現オーナーを指名して後任を選ばなければ、送らずにエラーを示す", async () => {
    const { sent } = respondDepartments();
    const { user } = renderCreate();
    await user.type(
      screen.getByRole("textbox", { name: "部署名" }),
      "[[UNIT_TEST]後任なし",
    );
    const owner = screen.getByRole("combobox", { name: "オーナー" });
    await screen.findByRole("option", { name: OWNER_SALES.displayName });
    await user.selectOptions(owner, OWNER_SALES.id);
    await screen.findByRole("combobox", { name: "元部署の後任" });
    await user.click(screen.getByRole("button", { name: "作成" }));
    expect(
      await screen.findByText(/後任/, { selector: "[role=alert], p" }),
    ).toBeTruthy();
    expect(sent).toEqual([]);
  });

  it.each([
    ["空", ""],
    ["空白だけ", "   "],
    ["51文字", "A".repeat(51)],
  ])(
    "#196 AC-1（2-1 AC-12）: 部署名が%sなら送らずに入力エラーを示す",
    async (_label, name) => {
      const { sent } = respondDepartments();
      const { user } = renderCreate();
      fireEvent.change(screen.getByRole("textbox", { name: "部署名" }), {
        target: { value: name },
      });
      await user.click(screen.getByRole("button", { name: "作成" }));
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

  it("#196 AC-1（2-1 AC-12）: 説明が501文字なら送らずに入力エラーを示す", async () => {
    const { sent } = respondDepartments();
    const { user } = renderCreate();
    await user.type(
      screen.getByRole("textbox", { name: "部署名" }),
      "[[UNIT_TEST]説明超過",
    );
    fireEvent.change(screen.getByRole("textbox", { name: "説明" }), {
      target: { value: "あ".repeat(501) },
    });
    await user.click(screen.getByRole("button", { name: "作成" }));
    await waitFor(() =>
      expect(
        screen
          .getByRole("textbox", { name: "説明" })
          .getAttribute("aria-invalid"),
      ).toBe("true"),
    );
    expect(sent).toEqual([]);
  });

  it("#196 AC-1・AC-3（2-1 AC-12・7-1）: 名前の衝突（409）は案内の文言を表示し、画面に留まる", async () => {
    respondDepartments();
    failWrite("post", "/api/departments", 409, {
      code: "CONFLICT",
      message: CONFLICT_MESSAGE,
    });
    const { user } = renderCreate();
    await user.type(
      screen.getByRole("textbox", { name: "部署名" }),
      "[[UNIT_TEST]営業",
    );
    await user.click(screen.getByRole("button", { name: "作成" }));
    expect(await screen.findByText(CONFLICT_MESSAGE)).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "部署名" })).toBeTruthy();
    expect(screen.queryByRole("row")).toBeNull();
  });

  it("#196 AC-2: 422（指名できない社員など）はエラーを表示し、成功として扱わない", async () => {
    respondDepartments();
    failWrite("post", "/api/departments", 422, {
      code: "VALIDATION_ERROR",
      message: "入力内容を確かめてください",
      fields: ["ownerUserId"],
    });
    const { user } = renderCreate();
    await user.type(
      screen.getByRole("textbox", { name: "部署名" }),
      "[[UNIT_TEST]指名不可",
    );
    await user.click(screen.getByRole("button", { name: "作成" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "部署名" })).toBeTruthy();
  });

  it("#196 AC-1（2-1 AC-1・0-5）: 再認証が要るときはダイアログを出し、キャンセルすると作成を送らない", async () => {
    const { sent } = respondDepartments();
    const reauth = respondReauth();
    const { user } = renderCreate(null);
    await user.type(
      screen.getByRole("textbox", { name: "部署名" }),
      "[[UNIT_TEST]取消",
    );
    await user.click(screen.getByRole("button", { name: "作成" }));
    const dialog = await screen.findByRole("dialog", { name: "再認証" });
    await user.click(
      within(dialog).getByRole("button", { name: "キャンセル" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "再認証" })).toBeNull(),
    );
    expect(sent).toEqual([]);
    expect(reauth.calls()).toBe(0);
    expect(screen.getByRole("textbox", { name: "部署名" })).toBeTruthy();
  });

  it("#196 AC-1（2-1 AC-1・0-5）: 再認証に成功すると、作成を1回だけ送る", async () => {
    const { sent } = respondDepartments();
    respondReauth();
    const { user } = renderCreate(null);
    await user.type(
      screen.getByRole("textbox", { name: "部署名" }),
      "[[UNIT_TEST]再認証後",
    );
    await user.click(screen.getByRole("button", { name: "作成" }));
    const dialog = await screen.findByRole("dialog", { name: "再認証" });
    await user.type(within(dialog).getByLabelText("パスワード"), TEST_PASSWORD);
    await user.click(within(dialog).getByRole("button", { name: "再認証" }));
    expect(
      await screen.findByRole("row", { name: /\[UNIT_TEST\]再認証後/ }),
    ).toBeTruthy();
    expect(sent).toHaveLength(1);
  });
});
