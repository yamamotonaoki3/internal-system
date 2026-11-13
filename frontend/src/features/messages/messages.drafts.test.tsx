// #239 AC-1〜AC-4・AC-6（1-1 AC-4・C-82・C-117）：メッセージの入力欄（RoomMessages の中の MessageComposer）の下書き。
// ルーターと離脱の確認の提供元（LeaveGuardProvider）なしで描画する（既存のテストと同じ）。離脱の確認は features/leave-guard/leave-guard.test.tsx。
// 契約（実装前の仮置き。計画 plan-239 と改訂1〜5）：
//   RoomMessages は auth の useSignedInUserId() で利用者IDを取り、入力欄を key=`${userId}:${roomId}`（ないときは anonymous:<roomId>）で作り直す。
//   入力のたびに localStorage の "internal-system:draft:v1:<userId>:room:<roomId>" に {"body","updatedAt"} を同期して書く。空白だけなら消す。
//   作り直すと復元する。送信の成功で消して空にする。失敗では残す。利用者IDがないときは読み書きせず、保存できない案内も出さない。
//   保存できない環境（localStorage の参照が SecurityError・setItem が QuotaExceededError）では、
//   入力欄の下に「この環境では下書きを一時保存できません。」（role="status"）を出し、送信はそのまま働く。
//   変更があるあいだは beforeunload を止める（提供元がなくても働く）。
// 期待値は本番の定義から作らず、キーの形と 7日 を独立に書く。データは架空。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ROOM_ID,
  apiErrorResponse,
  respondMessages,
} from "../../test/message-handlers";
import { server } from "../../test/server";
import { authKeys } from "../auth";
import { RoomMessages } from "./index";

const DAY = 24 * 60 * 60 * 1000;
const TTL = 7 * 24 * 60 * 60 * 1000;
const NOTICE = "この環境では下書きを一時保存できません。";

const USER_A = {
  id: "01JTESTUSER00000000000DA01",
  displayName: "testuser_draft_a",
  loginId: "testuser_draft_a",
};
const USER_B = {
  id: "01JTESTUSER00000000000DB01",
  displayName: "testuser_draft_b",
  loginId: "testuser_draft_b",
};
const sessionOf = (user: typeof USER_A) => ({
  user,
  permissions: [],
  mustChangePassword: false,
  reauthenticatedAt: null,
});

const keyOf = (userId: string, roomId = ROOM_ID) =>
  `internal-system:draft:v1:${userId}:room:${roomId}`;
const savedOf = (userId: string, roomId = ROOM_ID): unknown => {
  const raw = window.localStorage.getItem(keyOf(userId, roomId));
  return raw === null ? null : JSON.parse(raw);
};
const savedBody = (userId: string, roomId = ROOM_ID) => {
  const saved = savedOf(userId, roomId);
  return typeof saved === "object" && saved !== null && "body" in saved
    ? saved.body
    : null;
};

function newClient(user: typeof USER_A | null = USER_A) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  if (user !== null) client.setQueryData(authKeys.session, sessionOf(user));
  return client;
}

function renderRoom(client: QueryClient, roomId = ROOM_ID) {
  return render(
    <QueryClientProvider client={client}>
      <RoomMessages roomId={roomId} canPost joined />
    </QueryClientProvider>,
  );
}

const box = () =>
  screen.getByRole<HTMLTextAreaElement>("textbox", { name: "メッセージ" });

const original = Object.getOwnPropertyDescriptor(window, "localStorage");
afterEach(() => {
  if (original !== undefined)
    Object.defineProperty(window, "localStorage", original);
  vi.restoreAllMocks();
});

