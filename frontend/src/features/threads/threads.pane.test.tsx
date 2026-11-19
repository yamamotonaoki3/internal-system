// #137 AC-1（1-4 AC-1〜AC-3）: スレッド（返信）の領域 S-07（ThreadPane）。API は MSW。時間は必要なテストだけ fake timers で進める。データは架空。
// 契約（実装前の仮置き。計画 plan-137 と改訂1〜3。実装者へ）：
//   features/threads/index.ts が ThreadPane を公開する。props は { parentMessageId: string; retiredAuthorIds?: readonly string[] }（ルーターの中で使う）。
//   開いているスレッドは URL のクエリ ?thread=<親ID>（useThreadParam。features/threads。open(id)・close()・parentMessageId）。閉じると thread だけを外す。
//   領域は <section aria-label="スレッド"> で、見出し（h2「スレッド」。tabIndex=-1）を、読み込み中・失敗・0件・ありのどの状態でも出し、開いたときにフォーカスする。
//   「スレッドを閉じる」ボタン（見える文字は「閉じる」）で閉じる。閉じたらフォーカスは開いた要素（「返信 n 件」のボタン・一覧の行）へ戻る。
//   4つの状態：読み込み中（role=status「読み込み中です」）／取得に失敗（404 は <p>「スレッドが見つかりません」、それ以外は role=alert。0件とは出さず、入力欄も出さない）／
//     0件（「まだ返信はありません」）／あり（親の投稿と、返信の一覧 role=log・aria-label「返信一覧」）。
//   親は表示だけ（編集・削除は出さない）。削除済みの親は本文の代わりに「このメッセージは削除されました」。返信が削除済みのときも同じ。
//   返信の入力欄は MessageComposer を使い回し、名前「返信」の textbox と「送信」ボタン。送信は POST /api/messages/:親ID/replies { body } で、成功したら入力欄は空になり、
//     返信が再読み込みなしで一覧に出る。失敗は role=alert で出し、入力は残す。本文の規則（空白だけ・4,001文字以上は送らない）は部屋の投稿と同じ。
//   返信できない理由（replyBlockedReason）があるときは、入力欄の代わりに info の案内を出す（文言は下の BLOCKED_TEXT）。ポーリング（2秒）で理由が届いたら入力欄を閉じる。
//   自分の返信（作者が自分）には「編集」「削除」を、応答の joined && roomWritable が真のときだけ出す（replyBlockedReason には頼らない。
//     親が削除済みでも、部署が無効・DM の相手が無効なら roomWritable が偽で出さない）。他人の返信・親には出さない。
//   退職者：作者の isActive が偽、または retiredAuthorIds に含まれる作者の表示名に「（退職者）」を併記する。
//   既読：参加者（応答の joined が真。replyBlockedReason には頼らない）が、最新の返信を表示したら PUT /api/messages/:親ID/thread-read-position { lastReadMessageId: 最新の返信ID } を送る。
//     送った ID より新しい返信が表示されたら次を送る。返信が0件・参加していない（joined が偽）ときは送らない。失敗は
//     role=alert「既読の状態を更新できませんでした。…」を出す（部屋の既読と同じ）。
import { act, screen, waitFor, within } from "@testing-library/react";
import { http } from "msw";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiErrorResponse,
  message,
  reply,
  respondReplies,
  OTHER_AUTHOR,
} from "../../test/message-handlers";
import { server } from "../../test/server";
import { respondThreadReadOnly } from "../../test/thread-handlers";
import {
  SELF,
  renderInApp,
  renderPane,
  respondSelf,
} from "../../test/thread-harness";
import { ThreadPane } from "./index";

const PARENT = message(1, {
  body: "[E2E_TEST]親の投稿",
  author: OTHER_AUTHOR,
  replyCount: 2,
});
const mine = (n: number, body = `[E2E_TEST]自分の返信${n}`) =>
  reply(PARENT, n, {
    body,
    author: { id: SELF.id, displayName: SELF.displayName },
  });
