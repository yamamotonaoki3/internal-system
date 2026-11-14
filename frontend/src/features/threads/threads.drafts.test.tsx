// #137 AC-1（1-4 AC-3・1-1 AC-4）: スレッドの返信の入力欄の下書き（端末への一時保存）と、画面を離れる前の確認。API は MSW。データは架空。
// 契約（実装前の仮置き。計画 plan-137 の「9. 画面」と改訂1の重大2。実装者へ）：
//   返信の入力欄（MessageComposer を使い回す）は、scope `thread:<roomId>:<親ID>`（threadDraftScope。roomId は取得した親の roomId）で、
//   localStorage の "internal-system:draft:v1:<利用者ID>:thread:<部屋ID>:<親ID>" に {"body","updatedAt"} を保存する（部屋の入力欄のキーには書かない）。
//   入力欄は key=`${利用者ID ?? "anonymous"}:thread:${部屋ID}:${親ID}` で作り直し、同じ部屋のスレッドを ?thread= だけ替えても、前のスレッドの入力・下書きを持ち越さない。
//   送信の成功で、そのスレッドの下書きだけを消して空にする。変更があるまま別の画面へ移るときは、部屋の入力欄と同じ確認（LeaveGuardProvider）を出し、
//   「破棄して離れる」はそのスレッドの下書きだけを消す。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createMemoryRouter,
  Link,
  Route,
  RouterProvider,
  Routes,
} from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ROOM_ID,
  message,
  reply,
  respondReplies,
  OTHER_AUTHOR,
} from "../../test/message-handlers";
import { respondThreadReadOnly } from "../../test/thread-handlers";
import {
  CurrentUrl,
  SELF,
  newClient,
  renderInApp,
  respondSelf,
} from "../../test/thread-harness";
import { LeaveGuardProvider } from "../leave-guard";
import { ThreadPane, useThreadParam } from "./index";

const PARENT_A = message(1, {
  body: "[E2E_TEST]親A",
  author: OTHER_AUTHOR,
  replyCount: 1,
});
const PARENT_B = message(2, {
  body: "[E2E_TEST]親B",
  author: OTHER_AUTHOR,
  replyCount: 1,
});
const replyOf = (parent: typeof PARENT_A, n: number) =>
  reply(parent, n, {
    author: OTHER_AUTHOR,
    body: `[E2E_TEST]親${parent.body?.slice(-1)}への返信`,
  });

const keyOf = (
  parentId: string,
  roomId: string = ROOM_ID,
  userId: string = SELF.id,
) => `internal-system:draft:v1:${userId}:thread:${roomId}:${parentId}`;
const roomKey = () => `internal-system:draft:v1:${SELF.id}:room:${ROOM_ID}`;
const putDraft = (parentId: string, body: string) =>
  window.localStorage.setItem(
    keyOf(parentId),
    JSON.stringify({ body, updatedAt: Date.now() }),
  );
const savedBody = (parentId: string): string | null => {
  const raw = window.localStorage.getItem(keyOf(parentId));
  if (raw === null) return null;
  const parsed: unknown = JSON.parse(raw);
  return typeof parsed === "object" && parsed !== null && "body" in parsed
    ? String(parsed.body)
    : null;
};

const pane = () => screen.getByRole("region", { name: "スレッド" });
const box = () =>
  within(pane()).getByRole<HTMLTextAreaElement>("textbox", { name: "返信" });
const send = () => within(pane()).getByRole("button", { name: "送信" });
const ready = () => within(pane()).findByRole("log", { name: "返信一覧" });

/** ?thread= の親 ID のスレッドを開く（アプリの ChannelDetailView と同じ使い方）。リンクで ?thread= だけを替えられる */
function ParamPane() {
  const { parentMessageId } = useThreadParam();
  return (
    <>
      <nav aria-label="テストのメニュー">
        <Link to={`?thread=${PARENT_A.id}`}>スレッドA</Link>
        <Link to={`?thread=${PARENT_B.id}`}>スレッドB</Link>
      </nav>
      {parentMessageId !== null && (
        <ThreadPane parentMessageId={parentMessageId} />
      )}
    </>
  );
}

