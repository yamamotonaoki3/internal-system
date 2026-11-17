// #146（146-A）screens S-18「下書き」・C-120・1-1 AC-4：案件の作成の申請の「説明」欄だけを、利用者ごとに端末へ一時保存する。
// 件名・取引先・担当部署・候補・納期は保存しない（C-82・C-117）。保存の規則そのもの（期限・空白だけは保存しない）は #239 のテストにあるので重ねない。
// 契約（実装前の仮置き。計画 A-7）：features/drafts の公開の入口から useDraft(userId, caseRequestDraftScope()) を使う。
//   キーは「internal-system:draft:v1:<利用者ID>:」で始まる（scope の値はこのテストでは決めない。同じ利用者の下書きが1件だけできることを確かめる）。
//   マウントで復元し、入力のたびに保存する。送信が成功したら消し、失敗したら残す。保存先が使えないときも入力と送信はできる。
//   再申請でフォームに値を入れたときは、元の申請の説明を入れ、それも下書きとして保存する。
// データは架空。
import { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLIENT_A,
  DEPT_SALES,
  caseRequestItem,
  failPost,
  renderCaseRequestScreen,
  respondChoices,
  respondMyCaseRequests,
  respondProfileDepartment,
  respondSimilar,
} from "../test/case-request-handlers";
import { CaseRequestPage } from "./CaseRequestPage";

const USER_A = {
  id: "01JTESTUSER00000000000CA01",
  displayName: "testuser_casedraft_a",
  loginId: "testuser_casedraft_a",
};
const USER_B = {
  id: "01JTESTUSER00000000000CB01",
  displayName: "testuser_casedraft_b",
  loginId: "testuser_casedraft_b",
};
const PREFIX = "internal-system:draft:v1:";

/** 利用者の下書きのキーと値（JSON）の一覧 */
function draftsOf(userId: string): { key: string; value: unknown }[] {
  const found: { key: string; value: unknown }[] = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (key === null || !key.startsWith(`${PREFIX}${userId}:`)) continue;
    const raw = window.localStorage.getItem(key);
    found.push({ key, value: raw === null ? null : JSON.parse(raw) });
  }
  return found;
}

function allStoredText(): string {
  let text = "";
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (key !== null) text += `${key}=${window.localStorage.getItem(key)}\n`;
  }
  return text;
}

const titleInput = () => screen.getByRole("textbox", { name: "件名" });
const descriptionInput = () =>
  screen.getByRole<HTMLTextAreaElement>("textbox", { name: "説明" });
const submitButton = () => screen.getByRole("button", { name: "申請する" });

function prepare(items = [] as ReturnType<typeof caseRequestItem>[]) {
  respondProfileDepartment(DEPT_SALES);
  respondChoices();
  respondSimilar(false);
  return respondMyCaseRequests(items);
}

function renderAs(user: typeof USER_A) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  return renderCaseRequestScreen(<CaseRequestPage />, { user, client });
}

async function fillRequired(user: ReturnType<typeof renderAs>["user"]) {
  await user.selectOptions(
    await screen.findByRole("combobox", { name: "取引先" }),
    CLIENT_A.id,
  );
  await user.type(titleInput(), "[[UNIT_TEST]下書きの件名");
  await user.click(
    await within(screen.getByRole("group", { name: "担当部署" })).findByRole(
      "checkbox",
      { name: DEPT_SALES.name },
    ),
  );
  fireEvent.change(screen.getByLabelText("納期"), {
    target: { value: "2026-12-01" },
  });
}