describe("#239 AC-1 保存と復元", () => {
  it("#239 AC-1: 入力すると端末に保存し、作り直すと復元する", async () => {
    respondMessages([]);
    const user = userEvent.setup();
    const before = Date.now();
    const first = renderRoom(newClient());
    await user.type(box(), "[[E2E_TEST]書きかけ");
    expect(savedOf(USER_A.id)).toEqual({
      body: "[E2E_TEST]書きかけ",
      updatedAt: expect.any(Number),
    });
    const saved = savedOf(USER_A.id) as { updatedAt: number };
    expect(saved.updatedAt).toBeGreaterThanOrEqual(before);
    expect(saved.updatedAt).toBeLessThanOrEqual(Date.now());
    first.unmount();

    renderRoom(newClient());
    expect(box().value).toBe("[E2E_TEST]書きかけ");
  });

  it("#239 AC-1: 下書きはサーバーへ送らない（送信を押すまで、読み取り以外の通信がない）", async () => {
    respondMessages([]);
    const sent: { method: string; body: string }[] = [];
    const listener = ({ request }: { request: Request }) => {
      const copy = request.clone();
      void copy
        .text()
        .then((body) => sent.push({ method: request.method, body }));
    };
    server.events.on("request:start", listener);
    try {
      const user = userEvent.setup();
      renderRoom(newClient());
      await user.type(box(), "[[E2E_TEST]送らない下書き");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(sent.filter((r) => r.method !== "GET")).toEqual([]);
      expect(sent.some((r) => r.body.includes("送らない下書き"))).toBe(false);
    } finally {
      server.events.removeListener("request:start", listener);
    }
  });

  it("#239 AC-1: 空白だけを入力したときは保存しない", async () => {
    respondMessages([]);
    const user = userEvent.setup();
    renderRoom(newClient());
    await user.type(box(), "   ");
    expect(window.localStorage.getItem(keyOf(USER_A.id))).toBeNull();
  });

  it("#239 AC-1: 入力を全部消すと、保存していた下書きも消える", async () => {
    respondMessages([]);
    const user = userEvent.setup();
    renderRoom(newClient());
    await user.type(box(), "[[E2E_TEST]x");
    expect(savedBody(USER_A.id)).toBe("[E2E_TEST]x");
    await user.clear(box());
    expect(window.localStorage.getItem(keyOf(USER_A.id))).toBeNull();
  });

  it("#239 AC-1: 別の部屋の下書きは、この部屋に復元しない", () => {
    respondMessages([]);
    window.localStorage.setItem(
      keyOf(USER_A.id, "01JTESTROOM00000000000OTHR"),
      JSON.stringify({ body: "[E2E_TEST]別の部屋", updatedAt: Date.now() }),
    );
    renderRoom(newClient());
    expect(box().value).toBe("");
  });
});

describe("#239 AC-2 利用者ごとの分離", () => {
  it("#239 AC-2: 同じ端末で別の利用者（B）が同じ部屋を開くと空で、A の下書きは残る", async () => {
    respondMessages([]);
    const user = userEvent.setup();
    const a = renderRoom(newClient(USER_A));
    await user.type(box(), "[[E2E_TEST]Aの書きかけ");
    a.unmount();

    renderRoom(newClient(USER_B));
    expect(box().value).toBe("");
    expect(savedBody(USER_A.id)).toBe("[E2E_TEST]Aの書きかけ");
  });

  it("#239 AC-2: 描画したままセッションが A→B に替わると、入力欄は空になり、A の本文は B のキーに書かれない", async () => {
    respondMessages([]);
    const user = userEvent.setup();
    const client = newClient(USER_A);
    renderRoom(client);
    await user.type(box(), "[[E2E_TEST]Aの書きかけ");
    act(() => {
      client.setQueryData(authKeys.session, sessionOf(USER_B));
    });
    await waitFor(() => expect(box().value).toBe(""));
    await user.type(box(), "[[E2E_TEST]Bの入力");
    expect(savedBody(USER_B.id)).toBe("[E2E_TEST]Bの入力");
    expect(savedBody(USER_A.id)).toBe("[E2E_TEST]Aの書きかけ");
  });

  it("#239 AC-2: ログイン中の利用者がわからない（セッションのキャッシュなし）ときは、読み書きせず、保存できない案内も出さない", async () => {
    respondMessages([]);
    window.localStorage.setItem(
      keyOf(USER_A.id),
      JSON.stringify({ body: "[E2E_TEST]Aの書きかけ", updatedAt: Date.now() }),
    );
    const user = userEvent.setup();
    renderRoom(newClient(null));
    expect(box().value).toBe("");
    await user.type(box(), "[[E2E_TEST]匿名の入力");
    expect(window.localStorage.length).toBe(1);
    expect(savedBody(USER_A.id)).toBe("[E2E_TEST]Aの書きかけ");
    expect(screen.queryByText(NOTICE)).toBeNull();
  });
});

describe("#239 AC-3 期限", () => {
  it("#239 AC-3: 最終編集から7日たった下書きは復元せず、端末から消す", () => {
    respondMessages([]);
    window.localStorage.setItem(
      keyOf(USER_A.id),
      JSON.stringify({ body: "[E2E_TEST]古い", updatedAt: Date.now() - TTL }),
    );
    renderRoom(newClient());
    expect(box().value).toBe("");
    expect(window.localStorage.getItem(keyOf(USER_A.id))).toBeNull();
  });

  it("#239 AC-3: 最終編集から6日の下書きは復元する", () => {
    respondMessages([]);
    window.localStorage.setItem(
      keyOf(USER_A.id),
      JSON.stringify({
        body: "[E2E_TEST]期限内",
        updatedAt: Date.now() - 6 * DAY,
      }),
    );
    renderRoom(newClient());
    expect(box().value).toBe("[E2E_TEST]期限内");
  });
});