function worlds() {
  const a = respondReplies({
    parent: PARENT_A,
    replies: [replyOf(PARENT_A, 1)],
  });
  const b = respondReplies({
    parent: PARENT_B,
    replies: [replyOf(PARENT_B, 2)],
  });
  return { a, b };
}

beforeEach(() => {
  respondSelf();
  respondThreadReadOnly();
});

describe("#137 AC-1（1-4 AC-3・1-1 AC-4）返信の下書き", () => {
  it("#137 AC-1: 入力すると scope thread:<部屋ID>:<親ID> のキーに保存し、部屋の入力欄のキーには書かない", async () => {
    worlds();
    const { user } = renderInApp(<ParamPane />, {
      path: `/channels/room?thread=${PARENT_A.id}`,
    });
    await ready();
    await user.type(box(), "[[E2E_TEST]書きかけの返信");
    expect(savedBody(PARENT_A.id)).toBe("[E2E_TEST]書きかけの返信");
    expect(
      JSON.parse(window.localStorage.getItem(keyOf(PARENT_A.id)) ?? "{}"),
    ).toEqual({
      body: "[E2E_TEST]書きかけの返信",
      updatedAt: expect.any(Number),
    });
    expect(window.localStorage.getItem(roomKey())).toBeNull();
    expect(window.localStorage.length).toBe(1);
  });

  it("#137 AC-1: 閉じて開き直す（作り直す）と、下書きが戻る", async () => {
    worlds();
    const first = renderInApp(<ParamPane />, {
      path: `/channels/room?thread=${PARENT_A.id}`,
    });
    await ready();
    await first.user.type(box(), "[[E2E_TEST]戻る下書き");
    first.unmount();

    renderInApp(<ParamPane />, {
      path: `/channels/room?thread=${PARENT_A.id}`,
    });
    await ready();
    expect(box().value).toBe("[E2E_TEST]戻る下書き");
  });

  it("#137 AC-1: 送信に成功すると、そのスレッドの下書きを消して空にし、作り直しても戻らない", async () => {
    const { a } = worlds();
    putDraft(PARENT_A.id, "[E2E_TEST]送る下書き");
    const first = renderInApp(<ParamPane />, {
      path: `/channels/room?thread=${PARENT_A.id}`,
    });
    await ready();
    expect(box().value).toBe("[E2E_TEST]送る下書き");
    await first.user.click(send());
    await waitFor(() => expect(a.posts).toEqual(["[E2E_TEST]送る下書き"]));
    await waitFor(() => expect(box().value).toBe(""));
    expect(window.localStorage.getItem(keyOf(PARENT_A.id))).toBeNull();
    first.unmount();

    renderInApp(<ParamPane />, {
      path: `/channels/room?thread=${PARENT_A.id}`,
    });
    await ready();
    expect(box().value).toBe("");
  });

  it("#137 AC-1: 送信に失敗したときは、下書きを残す", async () => {
    const { a } = worlds();
    a.failNextPost = { status: 500, code: "INTERNAL" };
    const { user } = renderInApp(<ParamPane />, {
      path: `/channels/room?thread=${PARENT_A.id}`,
    });
    await ready();
    await user.type(box(), "[[E2E_TEST]失敗しても残る");
    await user.click(send());
    await within(pane()).findByRole("alert");
    expect(savedBody(PARENT_A.id)).toBe("[E2E_TEST]失敗しても残る");
  });

  it("#137 AC-1: 別の利用者の同じスレッドの下書きは、復元しない", async () => {
    worlds();
    window.localStorage.setItem(
      keyOf(PARENT_A.id, ROOM_ID, "01JTESTUSER000000000000099"),
      JSON.stringify({ body: "[E2E_TEST]他人の下書き", updatedAt: Date.now() }),
    );
    renderInApp(<ParamPane />, {
      path: `/channels/room?thread=${PARENT_A.id}`,
    });
    await ready();
    expect(box().value).toBe("");
  });
});