const theirs = (n: number, body = `[E2E_TEST]他人の返信${n}`) =>
  reply(PARENT, n, { body, author: OTHER_AUTHOR });

const BLOCKED_TEXT: Record<string, string> = {
  deleted_parent: "元のメッセージが削除されたため、返信できません",
  not_joined: "このチャンネルに参加すると、返信できます",
  read_only: "このチャンネルは読み取り専用のため、返信できません",
  partner_inactive: "相手のアカウントが無効になっているため、返信できません",
  // #148（148-A）決定記録 C-184
  case_closed: "終了した案件のため、返信できません",
};
const DELETED_TEXT = "このメッセージは削除されました";

const pane = () => screen.getByRole("region", { name: "スレッド" });
const log = () => within(pane()).getByRole("log", { name: "返信一覧" });
const rows = () =>
  within(log())
    .getAllByRole("listitem")
    .filter((li) => li.parentElement?.closest("li") === null);
const rowWith = (text: string) => {
  const row = rows().find((li) => (li.textContent ?? "").includes(text));
  if (row === undefined) throw new Error(`「${text}」の返信の行がありません`);
  return row;
};
const box = () =>
  within(pane()).getByRole<HTMLTextAreaElement>("textbox", { name: "返信" });
const send = () => within(pane()).getByRole("button", { name: "送信" });
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  respondSelf();
  respondThreadReadOnly();
});

describe("#137 AC-1（1-4 AC-3）S-07 の4つの状態", () => {
  it("#137 AC-1（1-4 AC-3）: 読み込み中は「読み込み中です」（role=status）を出し、見出し「スレッド」はすでにある", async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get("/api/messages/:messageId/replies", async () => {
        await held;
        return apiErrorResponse(500, "INTERNAL");
      }),
    );
    renderPane(PARENT.id);
    expect(screen.getByRole("status").textContent).toBe("読み込み中です");
    expect(
      within(pane()).getByRole("heading", { name: "スレッド" }),
    ).toBeDefined();
    release();
    await screen.findByRole("alert");
  });

  it("#137 AC-1（1-4 AC-3）: 親の投稿と、返信を投稿の古い順に出す。返信の一覧は role=log", async () => {
    respondReplies({ parent: PARENT, replies: [theirs(1), mine(2)] });
    renderPane(PARENT.id);
    await within(
      await screen.findByRole("region", { name: "スレッド" }),
    ).findByRole("log", { name: "返信一覧" });
    expect(within(pane()).getByText("[E2E_TEST]親の投稿")).toBeDefined();
    expect(rows().map((li) => li.textContent)).toEqual([
      expect.stringContaining("[E2E_TEST]他人の返信1"),
      expect.stringContaining("[E2E_TEST]自分の返信2"),
    ]);
    expect(log().getAttribute("aria-live")).toBe("polite");
  });

  it("#137 AC-1（1-4 AC-3）: 返信が0件のときは「まだ返信はありません」を出し、入力欄は使える", async () => {
    respondReplies({ parent: message(1, { body: "[E2E_TEST]親の投稿" }) });
    renderPane(PARENT.id);
    expect(await screen.findByText("まだ返信はありません")).toBeDefined();
    expect(box()).toBeDefined();
  });

  it("#137 AC-1（1-4 AC-3）: 見つからない（404）ときは「スレッドが見つかりません」を出し、入力欄は出さない", async () => {
    server.use(
      http.get("/api/messages/:messageId/replies", () =>
        apiErrorResponse(404, "NOT_FOUND", "見つかりません"),
      ),
    );
    renderPane(PARENT.id);
    expect(await screen.findByText("スレッドが見つかりません")).toBeDefined();
    expect(within(pane()).queryByRole("textbox")).toBeNull();
    expect(screen.queryByText("まだ返信はありません")).toBeNull();
  });

  it("#137 AC-1（1-4 AC-3）: 取得に失敗（500）したときは role=alert に失敗を出し、0件とは出さず、入力欄も出さない", async () => {
    server.use(
      http.get("/api/messages/:messageId/replies", () =>
        apiErrorResponse(500, "INTERNAL", "エラーが発生しました"),
      ),
    );
    renderPane(PARENT.id);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("エラーが発生しました");
    expect(screen.queryByText("まだ返信はありません")).toBeNull();
    expect(within(pane()).queryByRole("textbox")).toBeNull();
  });
});

