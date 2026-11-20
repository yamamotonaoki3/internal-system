// #150（150-C）計画 4.6・6章「重大3 開いた時点の固定」：S-17 の「内容を編集」は、押した時点の1つの応答から、入力の初期値・比べる値・
// 送る衝突の検知の値（参加者は詳細の version、非参加の管理者は概要の件名・取引先・担当部署の expected）を作り、開いている間は差し替えない。
// 確かめるもの：
//   - 版1で開いて入力 → ほかの人の更新で詳細・概要が版2に取り直される（画面の見出しが新しい件名になる）→ 入力と初期値は変わらず、保存は版1を送り、
//     409 stale を外に出してダイアログを閉じる（古い入力を新しい基準で送り直さない）
//   - 参加者の基準は詳細の応答だけから来る（概要だけが新しい状態でも、件名・取引先・担当部署・版が混ざらない）
//   - 非参加の管理者は、開いた時点の概要の値の expected を送り続ける
// 取り直しは TanStack Query の invalidate（ほかの操作の後の取り直しと同じ経路）で起こす。切り替わる途中の画面を数えないよう、
// 見出しが新しい件名になる（前の件名が消える）のを待ってから確かめる。API は MSW。データはすべて架空（testuser_150c_・[UNIT_TEST]）。
// 画面の契約は pages/CaseEdit.test.tsx の冒頭を参照。
import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import {
  caseDetail,
  caseId,
  caseSummary,
  outsiderSummary,
  respondCaseEdit,
  type CaseSummary,
} from "../test/case-handlers";
import {
  CLIENT_A,
  CLIENT_B,
  DEPT_DEV,
  DEPT_SALES,
  renderCaseRequestScreen,
  respondChoices,
  respondSimilar,
} from "../test/case-request-handlers";
import { server } from "../test/server";
import { CaseDetailPage } from "./CaseDetailPage";

/** user-event の type は「[」「{」をキーの指定として読むため、文字として入力するときは重ねる（既存のテストと同じ書き方） */
const typed = (text: string) => text.replace(/[[{]/g, (c) => c + c);
const N = 162;
const OLD_TITLE = "[UNIT_TEST]150C開いた時点の件名";
const NEW_TITLE = "[UNIT_TEST]150Cほかの人が変えた件名";
const OLD_DESCRIPTION = "[UNIT_TEST]150C開いた時点の説明";
const NEW_DESCRIPTION = "[UNIT_TEST]150Cほかの人が変えた説明";
const TYPED = "[UNIT_TEST]150C入力中の件名";
const STALE =
  "ほかの人が先にこの案件を変更しました。画面を確かめてから、もう一度操作してください";

type Snapshot = {
  title: string;
  description: string;
  version: number;
  clientId: string;
  departmentIds: string[];
};

const OLD: Snapshot = {
  title: OLD_TITLE,
  description: OLD_DESCRIPTION,
  version: 1,
  clientId: CLIENT_A.id,
  departmentIds: [DEPT_SALES.id],
};
const NEW: Snapshot = {
  title: NEW_TITLE,
  description: NEW_DESCRIPTION,
  version: 2,
  clientId: CLIENT_B.id,
  departmentIds: [DEPT_SALES.id, DEPT_DEV.id],
};

const clientOf = (id: string) => {
  const found = [CLIENT_A, CLIENT_B].find((c) => c.id === id);
  if (found === undefined) throw new Error("取引先がありません");
  return { id: found.id, name: found.name, isActive: true };
};
const departmentsOf = (ids: string[]) =>
  [DEPT_SALES, DEPT_DEV]
    .filter((d) => ids.includes(d.id))
    .map((d) => ({ id: d.id, name: d.name, isActive: true }));

function summaryFrom(s: Snapshot, manager: boolean): CaseSummary {
  const base = {
    title: s.title,
    client: clientOf(s.clientId),
    departments: departmentsOf(s.departmentIds),
  };
  return manager
    ? outsiderSummary(N, {
        ...base,
        canManage: true,
        canEditDueDate: true,
        participantCount: 3,
      })
    : caseSummary(N, base);
}

/** 概要と詳細を、別々の状態から返せる世界（概要だけが新しい状態を作るため） */
function world(manager = false) {
  const state = { summary: OLD, detail: OLD };
  server.use(
    http.get("/api/cases/:caseId/detail", () =>
      manager
        ? HttpResponse.json(
            { code: "FORBIDDEN", message: "参加者だけが見られます（非公開）" },
            { status: 403 },
          )
        : HttpResponse.json(
            caseDetail(N, {
              ...summaryFrom(state.detail, false),
              description: state.detail.description,
              version: state.detail.version,
            }),
          ),
    ),
    http.get("/api/cases/:caseId", () =>
      HttpResponse.json(summaryFrom(state.summary, manager)),
    ),
  );
  respondChoices();
  respondSimilar(false);
  const { writes } = respondCaseEdit(() =>
    HttpResponse.json(
      { code: "CONFLICT", message: STALE, reason: "stale" },
      { status: 409 },
    ),
  );
  return { state, writes };
}

function renderPage() {
  return renderCaseRequestScreen(<CaseDetailPage />, {
    at: `/cases/${caseId(N)}`,
    path: "/cases/:caseId",
  });
}

type Rendered = ReturnType<typeof renderPage>;

async function openDialog(user: Rendered["user"]) {
  const button = await screen.findByRole<HTMLButtonElement>("button", {
    name: "内容を編集",
  });
  await waitFor(() => expect(button.disabled).toBe(false));
  await user.click(button);
  return screen.findByRole("dialog", { name: "案件の内容の編集" });
}

const titleBox = (dialog: HTMLElement) =>
  within(dialog).getByRole<HTMLInputElement>("textbox", { name: /件名/ });

/** ほかの人の更新を反映させる（取り直し）。見出しが新しい件名に切り替わるのを待つ */
async function refetchUntilHeading(client: Rendered["client"], title: string) {
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["cases"] });
  });
  await waitFor(() =>
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(title),
  );
}