describe("#137 AC-1 同じ部屋のスレッド A・B を ?thread= だけ替える（改訂1の重大2）", () => {
  it("#137 AC-1: A・B に別の下書きを保存し、?thread= だけを替えて往復しても混ざらない", async () => {
    worlds();
    putDraft(PARENT_A.id, "[E2E_TEST]Aの下書き");
    putDraft(PARENT_B.id, "[E2E_TEST]Bの下書き");
    const { user } = renderInApp(<ParamPane />, {
      path: `/channels/room?thread=${PARENT_A.id}`,
    });
    await ready();
    expect(box().value).toBe("[E2E_TEST]Aの下書き");

    await user.click(screen.getByRole("link", { name: "スレッドB" }));
    await waitFor(() => expect(box().value).toBe("[E2E_TEST]Bの下書き"));
    await user.click(screen.getByRole("link", { name: "スレッドA" }));
    await waitFor(() => expect(box().value).toBe("[E2E_TEST]Aの下書き"));
    await user.click(screen.getByRole("link", { name: "スレッドB" }));
    await waitFor(() => expect(box().value).toBe("[E2E_TEST]Bの下書き"));

    expect(savedBody(PARENT_A.id)).toBe("[E2E_TEST]Aの下書き");
    expect(savedBody(PARENT_B.id)).toBe("[E2E_TEST]Bの下書き");
  });

  it("#137 AC-1: A で入力した本文は、B に切り替えても B の下書きへ書かれず、B の入力欄は空で始まる", async () => {
    worlds();
    const { user } = renderInApp(<ParamPane />, {
      path: `/channels/room?thread=${PARENT_A.id}`,
    });
    await ready();
    await user.type(box(), "[[E2E_TEST]Aの入力");
    await user.click(screen.getByRole("link", { name: "スレッドB" }));
    await waitFor(() => expect(box().value).toBe(""));
    expect(savedBody(PARENT_A.id)).toBe("[E2E_TEST]Aの入力");
    expect(window.localStorage.getItem(keyOf(PARENT_B.id))).toBeNull();
    // B で入力しても、B のキーだけに書く
    await user.type(box(), "[[E2E_TEST]Bの入力");
    expect(savedBody(PARENT_B.id)).toBe("[E2E_TEST]Bの入力");
    expect(savedBody(PARENT_A.id)).toBe("[E2E_TEST]Aの入力");
  });

  it("#137 AC-1: A の入力のまま B へ切り替えて送っても、A の本文は B に送られない（B の入力欄の内容だけが B に送られる）", async () => {
    const { a, b } = worlds();
    putDraft(PARENT_B.id, "[E2E_TEST]Bの下書き");
    const { user } = renderInApp(<ParamPane />, {
      path: `/channels/room?thread=${PARENT_A.id}`,
    });
    await ready();
    await user.type(box(), "[[E2E_TEST]Aの入力");
    await user.click(screen.getByRole("link", { name: "スレッドB" }));
    await waitFor(() => expect(box().value).toBe("[E2E_TEST]Bの下書き"));
    await user.click(send());
    await waitFor(() => expect(b.posts).toEqual(["[E2E_TEST]Bの下書き"]));
    expect(a.posts).toEqual([]);
    // 送信・破棄は、対象のスレッド（B）の下書きだけに作用する。A の下書きは残る
    expect(window.localStorage.getItem(keyOf(PARENT_B.id))).toBeNull();
    expect(savedBody(PARENT_A.id)).toBe("[E2E_TEST]Aの入力");
  });

  it("#137 AC-1: B の下書きがないとき、A の入力のまま B で送信を押しても（空白だけ・空は送れず）A の本文は送られない", async () => {
    const { a, b } = worlds();
    const { user } = renderInApp(<ParamPane />, {
      path: `/channels/room?thread=${PARENT_A.id}`,
    });
    await ready();
    await user.type(box(), "[[E2E_TEST]Aの入力");
    await user.click(screen.getByRole("link", { name: "スレッドB" }));
    await waitFor(() => expect(box().value).toBe(""));
    await user.click(send());
    await waitFor(() =>
      expect(box().getAttribute("aria-invalid")).toBe("true"),
    );
    expect(b.posts).toEqual([]);
    expect(a.posts).toEqual([]);
  });
});