describe("#137 AC-1（1-4 AC-3）開く・閉じる・フォーカス", () => {
  it("#137 AC-1: 開いたとき、見出し「スレッド」へフォーカスが移る（読み込みの前から）", async () => {
    respondReplies({ parent: PARENT, replies: [theirs(1)] });
    renderPane(PARENT.id);
    const heading = within(pane()).getByRole("heading", { name: "スレッド" });
    expect(document.activeElement).toBe(heading);
    await within(pane()).findByRole("log", { name: "返信一覧" });
    expect(document.activeElement).toBe(heading);
  });

  it("#137 AC-1: 「スレッドを閉じる」で、URL のクエリ thread を外し、ほかのクエリは残す", async () => {
    respondReplies({ parent: PARENT, replies: [theirs(1)] });
    const { user } = renderPane(PARENT.id, {
      path: `/channels/room?tab=1&thread=${PARENT.id}`,
    });
    await within(pane()).findByRole("log", { name: "返信一覧" });
    await user.click(
      within(pane()).getByRole("button", { name: "スレッドを閉じる" }),
    );
    expect(screen.getByTestId("url").textContent).toBe("/channels/room?tab=1");
  });
});

describe("#137 AC-1（1-4 AC-1）退職者の併記", () => {
  it("#137 AC-1: 無効（isActive が偽）の作者・retiredAuthorIds の作者の表示名に「（退職者）」を併記し、有効な作者には付けない", async () => {
    const retiredA = {
      id: "01JTESTUSER000000000000009",
      displayName: "テスト退職者",
      isActive: false,
    };
    const partner = {
      id: "01JTESTUSER00000000000000A",
      displayName: "テスト相手",
    };
    respondReplies({
      parent: PARENT,
      replies: [
        reply(PARENT, 1, { author: retiredA, body: "[E2E_TEST]退職者の返信" }),
        reply(PARENT, 2, { author: partner, body: "[E2E_TEST]相手の返信" }),
        theirs(3),
      ],
    });
    renderPane(PARENT.id, { retiredAuthorIds: [partner.id] });
    await within(pane()).findByRole("log", { name: "返信一覧" });
    expect(rowWith("[E2E_TEST]退職者の返信").textContent).toContain(
      "（退職者）",
    );
    expect(rowWith("[E2E_TEST]相手の返信").textContent).toContain("（退職者）");
    expect(rowWith("[E2E_TEST]他人の返信3").textContent).not.toContain(
      "（退職者）",
    );
  });
});

