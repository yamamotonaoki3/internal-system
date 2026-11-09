// #196 AC-1・AC-2・AC-3・AC-4: 架空の全体管理者で、部署の作成（再認証）→ 一覧 → 改名 → オーナー交代（元部署の後任あり）を画面から確かめる。
// 一般社員には部署管理のメニューが出ず、直接URLでも画面を出さないことも確かめる。
// 前提：e2e/seeds/departments.sql（e2euser_dept_admin・既存部署「[E2E_TEST]部署196営業」とそのオーナー・一般社員）。
// 後始末は e2e/seeds/departments-cleanup.sql（社員ID e2euser_dept_・部署名 [E2E_TEST]部署196 の識別子だけ）。
import { execFile } from "node:child_process";
import type { Page } from "@playwright/test";
import { expect, test } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

const PASSWORD = "TestPass123!";
const createdName = "[E2E_TEST]部署196新規";
const renamedName = "[E2E_TEST]部署196改名";

function seedFile(
  file: "departments.sql" | "departments-cleanup.sql",
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ["scripts/db-local.ts", "test", "seed-file", `e2e/seeds/${file}`],
      { cwd: process.cwd(), windowsHide: true },
      (error) => {
        if (error) reject(error);
        else resolve();
      },
    );
  });
}

async function login(page: Page, loginId: string) {
  allowSessionCheck401(page);
  await page.goto("/login");
  await page.getByLabel("ユーザーID", { exact: true }).fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await seedFile("departments.sql");
});
test.afterAll(async () => {
  await seedFile("departments-cleanup.sql");
});

test("#196 AC-1・AC-2・AC-3・AC-4: 全体管理者は再認証して部署を作り、一覧で改名し、別部署のオーナーを後任つきで任命できる", async ({
  page,
}) => {
  await login(page, "e2euser_dept_admin");
  // 管理メニューの「部署」のまとまりは既定で閉じている。閉じたドロワーにも同じ項目があるため、メインメニューに絞る
  const nav = page.getByRole("navigation", { name: "メインメニュー" });
  await nav.locator("summary", { hasText: /^部署$/ }).click();
  await nav.getByRole("link", { name: "部署管理", exact: true }).click();
  await expect(page).toHaveURL(/\/departments$/);
  await expect(page.getByRole("heading", { name: "部署管理" })).toBeVisible();
  await expect(
    page.getByRole("row", { name: /\[E2E_TEST\]部署196営業/ }),
  ).toContainText("E2E部署オーナー");

  // 作成（S-08）。再認証のダイアログを挟む
  await page.getByRole("link", { name: "部署を作成" }).click();
  await expect(page).toHaveURL(/\/departments\/new$/);
  await page.getByRole("textbox", { name: "部署名" }).fill(createdName);
  await page.getByRole("button", { name: "作成", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "再認証" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await dialog.getByRole("button", { name: "再認証" }).click();
  await expect(page).toHaveURL(/\/departments$/);
  const created = page.getByRole("row", {
    name: new RegExp(createdName.replace(/[[\]]/g, "\\$&")),
  });
  await expect(created).toBeVisible();
  // 指名しなければ、作った全体管理者がオーナー
  await expect(created).toContainText("E2E部署管理者");
  // 部署の削除・無効化の操作は出さない（2-1 AC-14）
  await expect(page.getByRole("button", { name: /削除|無効/ })).toHaveCount(0);

  // 改名（再認証の有効期間内なので、ダイアログは出ない）
  await created.getByRole("button", { name: "名前を変更" }).click();
  await page.getByRole("textbox", { name: "部署名" }).fill(renamedName);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const renamed = page.getByRole("row", {
    name: new RegExp(renamedName.replace(/[[\]]/g, "\\$&")),
  });
  await expect(renamed).toBeVisible();

  // オーナー交代：別部署の現オーナーを任命し、元部署の後任を選ぶ（0-8 AC-10）
  await renamed.getByRole("button", { name: "オーナーを変更" }).click();
  const ownerDialog = page.getByRole("dialog", { name: "オーナーの変更" });
  await expect(ownerDialog).toBeVisible();
  await ownerDialog
    .getByRole("combobox", { name: "新しいオーナー" })
    .selectOption({ label: "E2E部署オーナー" });
  await ownerDialog
    .getByRole("combobox", { name: "元部署の後任" })
    .selectOption({ label: "E2E部署メンバー" });
  await ownerDialog.getByRole("button", { name: "変更する" }).click();
  await expect(ownerDialog).toBeHidden();
  await expect(renamed).toContainText("E2E部署オーナー");
  await expect(
    page.getByRole("row", { name: /\[E2E_TEST\]部署196営業/ }),
  ).toContainText("E2E部署メンバー");
});

test("#196 AC-4（2-1 AC-4・7-1 AC-3）: 一般社員には部署管理のメニューが出ず、直接URLでも画面を出さない", async ({
  page,
}) => {
  await login(page, "e2euser_dept_member");
  // 閉じた <details> の中のリンクは getByRole では数えられないため、DOM 上の有無で確かめる
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("ホーム");
  await expect(page.locator('a[href="/departments"]')).toHaveCount(0);
  await expect(
    page
      .getByRole("navigation", { name: "メインメニュー" })
      .locator("summary", { hasText: /^部署$/ }),
  ).toHaveCount(0);
  await page.goto("/departments");
  await expect(
    page.getByRole("heading", { name: "ページが見つかりません" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "部署管理" })).toHaveCount(0);
  await page.goto("/departments/new");
  await expect(
    page.getByRole("heading", { name: "ページが見つかりません" }),
  ).toBeVisible();
});
