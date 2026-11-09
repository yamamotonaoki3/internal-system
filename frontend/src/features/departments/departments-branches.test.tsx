// #196 AC-1・AC-2・AC-4: 部署管理の画面の分岐（空の一覧・無効な部署・ページ送り・候補の複数ページ・候補の取得失敗・
// 入力エラーの解消・送信中の表示・取り消し）を、利用者から見える振る舞いで確かめる（ミューテーションの補強）。
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installDomStubs,
  pressEscapeOn,
  type DomStubs,
} from "../../test/app-shell-harness";
import {
  ADMIN,
  DEV,
  HQ,
  MEMBER_DEV,
  MEMBER_SALES,
  OWNER_SALES,
  SALES,
  renderDepartments,
  respondDepartments,
  type Candidate,
} from "../../test/department-harness";
import { server } from "../../test/server";
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

const now = () => new Date().toISOString();
function renderManager() {
  return renderDepartments(
    [{ path: "/departments", element: <DepartmentsManager /> }],
    { at: "/departments", reauthenticatedAt: now() },
  );
}
function renderCreate() {
  return renderDepartments(
    [
      { path: "/departments/new", element: <DepartmentCreateForm /> },
      { path: "/departments", element: <DepartmentsManager /> },
    ],
    { at: "/departments/new", reauthenticatedAt: now() },
  );
}
const rowOf = (name: string) =>
  screen.findByRole("row", {
    name: new RegExp(name.replace(/[[\]]/g, "\\$&")),
  });
const optionTexts = (select: HTMLElement) =>
  within(select)
    .getAllByRole("option")
    .filter((o) => (o as HTMLOptionElement).value !== "")
    .map((o) => o.textContent);

async function openOwnerDialog(
  user: ReturnType<typeof renderManager>["user"],
  name: string,
) {
  const row = await rowOf(name);
  await user.click(within(row).getByRole("button", { name: "オーナーを変更" }));
  return screen.findByRole("dialog", { name: "オーナーの変更" });
}

function candidatesPaged(pages: Candidate[][]) {
  const cursors: (string | null)[] = [];
  server.use(
    http.get("/api/admin/departments/owner-candidates", ({ request }) => {
      const cursor = new URL(request.url).searchParams.get("cursor");
      cursors.push(cursor);
      const index = cursor === null ? 0 : Number(cursor.slice(1));
      return HttpResponse.json({
        items: pages[index] ?? [],
        nextCursor: index + 1 < pages.length ? `p${index + 1}` : null,
      });
    }),
  );
  return cursors;
}

describe("#196 AC-4 一覧の分岐", () => {
  it("#196 AC-4: 部署が0件なら「部署がありません」を表示し、表は出さない", async () => {
    respondDepartments([]);
    renderManager();
    expect(await screen.findByText("部署がありません")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("#196 AC-4（2-1 AC-14）: 無効な部署は「無効」と表示し、改名・オーナー変更の操作を出さない", async () => {
    respondDepartments([{ ...DEV, isActive: false }, SALES]);
    renderManager();
    const row = await rowOf(DEV.name);
    expect(within(row).getByText("無効")).toBeTruthy();
    expect(within(row).queryByRole("button")).toBeNull();
    const active = await rowOf(SALES.name);
    expect(within(active).getByText("有効")).toBeTruthy();
  });

  it("#196 AC-4（EP-2-03）: 続きがあるときだけ「次のページ」を出し、押すとそのカーソルで次の部署を読む", async () => {
    const cursors: (string | null)[] = [];
    server.use(
      http.get("/api/admin/departments", ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        cursors.push(cursor);
        return HttpResponse.json(
          cursor === "c2"
            ? { items: [DEV], nextCursor: null }
            : { items: [HQ, SALES], nextCursor: "c2" },
        );
      }),
    );
    const { user } = renderManager();
    await rowOf(SALES.name);
    await user.click(screen.getByRole("button", { name: "次のページ" }));
    expect(await rowOf(DEV.name)).toBeTruthy();
    expect(cursors).toEqual([null, "c2"]);
    expect(screen.queryByRole("button", { name: "次のページ" })).toBeNull();
  });

  it("#196 AC-1: 改名の欄は「キャンセル」で閉じ、保存に成功しても閉じる", async () => {
    respondDepartments();
    const { user } = renderManager();
    const row = await rowOf(SALES.name);
    await user.click(within(row).getByRole("button", { name: "名前を変更" }));
    const region = screen.getByRole("region", { name: "部署名の変更" });
    await user.click(
      within(region).getByRole("button", { name: "キャンセル" }),
    );
    expect(screen.queryByRole("region", { name: "部署名の変更" })).toBeNull();
    await user.click(
      within(await rowOf(SALES.name)).getByRole("button", {
        name: "名前を変更",
      }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "部署名" }), {
      target: { value: "[UNIT_TEST]営業改" },
    });
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await rowOf("[UNIT_TEST]営業改")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "部署名の変更" })).toBeNull();
  });
});