describe("#137 AC-1（1-4 AC-1・AC-3）返信の投稿", () => {
  it("#137 AC-1（1-4 AC-3）: 送信すると POST され、入力欄が空になり、返信が再読み込みなしで一覧に出る", async () => {
    const state = respondReplies({ parent: PARENT, replies: [theirs(1)] });
    const { user } = renderPane(PARENT.id);
    await within(pane()).findByRole("log", { name: "返信一覧" });
    await user.type(box(), "[[E2E_TEST]新しい返信");
    await user.click(send());
    await waitFor(() =>
      expect(rows().map((li) => li.textContent)).toEqual([
        expect.stringContaining("[E2E_TEST]他人の返信1"),
        expect.stringContaining("[E2E_TEST]新しい返信"),
      ]),
    );
    expect(state.posts).toEqual(["[E2E_TEST]新しい返信"]);
    expect(box().value).toBe("");
  });

  it("#137 AC-1: Ctrl+Enter でも送れ、Enter だけでは送らず改行になる", async () => {
    const state = respondReplies({ parent: PARENT, replies: [theirs(1)] });
    const { user } = renderPane(PARENT.id);
    await within(pane()).findByRole("log", { name: "返信一覧" });
    await user.type(box(), "[[E2E_TEST]一行目{Enter}二行目");
    expect(state.posts).toEqual([]);
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(state.posts).toHaveLength(1));
    expect(state.posts[0]).toBe("[E2E_TEST]一行目\n二行目");
  });

  it("#137 AC-1: 空白だけ・4,001文字は送らず、入力欄を aria-invalid にする。4,000文字は送れる", async () => {
    const state = respondReplies({ parent: PARENT, replies: [theirs(1)] });
    const { user } = renderPane(PARENT.id);
    await within(pane()).findByRole("log", { name: "返信一覧" });
    await user.type(box(), "   ");
    await user.click(send());
    await waitFor(() =>
      expect(box().getAttribute("aria-invalid")).toBe("true"),
    );
    expect(state.posts).toEqual([]);

    const long = (n: number) => "あ".repeat(n);
    await user.clear(box());
    await user.click(box());
    await user.paste(long(4001));
    await user.click(send());
    await waitFor(() =>
      expect(box().getAttribute("aria-invalid")).toBe("true"),
    );
    expect(state.posts).toEqual([]);

    await user.clear(box());
    await user.click(box());
    await user.paste(long(4000));
    await user.click(send());
    await waitFor(() => expect(state.posts).toEqual([long(4000)]));
  });

  it("#137 AC-2（1-4 AC-2）: 送信が 409（親が削除された）で失敗したら、role=alert に出し、入力した本文は残す", async () => {
    const state = respondReplies({ parent: PARENT, replies: [theirs(1)] });
    state.failNextPost = { status: 409, code: "CONFLICT" };
    const { user } = renderPane(PARENT.id);
    await within(pane()).findByRole("log", { name: "返信一覧" });
    await user.type(box(), "[[E2E_TEST]遅れた返信");
    await user.click(send());
    const alert = await within(pane()).findByRole("alert");
    expect(alert.textContent).toContain("返信できませんでした");
    expect(box().value).toBe("[E2E_TEST]遅れた返信");
    expect(rows()).toHaveLength(1);
  });
});