describe("#239 AC-4 送信したときに消す", () => {
  it("#239 AC-4: 送信に成功すると下書きを消して空にし、作り直しても復元しない", async () => {
    const state = respondMessages([]);
    window.localStorage.setItem(
      keyOf(USER_A.id),
      JSON.stringify({ body: "[E2E_TEST]復元した", updatedAt: Date.now() }),
    );
    const user = userEvent.setup();
    const first = renderRoom(newClient());
    await user.type(box(), "の続き");
    await user.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() =>
      expect(state.posts).toEqual(["[E2E_TEST]復元したの続き"]),
    );
    await waitFor(() => expect(box().value).toBe(""));
    expect(window.localStorage.getItem(keyOf(USER_A.id))).toBeNull();
    first.unmount();
    renderRoom(newClient());
    expect(box().value).toBe("");
  });

  it.each([
    [
      "422（本文の誤り）",
      () =>
        apiErrorResponse(422, "VALIDATION_ERROR", "[UNIT_TEST]本文の誤り", {
          fields: ["body"],
        }),
    ],
    ["500", () => apiErrorResponse(500, "INTERNAL")],
  ])(
    "#239 AC-4: 送信が %s で失敗したときは、下書きも入力も残す",
    async (_l, response) => {
      let posts = 0;
      server.use(
        http.post("/api/rooms/:roomId/messages", () => {
          posts += 1;
          return response();
        }),
      );
      const user = userEvent.setup();
      renderRoom(newClient());
      await user.type(box(), "[[E2E_TEST]失敗する本文");
      const send = screen.getByRole<HTMLButtonElement>("button", {
        name: "送信",
      });
      await user.click(send);
      await waitFor(() => expect(posts).toBe(1));
      await waitFor(() => expect(send.disabled).toBe(false));
      expect(box().value).toBe("[E2E_TEST]失敗する本文");
      expect(savedBody(USER_A.id)).toBe("[E2E_TEST]失敗する本文");
    },
  );
});

describe("#239 AC-6 複数のタブ・部品", () => {
  it("#239 AC-6: 同じ下書きを2つの入力欄で編集すると、最後に書いた方が保存され、先の入力欄の表示は変わらない。作り直すと最後の値", async () => {
    respondMessages([]);
    const user = userEvent.setup();
    const client = newClient();
    const view = render(
      <QueryClientProvider client={client}>
        <RoomMessages roomId={ROOM_ID} canPost joined />
        <RoomMessages roomId={ROOM_ID} canPost joined />
      </QueryClientProvider>,
    );
    const [first, second] = screen.getAllByRole<HTMLTextAreaElement>(
      "textbox",
      { name: "メッセージ" },
    );
    if (first === undefined || second === undefined)
      throw new Error("入力欄が2つありません");
    await user.type(first, "[[E2E_TEST]先");
    await user.type(second, "[[E2E_TEST]後");
    expect(savedBody(USER_A.id)).toBe("[E2E_TEST]後");
    expect(first.value).toBe("[E2E_TEST]先");
    view.unmount();

    renderRoom(newClient());
    expect(box().value).toBe("[E2E_TEST]後");
  });

  it("#239 AC-6: 他のタブの保存（storage イベント）を、開いている入力欄に反映しない", async () => {
    respondMessages([]);
    const user = userEvent.setup();
    renderRoom(newClient());
    await user.type(box(), "[[E2E_TEST]このタブ");
    const other = JSON.stringify({
      body: "[E2E_TEST]他のタブ",
      updatedAt: Date.now(),
    });
    window.localStorage.setItem(keyOf(USER_A.id), other);
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: keyOf(USER_A.id),
          newValue: other,
          storageArea: window.localStorage,
        }),
      );
    });
    expect(box().value).toBe("[E2E_TEST]このタブ");
  });
});