describe("#150 150-C 重大3：開いた時点の1つの応答から基準を固定する", () => {
  it("#150 4.6・重大3: 参加者が版1で開いて入力 → 詳細・概要が版2に取り直されても、入力・説明の初期値は変わらず、保存は版1を送り、409 を外に出して閉じる", async () => {
    const { state, writes } = world();
    const { user, client } = renderPage();
    const dialog = await openDialog(user);
    expect(titleBox(dialog).value).toBe(OLD_TITLE);
    await user.clear(titleBox(dialog));
    await user.type(titleBox(dialog), typed(TYPED));

    state.summary = NEW;
    state.detail = NEW;
    await refetchUntilHeading(client, NEW_TITLE);

    expect(screen.getByRole("dialog", { name: "案件の内容の編集" })).toBe(
      dialog,
    );
    expect(titleBox(dialog).value).toBe(TYPED);
    expect(
      within(dialog).getByRole<HTMLTextAreaElement>("textbox", { name: /説明/ })
        .value,
    ).toBe(OLD_DESCRIPTION);
    expect(
      (
        within(dialog).getByRole("combobox", {
          name: /取引先/,
        }) as HTMLElement & { value: string }
      ).value,
    ).toBe(CLIENT_A.id);

    await user.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    // 比べる値も開いた時点のもの：件名だけを変えた（取引先・部署・説明を送らない）
    expect(writes[0]?.body).toEqual({ version: 1, title: TYPED });
    const alert = await screen.findByText(STALE);
    expect(alert.closest("dialog")).toBeNull();
    expect(
      screen.queryByRole("dialog", { name: "案件の内容の編集" }),
    ).toBeNull();
  });

  it("#150 4.2.1・重大3: 参加者の基準は詳細の応答だけから作る（概要だけが新しい状態でも、件名・取引先・担当部署・版は詳細の値）", async () => {
    const { state, writes } = world();
    state.summary = NEW;
    const { user } = renderPage();
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        NEW_TITLE,
      ),
    );
    const dialog = await openDialog(user);
    expect(titleBox(dialog).value).toBe(OLD_TITLE);
    expect(
      (
        within(dialog).getByRole("combobox", {
          name: /取引先/,
        }) as HTMLElement & { value: string }
      ).value,
    ).toBe(CLIENT_A.id);
    const group = within(dialog).getByRole("group", { name: "担当部署" });
    expect(
      within(group).getByRole<HTMLInputElement>("checkbox", {
        name: DEPT_DEV.name,
      }).checked,
    ).toBe(false);
    await user.type(
      within(dialog).getByRole("textbox", { name: /説明/ }),
      "追記",
    );
    await user.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.body).toEqual({
      version: 1,
      description: `${OLD_DESCRIPTION}追記`,
    });
  });

  it("#150 Q3＝C・重大3: 非参加の管理者が開いた後に概要が取り直されても、送る expected は開いた時点の件名・取引先・担当部署のまま", async () => {
    const { state, writes } = world(true);
    const { user, client } = renderPage();
    const dialog = await openDialog(user);
    await user.clear(titleBox(dialog));
    await user.type(titleBox(dialog), typed(TYPED));

    state.summary = NEW;
    await refetchUntilHeading(client, NEW_TITLE);
    expect(titleBox(dialog).value).toBe(TYPED);

    await user.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.body).toEqual({
      expected: {
        title: OLD_TITLE,
        clientId: CLIENT_A.id,
        departmentIds: [DEPT_SALES.id],
      },
      title: TYPED,
    });
    expect(await screen.findByText(STALE)).toBeTruthy();
  });
});