const original = Object.getOwnPropertyDescriptor(window, "localStorage");
beforeEach(() => {
  // 納期の「今日」を固定する（日本時間 2026-11-17）
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-17T03:00:00.000Z"));
  window.localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  if (original !== undefined)
    Object.defineProperty(window, "localStorage", original);
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("#146 S-18 説明欄の下書き（C-120・1-1 AC-4）", () => {
  it("#146 C-120: 説明を入れると、その利用者の下書きが1件だけでき、本文は説明。件名・取引先・部署・納期は保存しない", async () => {
    prepare();
    const { user } = renderAs(USER_A);
    await fillRequired(user);
    await user.type(descriptionInput(), "下書きの説明");
    await waitFor(() => expect(draftsOf(USER_A.id)).toHaveLength(1));
    const [draft] = draftsOf(USER_A.id);
    expect(draft?.value).toMatchObject({ body: "下書きの説明" });
    const stored = allStoredText();
    expect(stored).not.toContain("下書きの件名");
    expect(stored).not.toContain(CLIENT_A.id);
    expect(stored).not.toContain(DEPT_SALES.id);
    expect(stored).not.toContain("2026-12-01");
  });

  it("#146 1-1 AC-4: 同じ利用者で開き直すと説明を復元する。件名は復元しない", async () => {
    prepare();
    const first = renderAs(USER_A);
    await fillRequired(first.user);
    await first.user.type(descriptionInput(), "復元する説明");
    await waitFor(() => expect(draftsOf(USER_A.id)).toHaveLength(1));
    first.unmount();
    prepare();
    renderAs(USER_A);
    await waitFor(() => expect(descriptionInput().value).toBe("復元する説明"));
    expect((titleInput() as HTMLInputElement).value).toBe("");
  });

  it("#146 1-1 AC-4・C-82: 別の利用者では復元しない", async () => {
    prepare();
    const first = renderAs(USER_A);
    await first.user.type(descriptionInput(), "Aさんの説明");
    await waitFor(() => expect(draftsOf(USER_A.id)).toHaveLength(1));
    first.unmount();
    prepare();
    renderAs(USER_B);
    await screen.findByRole("combobox", { name: "取引先" });
    expect(descriptionInput().value).toBe("");
    expect(draftsOf(USER_B.id)).toEqual([]);
  });

  it("#146 C-120: 送信が成功したら下書きを消す", async () => {
    const { sent } = prepare();
    const { user } = renderAs(USER_A);
    await fillRequired(user);
    await user.type(descriptionInput(), "送る説明");
    await waitFor(() => expect(draftsOf(USER_A.id)).toHaveLength(1));
    await user.click(submitButton());
    await waitFor(() => expect(sent).toHaveLength(1));
    await waitFor(() => expect(draftsOf(USER_A.id)).toEqual([]));
  });

  it("#146 C-120: 送信が失敗したら下書きを残す", async () => {
    prepare();
    const failed = failPost("/api/case-requests", 409, {
      code: "CONFLICT",
      message: "審査する人が変わりました。もう一度申請してください",
    });
    const { user } = renderAs(USER_A);
    await fillRequired(user);
    await user.type(descriptionInput(), "残す説明");
    await user.click(submitButton());
    await waitFor(() => expect(failed).toHaveLength(1));
    await screen.findByRole("alert");
    expect(draftsOf(USER_A.id)[0]?.value).toMatchObject({ body: "残す説明" });
  });

  it("#146 1-1 AC-4: 保存先が使えない（localStorage の参照が SecurityError）ときも、入力と送信はできる", async () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("使えません", "SecurityError");
      },
    });
    const { sent } = prepare();
    const { user } = renderAs(USER_A);
    await fillRequired(user);
    await user.type(descriptionInput(), "保存できない説明");
    expect(descriptionInput().value).toBe("保存できない説明");
    await user.click(submitButton());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toMatchObject({ description: "保存できない説明" });
  });

  it("#146 計画 A-7: 「修正して再申請」で入れた元の説明も、下書きとして保存する", async () => {
    prepare([
      caseRequestItem("R1", {
        title: "[UNIT_TEST]元の件名",
        description: "元の説明",
        status: "rejected",
        rejectReason: "理由",
        decidedAt: "2026-11-17T04:00:00.000Z",
      }),
    ]);
    const { user } = renderAs(USER_A);
    const heading = await screen.findByRole("heading", {
      level: 2,
      name: "自分の申請",
    });
    const scope = (heading.closest("section") ?? document.body) as HTMLElement;
    await user.click(
      await within(scope).findByRole("button", { name: "修正して再申請" }),
    );
    await waitFor(() => expect(descriptionInput().value).toBe("元の説明"));
    await waitFor(() =>
      expect(draftsOf(USER_A.id)[0]?.value).toMatchObject({ body: "元の説明" }),
    );
  });
});
