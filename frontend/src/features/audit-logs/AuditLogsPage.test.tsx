// #156（0-6 AC-2〜AC-5・S-25）: 監査ログの画面（/audit-logs）を、App を通して描画し、API は MSW で返して確かめる。データは架空（testuser_156f_・example.com）。
// 公開形の仮定（契約。計画 #156「画面（S-25）」・screens.md S-25。定めのない文言は仮置き）：
//   - h1「監査ログ」。表（role=table）の列見出しは 日時・操作した人・操作の種類・対象・結果。行は role=row（狭い画面のカード形式は E2E で確かめる）
//   - 日時は日本時間（JST）の「YYYY-MM-DD HH:mm:ss」。結果は文字「成功」「失敗」。操作した人が無効なら表示名の後に「（無効）」、不明（null）なら「（不明）」。
//     対象は表示名・名前（label）。行がなければ「（削除された対象）」。社員が無効なら「（無効）」。解決しない種類は「メッセージ」「チャンネル作成の申請」「接続元」「監査ログ」。
//     アカウント登録の失敗の行は、対象を出さず、failureCategory と affectedCount を出す。
//   - 絞り込みのフォーム：入力欄「開始日」「終了日」（日付入力）・選択「操作の種類」（先頭は「すべて」。値は操作の ID）・選択「結果」（すべて・成功・失敗）・ボタン「絞り込む」
//     操作した人・対象は、行のボタン「この人で絞り込む」「この対象で絞り込む」で指定し、指定中は「操作した人：○○」「対象：○○」と、外すボタン
//     「操作した人の絞り込みを外す」「対象の絞り込みを外す」を出す（不明な操作者・対象のない行には、その行のボタンを出さない）
//   - 開くと、絞り込みなしで1回検索する。「絞り込む」を押したときだけ、本文に入力を載せて検索する（入力しただけでは送らない）。開始日が終了日より後なら、
//     入力欄の近くの role=alert に「開始日が終了日より後」の旨を出し、検索しない。422 の fields は該当する入力欄（aria-invalid）と role=alert に出す。
//   - 「さらに読み込む」：nextCursor があるときだけ出し、cursor を載せて続きを足す（同じ絞り込みのまま）。0件は「該当する記録はありません」。
//   - エラー：403 は「権限がありません」を含む role=alert。そのほかは role=alert と「再試行」ボタン。
//   - 取得のたびに閲覧の記録が残るため、自動の再取得（フォーカス・再接続・再試行）をしない。変更・削除・書き出しのボタンは置かない。
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { focusManager } from "@tanstack/react-query";
import { HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUDIT_ACTIONS } from "../../../../backend/src/lib/audit-actions";
import {
  installDomStubs,
  renderApp,
  type DomStubs,
} from "../../test/app-shell-harness";
import { auditLogKeys } from "./query-keys";
import {
  auditActorId,
  auditActorName,
  auditItem,
  auditTargetId,
  auditTargetName,
  respondAuditSearch,
  respondAuditSession,
  type AuditItem,
} from "../../test/audit-log-handlers";

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
  respondAuditSession();
});
afterEach(() => {
  stubs.restore();
});

/** 画面を開き、最初の一覧が出るまで待つ */
async function openPage(items: AuditItem[] = [auditItem(1)]) {
  const calls = respondAuditSearch(() => ({ items, nextCursor: null }));
  const rendered = renderApp("/audit-logs");
  await screen.findByRole("heading", { name: "監査ログ" });
  await waitFor(() => expect(calls).toHaveLength(1));
  return { ...rendered, calls };
}

const rowWith = (text: RegExp | string) =>
  screen.findByRole("row", {
    name: text instanceof RegExp ? text : new RegExp(text),
  });