describe("#196 AC-2 オーナー候補の読み込み", () => {
  it("#196 AC-2: 候補が複数ページなら、次のカーソルで最後まで読み、全員をちょうど1回ずつ選択肢に出す", async () => {
    respondDepartments();
    const cursors = candidatesPaged([
      [ADMIN, OWNER_SALES],
      [MEMBER_SALES],
      [MEMBER_DEV],
    ]);
    const { user } = renderManager();
    const dialog = await openOwnerDialog(user, DEV.name);
    const owner = within(dialog).getByRole("combobox", {
      name: "新しいオーナー",
    });
    await within(dialog).findByRole("option", { name: MEMBER_DEV.displayName });
    // 今のオーナー（ADMIN）は候補に出さない
    expect(optionTexts(owner)).toEqual([
      OWNER_SALES.displayName,
      MEMBER_SALES.displayName,
      MEMBER_DEV.displayName,
    ]);
    expect(cursors).toEqual([null, "p1", "p2"]);
  });

  it("#196 AC-2: 候補のページが上限（40ページ）を超えても終わらないときは、読むのをやめて取得できないと表示する", async () => {
    respondDepartments();
    let calls = 0;
    server.use(
      http.get("/api/admin/departments/owner-candidates", () => {
        calls += 1;
        return HttpResponse.json({
          items: [],
          nextCursor: `p${calls}`,
        });
      }),
    );
    const { user } = renderManager();
    const dialog = await openOwnerDialog(user, SALES.name);
    expect(
      await within(dialog).findByText(/オーナーの候補を取得できませんでした/),
    ).toBeTruthy();
    expect(calls).toBe(40);
  });

  it("#196 AC-2: 候補の取得に失敗したら、ダイアログに取得できないと表示し、再試行で待たせない（要求は1回）", async () => {
    respondDepartments();
    let calls = 0;
    server.use(
      http.get("/api/admin/departments/owner-candidates", () => {
        calls += 1;
        return HttpResponse.json(
          { code: "INTERNAL", message: "取得できません" },
          { status: 500 },
        );
      }),
    );
    const { user } = renderManager();
    const dialog = await openOwnerDialog(user, SALES.name);
    expect(await within(dialog).findByRole("alert")).toBeTruthy();
    expect(calls).toBe(1);
  });

  it("#196 AC-1: 作成画面でも、候補の取得に失敗したら表示し（要求は1回）、指名なしの作成はできる", async () => {
    const { sent } = respondDepartments();
    let calls = 0;
    server.use(
      http.get("/api/admin/departments/owner-candidates", () => {
        calls += 1;
        return HttpResponse.json(
          { code: "INTERNAL", message: "取得できません" },
          { status: 500 },
        );
      }),
    );
    const { user } = renderCreate();
    expect(
      await screen.findByText(/オーナーの候補を取得できませんでした/),
    ).toBeTruthy();
    expect(calls).toBe(1);
    fireEvent.change(screen.getByRole("textbox", { name: "部署名" }), {
      target: { value: "[UNIT_TEST]候補なし" },
    });
    await user.click(screen.getByRole("button", { name: "作成" }));
    await waitFor(() => expect(sent).toHaveLength(1));
  });

  it("#196 AC-1: 候補の読み込み中は「指名しない」以外の選択肢を出さず、その間でも指名なしで作成できる。説明を入れなければ空文字で送る", async () => {
    const { sent } = respondDepartments();
    server.use(
      http.get(
        "/api/admin/departments/owner-candidates",
        () => new Promise<never>(() => {}),
      ),
    );
    const { user } = renderCreate();
    expect(
      optionTexts(screen.getByRole("combobox", { name: "オーナー" })),
    ).toEqual([]);
    fireEvent.change(screen.getByRole("textbox", { name: "部署名" }), {
      target: { value: "[UNIT_TEST]読込中" },
    });
    await user.click(screen.getByRole("button", { name: "作成" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toEqual({
      name: "[UNIT_TEST]読込中",
      description: "",
    });
  });
});

describe("#196 AC-2 オーナー変更のダイアログの分岐", () => {
  it("#196 AC-2: 新しいオーナーを選ばずに「変更する」と、送らずに選ぶよう求める", async () => {
    const { sent } = respondDepartments();
    const { user } = renderManager();
    const dialog = await openOwnerDialog(user, SALES.name);
    await within(dialog).findByRole("option", {
      name: MEMBER_SALES.displayName,
    });
    await user.click(within(dialog).getByRole("button", { name: "変更する" }));
    expect(
      await within(dialog).findByText("新しいオーナーを選んでください"),
    ).toBeTruthy();
    expect(sent).toEqual([]);
  });

  it("#196 AC-2: Esc で閉じると、送らずにダイアログを閉じる", async () => {
    const { sent } = respondDepartments();
    const { user } = renderManager();
    const dialog = await openOwnerDialog(user, SALES.name);
    pressEscapeOn(dialog as HTMLDialogElement);
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "オーナーの変更" }),
      ).toBeNull(),
    );
    expect(sent).toEqual([]);
  });

  it("#196 AC-2: 入力エラー・送信の失敗のあとで直して送ると、前のエラーは消え、成功したら閉じる", async () => {
    respondDepartments();
    let attempts = 0;
    server.use(
      http.put("/api/departments/:id/owner", () => {
        attempts += 1;
        if (attempts === 1)
          return HttpResponse.json(
            { code: "CONFLICT", message: "テストの競合です" },
            { status: 409 },
          );
        return HttpResponse.json({
          departmentId: DEV.id,
          ownerUserId: OWNER_SALES.id,
          version: 2,
          updatedAt: "2026-11-09T00:00:00.000Z",
        });
      }),
    );
    const { user } = renderManager();
    const dialog = await openOwnerDialog(user, DEV.name);
    await within(dialog).findByRole("option", {
      name: OWNER_SALES.displayName,
    });
    // 1 オーナー未選択のエラー
    await user.click(within(dialog).getByRole("button", { name: "変更する" }));
    await within(dialog).findByText("新しいオーナーを選んでください");
    // 2 後任未選択のエラー（オーナーのエラーは消える）
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "新しいオーナー" }),
      OWNER_SALES.id,
    );
    await user.click(within(dialog).getByRole("button", { name: "変更する" }));
    await within(dialog).findByText("元部署の後任を選んでください");
    expect(
      within(dialog).queryByText("新しいオーナーを選んでください"),
    ).toBeNull();
    // 3 送信の失敗（後任のエラーは消える）
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "元部署の後任" }),
      MEMBER_SALES.id,
    );
    await user.click(within(dialog).getByRole("button", { name: "変更する" }));
    expect(await within(dialog).findByText("テストの競合です")).toBeTruthy();
    expect(
      within(dialog).queryByText("元部署の後任を選んでください"),
    ).toBeNull();
    // 4 成功（送信の失敗の表示は消え、閉じる）
    await user.click(within(dialog).getByRole("button", { name: "変更する" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "オーナーの変更" }),
      ).toBeNull(),
    );
    expect(attempts).toBe(2);
  });

  it("#196 AC-2: 送信中は「変更中」と表示し、ボタンを押せない", async () => {
    respondDepartments();
    let release: (() => void) | undefined;
    server.use(
      http.put("/api/departments/:id/owner", async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return HttpResponse.json({
          departmentId: SALES.id,
          ownerUserId: MEMBER_SALES.id,
          version: 4,
          updatedAt: "2026-11-09T00:00:00.000Z",
        });
      }),
    );
    const { user } = renderManager();
    const dialog = await openOwnerDialog(user, SALES.name);
    await within(dialog).findByRole("option", {
      name: MEMBER_SALES.displayName,
    });
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "新しいオーナー" }),
      MEMBER_SALES.id,
    );
    await user.click(within(dialog).getByRole("button", { name: "変更する" }));
    const pending = await within(dialog).findByRole("button", {
      name: "変更中",
    });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    release?.();
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "オーナーの変更" }),
      ).toBeNull(),
    );
  });
});

