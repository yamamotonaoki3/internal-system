// #337 AC-4: 再認証の後も、ヘッダーの検索欄に入れた語が残ること（特性の固定。直す前から通る見込み）。
// 原因の確認（Issue #337 のコメント）：入力が入らなかったのは E2E の待ち方の弱さで、製品の不具合ではない。再認証の成功はセッションのキャッシュへの書き込みだけで、枠（AppShell）は作り直されない。
// ここでは、その性質を、本番と同じ組み立て（App の RequireAuth → ReauthProvider → AppShell）で固定する。AppShell と ReauthProvider だけを描画すると、次の退行を検出できない：
//   - 同じ利用者の再認証で RequireAuth の子の key が変わり、AppShell 以下が作り直される → SearchKeywordForm の useState が空に戻る
//   - 再認証の後にセッションを取り直し直して「確認中」へ差し替わり、AppShell が付け直される → 同じく空に戻る
// データはすべて架空（testuser_001・[E2E_TEST]・example.com）。
import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installDomStubs,
  renderApp,
  respondShellUser,
  SHELL_USER,
  type DomStubs,
} from "../../../test/app-shell-harness";
import { TEST_PASSWORD } from "../../../test/auth-handlers";
import { channelItem, respondChannels } from "../../../test/channel-handlers";
import { message, respondMessages } from "../../../test/message-handlers";
import { respondSearch } from "../../../test/search-handlers";
import { server } from "../../../test/server";

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
  respondShellUser();
});
afterEach(() => {
  stubs.restore();
  vi.restoreAllMocks();
});

const DELETED_TEXT = "このメッセージは削除されました";
const BODY = "[E2E_TEST]再認証の前後の投稿";
const KEYWORD = "見積書";
const room = channelItem("1", { name: "[E2E_TEST]全社連絡", joined: true });

function respondChannelDetail() {
  server.use(
    http.get("/api/channels/:channelId", ({ params }) =>
      HttpResponse.json({
        id: params.channelId,
        roomId: params.channelId,
        name: room.name,
        description: "テスト用",
        visibility: "public",
        departmentId: null,
        joined: true,
        isCaseChannel: false,
        caseId: null,
        version: 1,
        manage: {
          canRename: false,
          canEditDescription: false,
          canArchive: false,
        },
        canPost: true,
        readOnly: false,
        memberCount: 1,
        members: [{ id: SHELL_USER.id, displayName: SHELL_USER.displayName }],
      }),
    ),
  );
}

function respondReauth() {
  const passwords: string[] = [];
  server.use(
    http.post("/api/auth/reauthenticate", async ({ request }) => {
      passwords.push(((await request.json()) as { password: string }).password);
      return HttpResponse.json({ reauthenticatedAt: new Date().toISOString() });
    }),
  );
  return passwords;
}

describe("#337 AC-4 再認証の後も、ヘッダーの検索欄の語が残る（本番と同じ組み立て）", () => {
  it("#337 AC-4: 検索欄に語を入れ、メッセージの削除で再認証を通した後も、語がそのまま残り、「メッセージを検索」で /search?q=<その語> へ移る", async () => {
    const consoleError = vi.spyOn(console, "error");
    respondChannels([room]);
    respondChannelDetail();
    const state = respondMessages([
      message(1, {
        roomId: room.id,
        author: { id: SHELL_USER.id, displayName: SHELL_USER.displayName },
        body: BODY,
      }),
    ]);
    const passwords = respondReauth();
    const search = respondSearch([]);
    const { user } = renderApp(`/channels/${room.id}`);

    const form = await screen.findByRole("search", {
      name: "メッセージの検索",
    });
    const input = within(form).getByRole("searchbox", { name: "検索する言葉" });
    await user.type(input, KEYWORD);
    expect((input as HTMLInputElement).value).toBe(KEYWORD);

    // 削除の確認 → 再認証 → 削除の完了
    const log = await screen.findByRole("log");
    const row = await waitFor(() => {
      const found = within(log)
        .getAllByRole("listitem")
        .find((li) => (li.textContent ?? "").includes(BODY));
      if (found === undefined) throw new Error("投稿の行がありません");
      return found;
    });
    await user.click(within(row).getByRole("button", { name: "削除" }));
    const confirm = await screen.findByRole("dialog", {
      name: "メッセージの削除",
    });
    await user.click(within(confirm).getByRole("button", { name: "削除する" }));
    const reauth = await screen.findByRole("dialog", { name: "再認証" });
    await user.type(
      within(reauth).getByLabelText("パスワード", { exact: true }),
      TEST_PASSWORD,
    );
    await user.click(within(reauth).getByRole("button", { name: "再認証" }));

    // 今回の削除が終わったことを、削除の跡と、ダイアログが残っていないことで確かめる
    await waitFor(() =>
      expect(
        within(screen.getByRole("log")).getByText(DELETED_TEXT),
      ).toBeDefined(),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(passwords).toEqual([TEST_PASSWORD]);
    expect(state.deletes).toEqual([state.messages[0]?.id]);

    // 枠が作り直されていなければ、同じ入力欄に、入れた語が残っている
    const after = within(
      screen.getByRole("search", { name: "メッセージの検索" }),
    ).getByRole("searchbox", { name: "検索する言葉" });
    expect(after).toBe(input);
    expect((after as HTMLInputElement).value).toBe(KEYWORD);

    await user.click(
      within(
        screen.getByRole("search", { name: "メッセージの検索" }),
      ).getByRole("button", { name: "メッセージを検索" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toBe("/search"),
    );
    await waitFor(() =>
      expect(search.requests.map((r) => r.q)).toEqual([KEYWORD]),
    );
    expect(consoleError).not.toHaveBeenCalled();
  });
});