describe("#137 AC-1 変更があるまま別の画面へ移ると確認が出る", () => {
  const DIALOG_NAME = /入力した内容は失われます/;

  function renderGuarded() {
    const client: QueryClient = newClient();
    const router = createMemoryRouter(
      [
        {
          path: "*",
          element: (
            <LeaveGuardProvider>
              <Routes>
                <Route
                  path="/channels/room"
                  element={
                    <>
                      <nav aria-label="テストのメニュー">
                        <Link to="/other">別の画面</Link>
                      </nav>
                      <ParamPane />
                    </>
                  }
                />
                <Route path="/other" element={<p>別の画面です</p>} />
              </Routes>
              <CurrentUrl />
            </LeaveGuardProvider>
          ),
        },
      ],
      { initialEntries: [`/channels/room?thread=${PARENT_A.id}`] },
    );
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    return { user };
  }

  it("#137 AC-1: 変更があるときにリンクで別の画面へ移ろうとすると、移らずに確認を出し、「編集を続ける」で本文と下書きが残る", async () => {
    worlds();
    const { user } = renderGuarded();
    await ready();
    await user.type(box(), "[[E2E_TEST]書きかけ");
    await user.click(screen.getByRole("link", { name: "別の画面" }));
    expect(
      await screen.findByRole("dialog", { name: DIALOG_NAME }),
    ).toBeTruthy();
    expect(screen.getByTestId("url").textContent).toBe(
      `/channels/room?thread=${PARENT_A.id}`,
    );
    await user.click(screen.getByRole("button", { name: "編集を続ける" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: DIALOG_NAME })).toBeNull(),
    );
    expect(box().value).toBe("[E2E_TEST]書きかけ");
    expect(savedBody(PARENT_A.id)).toBe("[E2E_TEST]書きかけ");
  });

  it("#137 AC-1: 「破棄して離れる」は、このスレッドの下書きだけを消して移る（別のスレッドの下書きは残す）", async () => {
    worlds();
    putDraft(PARENT_B.id, "[E2E_TEST]Bの下書き");
    const { user } = renderGuarded();
    await ready();
    await user.type(box(), "[[E2E_TEST]Aの書きかけ");
    await user.click(screen.getByRole("link", { name: "別の画面" }));
    await user.click(
      await screen.findByRole("button", { name: "破棄して離れる" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("url").textContent).toBe("/other"),
    );
    expect(window.localStorage.getItem(keyOf(PARENT_A.id))).toBeNull();
    expect(savedBody(PARENT_B.id)).toBe("[E2E_TEST]Bの下書き");
  });

  it("#137 AC-1: 変更がない（復元しただけ・入力なし）ときは、確認を出さずに移れる", async () => {
    worlds();
    putDraft(PARENT_A.id, "[E2E_TEST]復元しただけ");
    const { user } = renderGuarded();
    await ready();
    expect(box().value).toBe("[E2E_TEST]復元しただけ");
    await user.click(screen.getByRole("link", { name: "別の画面" }));
    await waitFor(() =>
      expect(screen.getByTestId("url").textContent).toBe("/other"),
    );
    expect(screen.queryByRole("dialog", { name: DIALOG_NAME })).toBeNull();
    await act(async () => {});
  });
});