describe("#196 AC-1 作成画面の分岐", () => {
  it("#196 AC-1: 送信中は「作成中」と表示し、ボタンを押せない", async () => {
    respondDepartments();
    let release: (() => void) | undefined;
    server.use(
      http.post("/api/departments", async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return HttpResponse.json(
          { code: "CONFLICT", message: "競合" },
          { status: 409 },
        );
      }),
    );
    const { user } = renderCreate();
    fireEvent.change(screen.getByRole("textbox", { name: "部署名" }), {
      target: { value: "[UNIT_TEST]送信中" },
    });
    await user.click(screen.getByRole("button", { name: "作成" }));
    const pending = await screen.findByRole("button", { name: "作成中" });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    release?.();
    expect(await screen.findByText("競合")).toBeTruthy();
  });

  it("#196 AC-2: 後任を選ぶよう求めたあとで後任を選んで送ると、後任のエラーは消える（送信の失敗だけが出る）", async () => {
    respondDepartments();
    server.use(
      http.post("/api/departments", () =>
        HttpResponse.json(
          { code: "CONFLICT", message: "テストの競合です" },
          { status: 409 },
        ),
      ),
    );
    const { user } = renderCreate();
    fireEvent.change(screen.getByRole("textbox", { name: "部署名" }), {
      target: { value: "[UNIT_TEST]後任エラー" },
    });
    await screen.findByRole("option", { name: OWNER_SALES.displayName });
    await user.selectOptions(
      screen.getByRole("combobox", { name: "オーナー" }),
      OWNER_SALES.id,
    );
    await user.click(screen.getByRole("button", { name: "作成" }));
    await screen.findByText("元部署の後任を選んでください");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "元部署の後任" }),
      MEMBER_SALES.id,
    );
    await user.click(screen.getByRole("button", { name: "作成" }));
    expect(await screen.findByText("テストの競合です")).toBeTruthy();
    expect(screen.queryByText("元部署の後任を選んでください")).toBeNull();
  });
});