describe("#239 AC-5 beforeunload（提供元なしでも働く）", () => {
  const fireBeforeUnload = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event;
  };

  it("#239 AC-5: 変更があるときは beforeunload を止め、下書きは消さない", async () => {
    respondMessages([]);
    const user = userEvent.setup();
    renderRoom(newClient());
    await user.type(box(), "[[E2E_TEST]書きかけ");
    expect(fireBeforeUnload().defaultPrevented).toBe(true);
    expect(savedBody(USER_A.id)).toBe("[E2E_TEST]書きかけ");
  });

  it("#239 AC-5: 変更がない・空白だけ・復元しただけのときは止めない", async () => {
    respondMessages([]);
    const user = userEvent.setup();
    const blank = renderRoom(newClient());
    expect(fireBeforeUnload().defaultPrevented).toBe(false);
    await user.type(box(), "  ");
    expect(fireBeforeUnload().defaultPrevented).toBe(false);
    blank.unmount();

    window.localStorage.setItem(
      keyOf(USER_A.id),
      JSON.stringify({ body: "[E2E_TEST]復元", updatedAt: Date.now() }),
    );
    renderRoom(newClient());
    expect(box().value).toBe("[E2E_TEST]復元");
    expect(fireBeforeUnload().defaultPrevented).toBe(false);
  });

  it("#239 AC-5: 入力欄がなくなると、beforeunload の購読も外れる", async () => {
    respondMessages([]);
    const user = userEvent.setup();
    const view = renderRoom(newClient());
    await user.type(box(), "[[E2E_TEST]書きかけ");
    view.unmount();
    expect(fireBeforeUnload().defaultPrevented).toBe(false);
  });
});

describe("#239 保存できない環境", () => {
  it("#239 AC-1: localStorage の参照が SecurityError のときは、入力欄の下に案内（role=status）を出し、送信はできる", async () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("使えません", "SecurityError");
      },
    });
    const state = respondMessages([]);
    const user = userEvent.setup();
    renderRoom(newClient());
    const notice = await screen.findByText(NOTICE);
    expect(notice.closest('[role="status"]')).not.toBeNull();
    // 入力欄の下に出す
    expect(
      box().compareDocumentPosition(screen.getByText(NOTICE)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await user.type(box(), "[[E2E_TEST]保存できない環境");
    await user.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() =>
      expect(state.posts).toEqual(["[E2E_TEST]保存できない環境"]),
    );
  });

  it("#239 AC-1: 書き込みが QuotaExceededError のときは、案内を出し、入力も送信も続けられる", async () => {
    const state = respondMessages([]);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("容量を超えました", "QuotaExceededError");
    });
    const user = userEvent.setup();
    renderRoom(newClient());
    expect(screen.queryByText(NOTICE)).toBeNull();
    await user.type(box(), "[[E2E_TEST]満杯");
    const notice = await screen.findByText(NOTICE);
    expect(notice.closest('[role="status"]')).not.toBeNull();
    expect(box().value).toBe("[E2E_TEST]満杯");
    await user.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(state.posts).toEqual(["[E2E_TEST]満杯"]));
  });

  it("#239 AC-4: 書き込みが QuotaExceededError になった後でも、送信に成功したら、前に保存できていた下書きが消える", async () => {
    const state = respondMessages([]);
    const user = userEvent.setup();
    renderRoom(newClient());
    await user.type(box(), "[[E2E_TEST]先に保存");
    expect(savedBody(USER_A.id)).toBe("[E2E_TEST]先に保存");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("容量を超えました", "QuotaExceededError");
    });
    await user.type(box(), "の続き");
    await screen.findByText(NOTICE);
    // 保存できなくなる前の下書きが、端末に残っている
    expect(savedBody(USER_A.id)).toBe("[E2E_TEST]先に保存");
    await user.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() =>
      expect(state.posts).toEqual(["[E2E_TEST]先に保存の続き"]),
    );
    await waitFor(() => expect(box().value).toBe(""));
    expect(window.localStorage.getItem(keyOf(USER_A.id))).toBeNull();
  });

  it("#239 AC-4: 書き込みが QuotaExceededError になった後に入力欄を空にしたら、前の下書きが消える", async () => {
    respondMessages([]);
    const user = userEvent.setup();
    renderRoom(newClient());
    await user.type(box(), "[[E2E_TEST]先に保存");
    expect(savedBody(USER_A.id)).toBe("[E2E_TEST]先に保存");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("容量を超えました", "QuotaExceededError");
    });
    await user.type(box(), "あ");
    await screen.findByText(NOTICE);
    await user.clear(box());
    expect(box().value).toBe("");
    expect(window.localStorage.getItem(keyOf(USER_A.id))).toBeNull();
  });

  it("#239 AC-5: 保存できない環境でも、変更があるときは beforeunload を止める", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("容量を超えました", "QuotaExceededError");
    });
    respondMessages([]);
    const user = userEvent.setup();
    renderRoom(newClient());
    await user.type(box(), "[[E2E_TEST]満杯");
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