describe("#156 0-6 AC-2: 一覧の表示", () => {
  it("#156 0-6 AC-2: 表は、日時・操作した人・操作の種類・対象・結果の列見出しを持つ", async () => {
    await openPage();
    const table = await screen.findByRole("table");
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent?.trim());
    for (const name of ["日時", "操作した人", "操作の種類", "対象", "結果"])
      expect(headers).toContain(name);
  });

  it("#156 0-6 AC-2: 1行に、日本時間の日時・操作した人・操作の種類・対象・結果の文字が出る", async () => {
    await openPage([
      auditItem(1, {
        action: "account.create",
        occurredAt: "2026-11-16T01:02:03.000Z",
      }),
    ]);
    const row = await rowWith(auditTargetName(1));
    expect(within(row).getByText("2026-11-16 10:02:03")).toBeTruthy();
    expect(within(row).getByText(auditActorName(1))).toBeTruthy();
    expect(within(row).getByText("アカウント登録")).toBeTruthy();
    expect(within(row).getByText(auditTargetName(1))).toBeTruthy();
    expect(within(row).getByText("成功")).toBeTruthy();
  });

  it.each([
    ["2026-11-16T14:59:59.000Z", "2026-11-16 23:59:59"],
    ["2026-11-16T15:00:00.000Z", "2026-11-17 00:00:00"],
    ["2026-12-31T15:30:05.000Z", "2027-01-01 00:30:05"],
  ])(
    "#156 0-6 AC-2: 日時 %s は、実行環境の時刻帯によらず、日本時間 %s で出る",
    async (occurredAt, expected) => {
      await openPage([auditItem(1, { occurredAt })]);
      const row = await rowWith(auditTargetName(1));
      expect(within(row).getByText(expected)).toBeTruthy();
    },
  );

  it("#156 0-6 AC-2: 失敗は文字「失敗」で出す（色だけに頼らない）", async () => {
    await openPage([
      auditItem(1, {
        action: "auth.login",
        result: "failure",
        actor: null,
        target: null,
      }),
    ]);
    const row = await screen.findByRole("row", { name: /失敗/ });
    expect(within(row).getByText("失敗")).toBeTruthy();
    expect(within(row).getByText("ログイン")).toBeTruthy();
  });

  it("#156 0-6 AC-2: 操作者が不明（null）の行は「（不明）」、無効な操作者は表示名の後に「（無効）」、行のない操作者は名前を作らない", async () => {
    await openPage([
      auditItem(1, {
        id: "01JTEST156FER0W00000000001",
        actor: null,
        target: null,
      }),
      auditItem(2, {
        id: "01JTEST156FER0W00000000002",
        actor: {
          id: auditActorId(2),
          displayName: auditActorName(2),
          isActive: false,
        },
        target: null,
      }),
      auditItem(3, {
        id: "01JTEST156FER0W00000000003",
        actor: { id: auditActorId(3), displayName: null, isActive: false },
        target: null,
      }),
    ]);
    const rows = (await screen.findAllByRole("row")).filter(
      (r) => within(r).queryAllByRole("columnheader").length === 0,
    );
    expect(rows).toHaveLength(3);
    expect(
      within(rows[0] as HTMLElement).getByText(/[(（]不明[)）]/),
    ).toBeTruthy();
    expect(
      within(rows[1] as HTMLElement).getByText(
        new RegExp(`${auditActorName(2)}\\s*[（(]無効[）)]`),
      ),
    ).toBeTruthy();
    // 行のない操作者：ID は画面に出さない
    expect(screen.queryByText(auditActorId(3))).toBeNull();
  });

  it("#156 0-6 AC-2: 対象が無効な社員なら「（無効）」、行がない対象は「（削除された対象）」で、ID は画面に出さない", async () => {
    await openPage([
      auditItem(1, {
        id: "01JTEST156FER0W00000000001",
        target: {
          type: "user",
          id: auditTargetId(1),
          label: auditTargetName(1),
          isActive: false,
        },
      }),
      auditItem(2, {
        id: "01JTEST156FER0W00000000002",
        action: "channel.join",
        target: {
          type: "channel",
          id: "01JTEST156FECHANNE10000099",
          label: null,
          isActive: null,
        },
      }),
    ]);
    const first = await rowWith(auditTargetName(1));
    expect(
      within(first).getByText(
        new RegExp(`${auditTargetName(1)}\\s*[（(]無効[）)]`),
      ),
    ).toBeTruthy();
    const second = await rowWith(/削除された対象/);
    expect(within(second).getByText(/[(（]削除された対象[)）]/)).toBeTruthy();
    expect(screen.queryByText("01JTEST156FECHANNE10000099")).toBeNull();
  });

  it.each([
    ["message", "メッセージ"],
    ["channel_request", "チャンネル作成の申請"],
    ["source", "接続元"],
    ["audit_log", "監査ログ"],
  ])(
    "#156 0-6 AC-2: 名前を解決しない対象の種類 %s は、種類の名前「%s」だけを出す",
    async (type, label) => {
      await openPage([
        auditItem(1, {
          action: "message.delete",
          target: {
            type,
            id: "01JTEST156FE0THER000000001",
            label: null,
            isActive: null,
          },
        }),
      ]);
      const row = await screen.findByRole("row", {
        name: new RegExp(auditActorName(1)),
      });
      expect(within(row).getByText(label)).toBeTruthy();
      expect(within(row).queryByText(/削除された対象/)).toBeNull();
    },
  );

  it("#156 0-6 AC-2・AC-7: アカウント登録の失敗の行は、対象の社員を出さず、エラー分類と対象件数を出す", async () => {
    await openPage([
      auditItem(1, {
        action: "account.create",
        result: "failure",
        target: null,
        failureCategory: "validation_error",
        affectedCount: 12,
      }),
    ]);
    const row = await screen.findByRole("row", { name: /失敗/ });
    expect(within(row).getByText("アカウント登録")).toBeTruthy();
    expect(within(row).getByText(/validation_error/)).toBeTruthy();
    expect(within(row).getByText(/12/)).toBeTruthy();
    expect(within(row).queryByText(auditTargetName(1))).toBeNull();
    expect(
      within(row).queryByRole("button", { name: /この対象で絞り込む/ }),
    ).toBeNull();
  });

  it("#156 0-6 AC-5: 応答に detail・trace_id・秘密の値などが紛れていても、画面に出さない", async () => {
    const secret = "[E2E_TEST]plain-secret-value";
    const polluted = {
      ...auditItem(1),
      detail: { password: secret },
      traceId: "trace-should-not-appear",
      email: "testuser_156f@example.com",
    } as AuditItem;
    await openPage([polluted]);
    await rowWith(auditTargetName(1));
    expect(document.body.textContent).not.toContain(secret);
    expect(document.body.textContent).not.toContain("trace-should-not-appear");
    expect(document.body.textContent).not.toContain("@example.com");
  });
});