describe("#137 AC-1（1-4 AC-1）自分の返信の編集・削除", () => {
  it("#137 AC-1: 自分の返信にだけ「編集」「削除」を出し、他人の返信・親には出さない", async () => {
    respondReplies({ parent: PARENT, replies: [theirs(1), mine(2)] });
    renderPane(PARENT.id);
    await within(pane()).findByRole("log", { name: "返信一覧" });
    expect(
      within(rowWith("自分の返信2")).getByRole("button", { name: "編集" }),
    ).toBeDefined();
    expect(
      within(rowWith("自分の返信2")).getByRole("button", { name: "削除" }),
    ).toBeDefined();
    expect(
      within(rowWith("他人の返信1")).queryByRole("button", { name: "編集" }),
    ).toBeNull();
    expect(
      within(rowWith("他人の返信1")).queryByRole("button", { name: "削除" }),
    ).toBeNull();
    // 親は表示だけ
    expect(
      within(pane()).getAllByRole("button", { name: "編集" }),
    ).toHaveLength(1);
  });

  it("#137 AC-1: 自分の返信を編集すると、PATCH され、再読み込みなしで新しい本文と「（編集済み）」が出る", async () => {
    const state = respondReplies({ parent: PARENT, replies: [mine(1)] });
    const { user } = renderPane(PARENT.id);
    await within(pane()).findByRole("log", { name: "返信一覧" });
    await user.click(
      within(rowWith("自分の返信1")).getByRole("button", { name: "編集" }),
    );
    const edit = within(pane()).getByRole<HTMLTextAreaElement>("textbox", {
      name: "メッセージの編集",
    });
    await user.clear(edit);
    await user.type(edit, "[[E2E_TEST]直した返信");
    await user.click(within(pane()).getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(rows()[0]?.textContent).toContain("[E2E_TEST]直した返信"),
    );
    expect(rows()[0]?.textContent).toContain("（編集済み）");
    expect(state.edits).toEqual([
      { messageId: mine(1).id, body: "[E2E_TEST]直した返信" },
    ]);
  });

  it("#137 AC-1: 自分の返信を削除すると、DELETE され、再読み込みなしで「このメッセージは削除されました」になる（返信の件数は減らさない）", async () => {
    const state = respondReplies({
      parent: PARENT,
      replies: [mine(1), theirs(2)],
    });
    const { user } = renderPane(PARENT.id);
    await within(pane()).findByRole("log", { name: "返信一覧" });
    await user.click(
      within(rowWith("自分の返信1")).getByRole("button", { name: "削除" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "メッセージの削除",
    });
    await user.click(within(dialog).getByRole("button", { name: "削除する" }));
    await waitFor(() => expect(rows()[0]?.textContent).toContain(DELETED_TEXT));
    expect(state.deletes).toEqual([mine(1).id]);
    expect(rows()).toHaveLength(2);
    expect(rowWith("他人の返信2")).toBeDefined();
  });

  it.each(["not_joined", "read_only", "partner_inactive"])(
    "#137 AC-1: 理由 %s のときは、自分の返信にも「編集」「削除」を出さない",
    async (reason) => {
      respondReplies({
        parent: PARENT,
        replies: [mine(1)],
        replyBlockedReason: reason,
        caseRoom: false,
        // 参加していないのは not_joined だけ（DM の相手が無効・読み取り専用でも、参加者）
        joined: reason !== "not_joined",
        // 書き込めないのは、未参加・読み取り専用・DM の相手が無効のすべて
        roomWritable: false,
      });
      renderPane(PARENT.id);
      await within(pane()).findByRole("log", { name: "返信一覧" });
      expect(within(pane()).queryByRole("button", { name: "編集" })).toBeNull();
      expect(within(pane()).queryByRole("button", { name: "削除" })).toBeNull();
    },
  );
});

describe("#137 AC-2（1-4 AC-2）返信できない理由と削除された親", () => {
  it("#137 AC-2: 親が削除されていると、親は「このメッセージは削除されました」、既存の返信は見え、入力欄の代わりに案内が出る", async () => {
    respondReplies({
      parent: { ...PARENT, deleted: true, body: null },
      replies: [theirs(1), mine(2)],
      replyBlockedReason: "deleted_parent",
      caseRoom: false,
    });
    renderPane(PARENT.id);
    await within(pane()).findByRole("log", { name: "返信一覧" });
    expect(within(pane()).getByText(DELETED_TEXT)).toBeDefined();
    expect(rowWith("他人の返信1")).toBeDefined();
    expect(rowWith("自分の返信2")).toBeDefined();
    expect(within(pane()).queryByRole("textbox")).toBeNull();
    expect(within(pane()).queryByRole("button", { name: "送信" })).toBeNull();
    expect(
      within(pane()).getByText(BLOCKED_TEXT.deleted_parent ?? ""),
    ).toBeDefined();
  });

  it("#148 5-1 AC-11・C-184: 理由 case_closed（終了した案件）のときは、入力欄を出さず、「終了した案件のため、返信できません」を出す。返信は読める", async () => {
    respondReplies({
      parent: PARENT,
      replies: [theirs(1)],
      replyBlockedReason: "case_closed",
      caseRoom: false,
      // 終了した案件の参加者（参加しているが、書き込めない）
      joined: true,
      roomWritable: false,
    });
    renderPane(PARENT.id);
    await within(pane()).findByRole("log", { name: "返信一覧" });
    expect(within(pane()).queryByRole("textbox")).toBeNull();
    expect(within(pane()).queryByRole("button", { name: "送信" })).toBeNull();
    expect(
      within(pane()).getByText(BLOCKED_TEXT.case_closed ?? ""),
    ).toBeDefined();
    expect(rowWith("他人の返信1")).toBeDefined();
  });

  it.each(["not_joined", "read_only", "partner_inactive"])(
    "#137 AC-1: 理由 %s のときは、入力欄を出さず、その理由の案内を出す",
    async (reason) => {
      respondReplies({
        parent: PARENT,
        replies: [theirs(1)],
        replyBlockedReason: reason,
        caseRoom: false,
        // 参加していないのは not_joined だけ（DM の相手が無効・読み取り専用でも、参加者）
        joined: reason !== "not_joined",
        // 書き込めないのは、未参加・読み取り専用・DM の相手が無効のすべて
        roomWritable: false,
      });
      renderPane(PARENT.id);
      await within(pane()).findByRole("log", { name: "返信一覧" });
      expect(within(pane()).queryByRole("textbox")).toBeNull();
      expect(within(pane()).queryByRole("button", { name: "送信" })).toBeNull();
      expect(
        within(pane()).getByText(BLOCKED_TEXT[reason] ?? ""),
      ).toBeDefined();
      // 読むことはできる
      expect(rowWith("他人の返信1")).toBeDefined();
    },
  );

  it("#137 AC-1: 返信できるとき（理由なし）は、案内を出さない", async () => {
    respondReplies({ parent: PARENT, replies: [theirs(1)] });
    renderPane(PARENT.id);
    await within(pane()).findByRole("log", { name: "返信一覧" });
    for (const text of Object.values(BLOCKED_TEXT))
      expect(screen.queryByText(text)).toBeNull();
  });
});

describe("#137 AC-4（1-4 AC-4）既読・編集・削除は joined で決める（理由ではなく）", () => {
  it("#137 AC-4: 参加していない公開チャンネル×削除済みの親（deleted_parent・joined 偽）では、既読を送らず、自分の返信に「編集」「削除」を出さず、既読の失敗も出さない", async () => {
    respondReplies({
      parent: { ...PARENT, deleted: true, body: null },
      replies: [theirs(1), mine(2)],
      replyBlockedReason: "deleted_parent",
      caseRoom: false,
      joined: false,
    });
    const puts = respondThreadReadOnly({ failStatus: 403 });
    renderPane(PARENT.id);
    await within(pane()).findByRole("log", { name: "返信一覧" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(puts).toEqual([]);
    expect(within(pane()).queryByRole("button", { name: "編集" })).toBeNull();
    expect(within(pane()).queryByRole("button", { name: "削除" })).toBeNull();
    expect(screen.queryByText(/既読の状態を更新できませんでした/)).toBeNull();
  });

  it.each([
    ["部署が無効（読み取り専用）のチャンネル", "deleted_parent"],
    ["DM の相手が無効", "deleted_parent"],
  ])(
    "#137 AC-4: 参加中×削除済みの親×%s（joined 真・roomWritable 偽）では、既読は送るが、自分の返信に「編集」「削除」を出さない",
    async (_label, reason) => {
      respondReplies({
        parent: { ...PARENT, deleted: true, body: null },
        replies: [theirs(1), mine(2)],
        replyBlockedReason: reason,
        caseRoom: false,
        joined: true,
        roomWritable: false,
      });
      const puts = respondThreadReadOnly();
      renderPane(PARENT.id);
      await within(pane()).findByRole("log", { name: "返信一覧" });
      await waitFor(() => expect(puts).toHaveLength(1));
      expect(puts[0]?.lastReadMessageId).toBe(mine(2).id);
      expect(within(pane()).queryByRole("button", { name: "編集" })).toBeNull();
      expect(within(pane()).queryByRole("button", { name: "削除" })).toBeNull();
    },
  );

  it("#137 AC-4: 参加中×削除済みの親（deleted_parent・joined 真）では、従来どおり最新の返信で既読を送り、自分の返信に「編集」「削除」を出す", async () => {
    respondReplies({
      parent: { ...PARENT, deleted: true, body: null },
      replies: [theirs(1), mine(2)],
      replyBlockedReason: "deleted_parent",
      caseRoom: false,
      joined: true,
    });
    const puts = respondThreadReadOnly();
    renderPane(PARENT.id);
    await within(pane()).findByRole("log", { name: "返信一覧" });
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({
      parentMessageId: PARENT.id,
      lastReadMessageId: mine(2).id,
    });
    expect(
      within(rowWith("自分の返信2")).getByRole("button", { name: "編集" }),
    ).toBeDefined();
    expect(
      within(rowWith("自分の返信2")).getByRole("button", { name: "削除" }),
    ).toBeDefined();
    expect(
      within(rowWith("他人の返信1")).queryByRole("button", { name: "編集" }),
    ).toBeNull();
  });
});

describe("#137 AC-2・AC-3 ポーリングで届く変化", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("#137 AC-3: 他の人の新しい返信が、2秒以内に再読み込みなしで出る", async () => {
    const state = respondReplies({ parent: PARENT, replies: [theirs(1)] });
    renderPane(PARENT.id, { fakeTimers: true });
    await within(pane()).findByRole("log", { name: "返信一覧" });
    state.replies.push(theirs(2));
    await advance(2500);
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows()[1]?.textContent).toContain("他人の返信2");
  });

  it("#137 AC-2: 開いている間に親が削除されると、2秒以内に入力欄を閉じて案内を出し、既存の返信は残す", async () => {
    const state = respondReplies({ parent: PARENT, replies: [theirs(1)] });
    renderPane(PARENT.id, { fakeTimers: true });
    await within(pane()).findByRole("log", { name: "返信一覧" });
    expect(box()).toBeDefined();
    state.parent = { ...state.parent, deleted: true, body: null };
    state.replyBlockedReason = "deleted_parent";
    await advance(2500);
    await waitFor(() =>
      expect(within(pane()).queryByRole("textbox")).toBeNull(),
    );
    expect(
      within(pane()).getByText(BLOCKED_TEXT.deleted_parent ?? ""),
    ).toBeDefined();
    expect(within(pane()).getByText(DELETED_TEXT)).toBeDefined();
    expect(rowWith("他人の返信1")).toBeDefined();
  });

  it("#137 AC-1: 親が編集されると、2秒以内に親の本文が変わる", async () => {
    const state = respondReplies({ parent: PARENT, replies: [theirs(1)] });
    renderPane(PARENT.id, { fakeTimers: true });
    await within(pane()).findByRole("log", { name: "返信一覧" });
    state.parent = { ...state.parent, body: "[E2E_TEST]編集後の親" };
    await advance(2500);
    await waitFor(() =>
      expect(within(pane()).getByText("[E2E_TEST]編集後の親")).toBeDefined(),
    );
  });
});

describe("#137 AC-4（1-4 AC-4）最新の返信を表示したらスレッドの既読を送る", () => {
  it("#137 AC-4: 開いて最新の返信が表示されたら、その ID で既読を1回送る（親の ID のパス）", async () => {
    respondReplies({ parent: PARENT, replies: [theirs(1), theirs(2)] });
    const puts = respondThreadReadOnly();
    renderPane(PARENT.id);
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({
      parentMessageId: PARENT.id,
      lastReadMessageId: theirs(2).id,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(puts).toHaveLength(1);
  });

  it("#137 AC-4: 開いている間に新しい返信が表示されたら、新しい最新の ID で次の既読を送る", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const state = respondReplies({ parent: PARENT, replies: [theirs(1)] });
      const puts = respondThreadReadOnly();
      renderPane(PARENT.id, { fakeTimers: true });
      await waitFor(() => expect(puts).toHaveLength(1));
      state.replies.push(theirs(2));
      await advance(2500);
      await waitFor(() => expect(puts).toHaveLength(2));
      expect(puts[1]?.lastReadMessageId).toBe(theirs(2).id);
    } finally {
      vi.useRealTimers();
    }
  });

  it("#137 AC-4: 自分の返信を投稿して最新の返信が替わったときも、その ID で既読を送る", async () => {
    respondReplies({ parent: PARENT, replies: [theirs(1)] });
    const puts = respondThreadReadOnly();
    const { user } = renderPane(PARENT.id);
    await waitFor(() => expect(puts).toHaveLength(1));
    await user.type(box(), "[[E2E_TEST]自分の新しい返信");
    await user.click(send());
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1]?.lastReadMessageId).not.toBe(theirs(1).id);
    expect(puts[1]?.lastReadMessageId > theirs(1).id).toBe(true);
  });

  it("#137 AC-4（1-1 AC-2・C-94）: 参加していない公開チャンネル（not_joined）では、読めても既読を送らない", async () => {
    respondReplies({
      parent: PARENT,
      replies: [theirs(1)],
      replyBlockedReason: "not_joined",
      caseRoom: false,
      joined: false,
      roomWritable: false,
    });
    const puts = respondThreadReadOnly();
    renderPane(PARENT.id);
    await within(pane()).findByRole("log", { name: "返信一覧" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(puts).toEqual([]);
  });

  it("#137 AC-4: 返信が0件のときは既読を送らない", async () => {
    respondReplies({ parent: message(1, { body: "[E2E_TEST]親の投稿" }) });
    const puts = respondThreadReadOnly();
    renderPane(PARENT.id);
    await screen.findByText("まだ返信はありません");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(puts).toEqual([]);
  });

  it("#137 AC-4: 既読の送信に失敗したら、role=alert に失敗と次の行動を出す（もみ消さない）", async () => {
    respondReplies({ parent: PARENT, replies: [theirs(1)] });
    respondThreadReadOnly({ failStatus: 500 });
    renderPane(PARENT.id);
    const alert = await screen.findByText(/既読の状態を更新できませんでした/);
    expect(alert.closest("[role='alert']")).not.toBeNull();
  });
});

describe("#137 AC-1 別のスレッドへ切り替える", () => {
  function Switcher({
    firstId,
    secondId,
  }: {
    firstId: string;
    secondId: string;
  }) {
    const [current, setCurrent] = useState(firstId);
    return (
      <>
        <button type="button" onClick={() => setCurrent(secondId)}>
          別のスレッドへ
        </button>
        <ThreadPane parentMessageId={current} />
      </>
    );
  }

  it("#137 AC-1: parentMessageId を替えると、前のスレッドの返信は出ず、新しいスレッドの返信が出る", async () => {
    const other = message(2, { body: "[E2E_TEST]別の親", replyCount: 1 });
    respondReplies({ parent: PARENT, replies: [theirs(1)] });
    respondReplies({
      parent: other,
      replies: [reply(other, 50, { body: "[E2E_TEST]別のスレッドの返信" })],
    });
    const { user } = renderInApp(
      <Switcher firstId={PARENT.id} secondId={other.id} />,
      { path: `/channels/room?thread=${PARENT.id}` },
    );
    await within(pane()).findByRole("log", { name: "返信一覧" });
    await user.click(screen.getByRole("button", { name: "別のスレッドへ" }));
    await waitFor(() =>
      expect(
        within(pane()).getByText("[E2E_TEST]別のスレッドの返信"),
      ).toBeDefined(),
    );
    expect(within(pane()).queryByText("[E2E_TEST]他人の返信1")).toBeNull();
  });
});