describe("#156 0-6 AC-3: 操作の種類の選択肢", () => {
  it("#156 0-6 AC-3: 先頭は「すべて」で、操作の一覧（AUDIT_ACTIONS）のすべてが、日本語の名前つきで選べる（値は操作の ID）", async () => {
    await openPage();
    const select = screen.getByLabelText("操作の種類");
    if (!(select instanceof HTMLSelectElement))
      throw new Error("操作の種類が選択欄ではありません");
    const options = [...select.options];
    expect(options[0]?.textContent?.trim()).toBe("すべて");
    expect(options[0]?.value).toBe("");
    const byValue = new Map(
      options.map((o) => [o.value, o.textContent?.trim()]),
    );
    for (const action of AUDIT_ACTIONS) {
      const label = byValue.get(action);
      expect(label, action).toBeTruthy();
      expect(label, action).not.toBe(action);
    }
    expect(byValue.get("account.create")).toBe("アカウント登録");
    expect(byValue.get("auth.login")).toBe("ログイン");
    expect(byValue.get("audit_log.view")).toBe("監査ログの閲覧");
    const labels = options.map((o) => o.textContent?.trim());
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("#156 0-6 AC-3: 結果の選択肢は すべて・成功・失敗", async () => {
    await openPage();
    const select = screen.getByLabelText("結果");
    if (!(select instanceof HTMLSelectElement))
      throw new Error("結果が選択欄ではありません");
    expect([...select.options].map((o) => o.textContent?.trim())).toEqual([
      "すべて",
      "成功",
      "失敗",
    ]);
  });
});

describe("#156 0-6 AC-3: 絞り込み", () => {
  it("#156 0-6 AC-3: 開くと絞り込みなしで1回検索する。入力しただけでは検索せず、「絞り込む」で期間・操作・結果を載せて検索する", async () => {
    const { calls, user } = await openPage();
    expect(calls[0]).not.toHaveProperty("action");
    expect(calls[0]).not.toHaveProperty("from");
    expect(calls[0]).not.toHaveProperty("cursor");

    fireEvent.change(screen.getByLabelText("開始日"), {
      target: { value: "2026-11-01" },
    });
    fireEvent.change(screen.getByLabelText("終了日"), {
      target: { value: "2026-11-16" },
    });
    await user.selectOptions(
      screen.getByLabelText("操作の種類"),
      "account.create",
    );
    await user.selectOptions(screen.getByLabelText("結果"), "失敗");
    expect(calls).toHaveLength(1); // 入力しただけでは送らない

    await user.click(screen.getByRole("button", { name: "絞り込む" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toMatchObject({
      from: "2026-11-01",
      to: "2026-11-16",
      action: "account.create",
      result: "failure",
    });
    expect(calls[1]).not.toHaveProperty("cursor");
  });

  it("#156 0-6 AC-3: 「すべて」「空の日付」は、本文に載せない", async () => {
    const { calls, user } = await openPage();
    await user.click(screen.getByRole("button", { name: "絞り込む" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    for (const key of [
      "from",
      "to",
      "action",
      "result",
      "actorId",
      "targetType",
      "targetId",
    ])
      expect(calls[1], key).not.toHaveProperty(key);
  });

  it("#156 0-6 AC-3: 開始日が終了日より後なら、入力欄の近くに文字で示し、検索しない。直すと検索できる", async () => {
    const { calls, user } = await openPage();
    fireEvent.change(screen.getByLabelText("開始日"), {
      target: { value: "2026-11-17" },
    });
    fireEvent.change(screen.getByLabelText("終了日"), {
      target: { value: "2026-11-16" },
    });
    await user.click(screen.getByRole("button", { name: "絞り込む" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/開始日.*終了日/);
    expect(calls).toHaveLength(1);

    fireEvent.change(screen.getByLabelText("開始日"), {
      target: { value: "2026-11-15" },
    });
    await user.click(screen.getByRole("button", { name: "絞り込む" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toMatchObject({ from: "2026-11-15", to: "2026-11-16" });
  });

  it("#156 0-6 AC-3: サーバーが 422（fields: to）を返したら、終了日の入力欄に誤りを示す", async () => {
    const calls = respondAuditSearch((_body, n) =>
      n === 1
        ? { items: [auditItem(1)], nextCursor: null }
        : HttpResponse.json(
            {
              code: "VALIDATION_ERROR",
              message: "入力内容を確かめてください",
              fields: ["to"],
            },
            { status: 422 },
          ),
    );
    const { user } = renderApp("/audit-logs");
    await rowWith(auditTargetName(1));
    fireEvent.change(screen.getByLabelText("終了日"), {
      target: { value: "2026-11-16" },
    });
    await user.click(screen.getByRole("button", { name: "絞り込む" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    await waitFor(() =>
      expect(screen.getByLabelText("終了日").getAttribute("aria-invalid")).toBe(
        "true",
      ),
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(
      screen.getByLabelText("開始日").getAttribute("aria-invalid"),
    ).not.toBe("true");
  });

  it("#156 0-6 AC-3: 行の「この人で絞り込む」で操作した人を指定し（「操作した人：○○」）、「絞り込む」で検索する。外すと、操作者の指定なしで検索する", async () => {
    const { calls, user } = await openPage([
      auditItem(1),
      auditItem(2, {
        actor: {
          id: auditActorId(2),
          displayName: auditActorName(2),
          isActive: true,
        },
        target: {
          type: "user",
          id: auditTargetId(2),
          label: auditTargetName(2),
          isActive: true,
        },
      }),
    ]);
    const row = await rowWith(auditActorName(2));
    await user.click(
      within(row).getByRole("button", { name: /この人で絞り込む/ }),
    );
    expect(screen.getByText(`操作した人：${auditActorName(2)}`)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "絞り込む" }));
    await waitFor(() =>
      expect(calls.at(-1)).toMatchObject({ actorId: auditActorId(2) }),
    );

    await user.click(
      screen.getByRole("button", { name: "操作した人の絞り込みを外す" }),
    );
    expect(screen.queryByText(`操作した人：${auditActorName(2)}`)).toBeNull();
    await user.click(screen.getByRole("button", { name: "絞り込む" }));
    await waitFor(() => expect(calls.at(-1)).not.toHaveProperty("actorId"));
  });

  it("#156 0-6 AC-3: 行の「この対象で絞り込む」で、対象の種類と ID を指定して検索できる（「対象：○○」・外せる）", async () => {
    const { calls, user } = await openPage();
    const row = await rowWith(auditTargetName(1));
    await user.click(
      within(row).getByRole("button", { name: /この対象で絞り込む/ }),
    );
    expect(screen.getByText(`対象：${auditTargetName(1)}`)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "絞り込む" }));
    await waitFor(() =>
      expect(calls.at(-1)).toMatchObject({
        targetType: "user",
        targetId: auditTargetId(1),
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "対象の絞り込みを外す" }),
    );
    await user.click(screen.getByRole("button", { name: "絞り込む" }));
    await waitFor(() => expect(calls.at(-1)).not.toHaveProperty("targetType"));
    expect(calls.at(-1)).not.toHaveProperty("targetId");
  });

  it("#156 0-6 AC-3: 操作者が不明の行には「この人で絞り込む」を、対象のない行には「この対象で絞り込む」を出さない", async () => {
    await openPage([auditItem(1, { actor: null, target: null })]);
    const row = await screen.findByRole("row", { name: /成功/ });
    expect(
      within(row).queryByRole("button", { name: /この人で絞り込む/ }),
    ).toBeNull();
    expect(
      within(row).queryByRole("button", { name: /この対象で絞り込む/ }),
    ).toBeNull();
  });
});

describe("#156 0-6 AC-3: ページ送り（さらに読み込む）", () => {
  it("#156 0-6 AC-3: 続きを読み込むと、前のページの行は残したまま、続きの行が下に足される。最後のページで「さらに読み込む」が消える", async () => {
    const calls = respondAuditSearch((_body, n) => {
      const item = (k: number) =>
        auditItem(k, {
          target: {
            type: "user",
            id: auditTargetId(k),
            label: auditTargetName(k),
            isActive: true,
          },
        });
      if (n === 1) return { items: [item(1)], nextCursor: "cursor-1" };
      if (n === 2) return { items: [item(2)], nextCursor: "cursor-2" };
      return { items: [item(3)], nextCursor: null };
    });
    const { user } = renderApp("/audit-logs");
    await rowWith(auditTargetName(1));
    await user.click(screen.getByRole("button", { name: "さらに読み込む" }));
    await rowWith(auditTargetName(2));
    expect(calls[1]).toMatchObject({ cursor: "cursor-1" });
    expect(
      screen.getByRole("row", { name: new RegExp(auditTargetName(1)) }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "さらに読み込む" }));
    await rowWith(auditTargetName(3));
    expect(calls[2]).toMatchObject({ cursor: "cursor-2" });
    expect(screen.queryByRole("button", { name: "さらに読み込む" })).toBeNull();
  });

  it("#156 0-6 AC-3: nextCursor が null なら、最初から「さらに読み込む」を出さない", async () => {
    await openPage();
    expect(screen.queryByRole("button", { name: "さらに読み込む" })).toBeNull();
  });

  it("#156 0-6 AC-3: 絞り込んだ後の「さらに読み込む」は、同じ絞り込み（action）と cursor で送る。絞り込みを変えた最初の検索には、前の cursor を載せない", async () => {
    const calls = respondAuditSearch((_body, n) => ({
      items: [auditItem(n)],
      nextCursor: n === 2 ? "cursor-after-filter" : null,
    }));
    const { user } = renderApp("/audit-logs");
    await screen.findByRole("heading", { name: "監査ログ" });
    await waitFor(() => expect(calls).toHaveLength(1));
    await user.selectOptions(
      screen.getByLabelText("操作の種類"),
      "account.create",
    );
    await user.click(screen.getByRole("button", { name: "絞り込む" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toMatchObject({ action: "account.create" });
    expect(calls[1]).not.toHaveProperty("cursor");
    await user.click(
      await screen.findByRole("button", { name: "さらに読み込む" }),
    );
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2]).toMatchObject({
      action: "account.create",
      cursor: "cursor-after-filter",
    });
  });

  it("#156 0-6 AC-3: 0件のときは「該当する記録はありません」を出し、「さらに読み込む」は出さない", async () => {
    await openPage([]);
    expect(await screen.findByText("該当する記録はありません")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "さらに読み込む" })).toBeNull();
  });
});

/** 手で解決できる保留（固定の時間の待ちを使わない） */
function deferred() {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe("#156 0-6 AC-3: 検索中の多重送信の防止", () => {
  it("#156 0-6 AC-3: 絞り込みの検索の応答を待つ間は「絞り込む」が無効で、押しても Enter で送っても要求が増えない。応答の後は、また押せる", async () => {
    const gate = deferred();
    const calls = respondAuditSearch(async (_body, n) => {
      if (n === 2) await gate.promise;
      return { items: [auditItem(n)], nextCursor: null };
    });
    const { user } = renderApp("/audit-logs");
    await rowWith(auditTargetName(1));

    const button = screen.getByRole("button", { name: "絞り込む" });
    await user.click(button);
    await waitFor(() => expect(calls).toHaveLength(2));
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(true));

    await user.click(button);
    await user.type(screen.getByLabelText("開始日"), "{Enter}");
    fireEvent.submit(screen.getByRole("form", { name: "絞り込み" }));
    expect(calls).toHaveLength(2);

    gate.release();
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    expect(calls).toHaveLength(2);
    await user.click(button);
    await waitFor(() => expect(calls).toHaveLength(3));
  });

  it("#156 0-6 AC-3: 画面を開いたときの最初の検索の応答を待つ間も、「絞り込む」は無効で、押しても要求が増えない", async () => {
    const gate = deferred();
    const calls = respondAuditSearch(async (_body, n) => {
      if (n === 1) await gate.promise;
      return { items: [auditItem(n)], nextCursor: null };
    });
    const { user } = renderApp("/audit-logs");
    await screen.findByRole("heading", { name: "監査ログ" });
    await waitFor(() => expect(calls).toHaveLength(1));
    const button = screen.getByRole("button", { name: "絞り込む" });
    expect(button.hasAttribute("disabled")).toBe(true);

    await user.click(button);
    fireEvent.submit(screen.getByRole("form", { name: "絞り込み" }));
    expect(calls).toHaveLength(1);

    gate.release();
    await rowWith(auditTargetName(1));
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    expect(calls).toHaveLength(1);
  });

  it("#156 0-6 AC-3: 「さらに読み込む」は、読み込み中は無効で、押しても要求が重ならない", async () => {
    const gate = deferred();
    const calls = respondAuditSearch(async (_body, n) => {
      if (n === 2) await gate.promise;
      return {
        items: [auditItem(n)],
        nextCursor: n === 1 ? "cursor-1" : null,
      };
    });
    const { user } = renderApp("/audit-logs");
    await rowWith(auditTargetName(1));
    const more = screen.getByRole("button", { name: "さらに読み込む" });
    await user.click(more);
    await waitFor(() => expect(calls).toHaveLength(2));
    await waitFor(() => expect(more.hasAttribute("disabled")).toBe(true));
    await user.click(more);
    expect(calls).toHaveLength(2);
    gate.release();
    await waitFor(() => expect(calls).toHaveLength(2));
  });
});

describe("#156 0-6 AC-3: エラーと自動の再取得", () => {
  it("#156 0-6 AC-1: 403 のときは「権限がありません」を示し、一覧は出さない", async () => {
    respondAuditSearch(() =>
      HttpResponse.json(
        { code: "FORBIDDEN", message: "この操作を行う権限がありません" },
        { status: 403 },
      ),
    );
    renderApp("/audit-logs");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/権限がありません/);
    expect(
      screen.queryByRole("row", { name: new RegExp(auditTargetName(1)) }),
    ).toBeNull();
  });

  it("#156 0-6 AC-3: そのほかの失敗は、一覧の上に role=alert と「再試行」を出し、押すと検索し直す（空の一覧にしない）", async () => {
    const calls = respondAuditSearch((_body, n) =>
      n === 1
        ? HttpResponse.json(
            { code: "INTERNAL", message: "失敗しました" },
            { status: 500 },
          )
        : { items: [auditItem(1)], nextCursor: null },
    );
    const { user } = renderApp("/audit-logs");
    const alert = await screen.findByRole("alert");
    expect(alert).toBeTruthy();
    expect(screen.queryByText("該当する記録はありません")).toBeNull();
    await user.click(screen.getByRole("button", { name: "再試行" }));
    await rowWith(auditTargetName(1));
    expect(calls).toHaveLength(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("#156 0-6 AC-6: 取得のたびに閲覧の記録が残るため、ウィンドウのフォーカスの復帰や再接続では、自動で検索し直さない", async () => {
    const { calls, client } = await openPage();
    const observers = client
      .getQueryCache()
      .findAll({ queryKey: auditLogKeys.all })
      .flatMap((query) => query.observers.map((o) => o.options));
    expect(observers.length).toBeGreaterThan(0);
    for (const options of observers) {
      expect(options.refetchOnWindowFocus).toBe(false);
      expect(options.refetchOnReconnect).toBe(false);
      expect(options.retry).toBe(false);
    }
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(screen.getByRole("table")).toBeTruthy());
    expect(calls).toHaveLength(1);
  });
});

describe("#156 0-6 AC-4: 変更・削除・書き出しの操作がない", () => {
  it("#156 0-6 AC-4: 変更・削除・書き出し（エクスポート・ダウンロード・CSV）のボタンもリンクもない", async () => {
    await openPage([
      auditItem(1),
      auditItem(2, {
        action: "audit_log.view",
        target: {
          type: "user",
          id: auditTargetId(2),
          label: auditTargetName(2),
          isActive: true,
        },
      }),
    ]);
    await rowWith(auditTargetName(1));
    const page = screen.getByRole("main");
    for (const role of ["button", "link"] as const)
      for (const element of within(page).queryAllByRole(role))
        expect(
          element.textContent ?? "",
          `${role}: ${element.textContent}`,
        ).not.toMatch(
          /削除|編集|変更|書き出|エクスポート|ダウンロード|CSV|出力|保存/,
        );
    expect(page.querySelector("a[download]")).toBeNull();
  });
});
