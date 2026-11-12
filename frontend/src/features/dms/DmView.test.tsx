// #136 AC-1（1-2 AC-1〜AC-4・AC-6）・AC-2（6-1 AC-1）・AC-3（C-168(2)(6)）: DM の画面 S-06（DmView）。API は MSW。データは架空。
// 時刻に依存するテスト（戻り予定の超過）は vi.useFakeTimers（Date だけ）で固定する。ポーリングは vi.useFakeTimers({ shouldAdvanceTime: true })。
// 契約（実装前の仮置き。引き継ぎに明記）：
//   <DmView roomId /> を features/dms/index.ts から公開する。GET /api/dms/:roomId で相手と canPost を取り、本体は RoomMessages（2秒ごとの取得）。
//   上部の相手：有効なら表示名（@ を付けてよい）のボタン（ProfileCardTrigger。popovertarget あり。カードに「DMを送る」は出さない）・部署名・StatusBadge
//     （ステータスの文字・「戻り予定：…」・超過なら「戻り予定を過ぎています」）。
//   相手が無効（isActive: false）：表示名を文字だけで出して「退職者」を併記し、ボタン・リンクを出さない。入力欄の代わりに
//     「相手のアカウントが無効になっているため、送信できません」を出す。相手のメッセージの投稿者にも「退職者」を併記する。
//   0件：「<相手の表示名> さんへの最初のメッセージを送りましょう。相手が不在でも、ログインしたときに読まれます」（空白の有無は問わない）。
//   詳細が 404：「見つかりません」を含む文を出し、一覧（role=log）も入力欄も出さない。詳細の取得の失敗（500）は role=alert。
//   投稿が 409：「相手のアカウントが無効になったため、送信できませんでした」を出し、詳細を取り直す（canPost が偽になれば入力欄を閉じる）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireToggle } from "../../test/app-shell-harness";
import {
  ANY_DM_BUTTON,
  DM_DEPT,
  dmDetail,
  dmRoomId,
  partnerId,
  partnerName,
  respondDms,
} from "../../test/dm-handlers";
import { message, respondMessages } from "../../test/message-handlers";
import { member, respondProfileWorld } from "../../test/profile-handlers";
import { server } from "../../test/server";
import { DmView } from "./index";

const ROOM = dmRoomId(1);
const NAME = partnerName(1);

function renderView() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/dms/${ROOM}`]}>
        <DmView roomId={ROOM} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, container: view.container };
}

const partnerButton = () =>
  screen.queryByRole("button", { name: new RegExp(NAME) });
const box = () => screen.queryByRole("textbox", { name: "メッセージ" });
const fromPartner = (n: number, body: string) =>
  message(n, { author: { id: partnerId(1), displayName: NAME }, body });

afterEach(() => {
  vi.useRealTimers();
});

describe("#136 AC-2（6-1 AC-1）上部の相手の表示", () => {
  it("#136 AC-2（6-1 AC-1）: 有効な相手は、表示名（カードを開くボタン）・部署・ステータス・戻り予定を出し、超過なら「戻り予定を過ぎています」を添える", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T03:00:00.000Z"));
    respondMessages([]);
    respondDms({
      details: [
        dmDetail(1, {
          partner: {
            status: {
              kind: "away",
              returnAt: "2026-11-12T02:59:59.000Z",
              message: null,
            },
          },
        }),
      ],
    });
    renderView();
    await waitFor(() => expect(partnerButton()).not.toBeNull());
    expect(partnerButton()?.getAttribute("popovertarget")).not.toBeNull();
    expect(screen.getByText(DM_DEPT.name)).toBeDefined();
    expect(screen.getByText("外出")).toBeDefined();
    expect(screen.getByText(/戻り予定：/)).toBeDefined();
    expect(screen.getByText("戻り予定を過ぎています")).toBeDefined();
    expect(document.body.textContent).not.toContain("退職者");
  });

  it("#136 AC-2（6-1 AC-1）: 戻り予定がまだ先なら、超過の表示は出さない", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T03:00:00.000Z"));
    respondMessages([]);
    respondDms({
      details: [
        dmDetail(1, {
          partner: {
            status: {
              kind: "meeting",
              returnAt: "2026-11-12T03:00:01.000Z",
              message: null,
            },
          },
        }),
      ],
    });
    renderView();
    expect(await screen.findByText("会議中")).toBeDefined();
    expect(screen.getByText(/戻り予定：/)).toBeDefined();
    expect(screen.queryByText("戻り予定を過ぎています")).toBeNull();
  });

  it("#136 AC-1（1-2 AC-4）: S-06 の相手のカードには「DMを送る」を出さない（今いる DM のため）", async () => {
    respondMessages([]);
    respondProfileWorld({
      members: [member(1, { id: partnerId(1), displayName: NAME })],
    });
    respondDms({ details: [dmDetail(1)] });
    renderView();
    await waitFor(() => expect(partnerButton()).not.toBeNull());
    const panelId = partnerButton()?.getAttribute("popovertarget") ?? "";
    const panel = document.getElementById(panelId);
    if (panel === null) throw new Error("カードの popover がありません");
    fireToggle(panel, "open");
    await within(panel).findByText("テスト本名001");
    expect(
      within(panel).queryByRole("button", { name: ANY_DM_BUTTON }),
    ).toBeNull();
  });
});

describe("#136 AC-1（1-2 AC-6）・AC-3（C-168(2)(6)）相手が無効な DM", () => {
  it("#136 AC-1（1-2 AC-6）: 相手の表示名に「退職者」を併記し、プロフィールのボタン・リンクと入力欄を出さず、送信できないことを知らせる", async () => {
    respondMessages([fromPartner(1, "[E2E_TEST]無効化の前の投稿")]);
    respondDms({
      details: [
        dmDetail(1, {
          partner: { isActive: false, status: null },
          canPost: false,
        }),
      ],
    });
    const { container } = renderView();
    expect(
      await screen.findByText(
        "相手のアカウントが無効になっているため、送信できません",
      ),
    ).toBeDefined();
    expect(partnerButton()).toBeNull();
    expect(screen.queryByRole("link", { name: new RegExp(NAME) })).toBeNull();
    expect(box()).toBeNull();
    // 上部（一覧の外）の相手の表示にも「退職者」が出る
    const logText = screen.queryByRole("log")?.textContent ?? "";
    const outsideLog = (container.textContent ?? "").replace(logText, "");
    expect(outsideLog).toContain(NAME);
    expect(outsideLog).toContain("退職者");
  });

  it("#136 AC-3（C-168(6)）・AC-1（1-2 AC-6）: 無効な相手の過去の投稿は、投稿時点の表示名に「退職者」を併記する", async () => {
    respondMessages([fromPartner(1, "[E2E_TEST]無効化の前の投稿")]);
    respondDms({
      details: [
        dmDetail(1, {
          partner: { isActive: false, status: null },
          canPost: false,
        }),
      ],
    });
    renderView();
    const log = await screen.findByRole("log");
    await within(log).findByText("[E2E_TEST]無効化の前の投稿");
    expect(log.textContent).toContain(NAME);
    expect(log.textContent).toContain("退職者");
  });

  it("#136 AC-3（C-168(6)）: 相手が有効なら、投稿者に「退職者」を併記しない", async () => {
    respondMessages([fromPartner(1, "[E2E_TEST]有効な相手の投稿")]);
    respondDms({ details: [dmDetail(1)] });
    renderView();
    const log = await screen.findByRole("log");
    await within(log).findByText("[E2E_TEST]有効な相手の投稿");
    expect(document.body.textContent).not.toContain("退職者");
  });

  it("#136 AC-3（C-168(2)）: 開いている間に相手が無効になり投稿が 409 になったら、知らせて詳細を取り直し、入力欄を閉じる", async () => {
    respondMessages([]);
    const world = respondDms({ details: [dmDetail(1)] });
    server.use(
      http.post("/api/rooms/:roomId/messages", () => {
        // サーバー側では、この時点で相手が無効になっている
        world.details.set(
          ROOM,
          dmDetail(1, {
            partner: { isActive: false, status: null },
            canPost: false,
          }),
        );
        return HttpResponse.json(
          { code: "CONFLICT", message: "送信できませんでした" },
          { status: 409 },
        );
      }),
    );
    renderView();
    const input = await screen.findByRole("textbox", { name: "メッセージ" });
    const before = world.detailRequests.length;
    fireEvent.change(input, { target: { value: "[E2E_TEST]届かない投稿" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    expect(
      await screen.findByText(
        "相手のアカウントが無効になったため、送信できませんでした",
      ),
    ).toBeDefined();
    await waitFor(() =>
      expect(world.detailRequests.length).toBeGreaterThan(before),
    );
    await waitFor(() => expect(box()).toBeNull());
    expect(
      await screen.findByText(
        "相手のアカウントが無効になっているため、送信できません",
      ),
    ).toBeDefined();
  });
});

describe("#136 AC-1（1-2 AC-1〜AC-3）やり取りと状態", () => {
  it("#136 AC-1（1-2 AC-3）: まだメッセージがなければ、相手の名前を入れた最初のメッセージの案内を出す", async () => {
    respondMessages([]);
    respondDms({ details: [dmDetail(1)] });
    renderView();
    const guide = await screen.findByText(/最初のメッセージを送りましょう/);
    expect(guide.textContent).toContain(NAME);
    expect(guide.textContent).toMatch(
      /相手が不在でも、ログインしたときに読まれます/,
    );
    expect(screen.queryByText("まだメッセージはありません")).toBeNull();
  });

  it("#136 AC-1（1-2 AC-1）: 有効な相手なら入力欄を出し、送った本文が再読み込みなしで一覧に出る", async () => {
    const state = respondMessages([]);
    respondDms({ details: [dmDetail(1)] });
    renderView();
    const input = await screen.findByRole("textbox", { name: "メッセージ" });
    fireEvent.change(input, { target: { value: "[E2E_TEST]こんにちは" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(state.posts).toEqual(["[E2E_TEST]こんにちは"]));
    const log = await screen.findByRole("log");
    expect(await within(log).findByText("[E2E_TEST]こんにちは")).toBeDefined();
  });

  it("#136 AC-1（1-2 AC-3）: 開いている間に相手が送ったメッセージが、2秒ごとの取得で再読み込みなしに出る", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const state = respondMessages([fromPartner(1, "[E2E_TEST]最初")]);
    respondDms({ details: [dmDetail(1)] });
    renderView();
    const log = await screen.findByRole("log");
    await within(log).findByText("[E2E_TEST]最初");
    state.messages.push(fromPartner(2, "[E2E_TEST]相手の新着"));
    await vi.advanceTimersByTimeAsync(2500);
    expect(await within(log).findByText("[E2E_TEST]相手の新着")).toBeDefined();
  });

  it("#136 AC-1（1-2 AC-2）: 詳細が 404（当事者でない・存在しない）なら「見つかりません」を出し、一覧も入力欄も出さない", async () => {
    respondMessages([message(1, { body: "[E2E_TEST]見えてはいけない" })]);
    respondDms({ details: [] });
    renderView();
    expect(await screen.findByText(/見つかりません/)).toBeDefined();
    expect(screen.queryByRole("log")).toBeNull();
    expect(box()).toBeNull();
    expect(screen.queryByText("[E2E_TEST]見えてはいけない")).toBeNull();
  });

  it("#136 AC-1（1-2 AC-2）: 詳細の取得に失敗（500）したら role=alert を出し、入力欄を出さない", async () => {
    respondMessages([]);
    server.use(
      http.get("/api/dms/:roomId", () =>
        HttpResponse.json(
          { code: "INTERNAL", message: "一時的なエラーが発生しました" },
          { status: 500 },
        ),
      ),
    );
    renderView();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "一時的なエラーが発生しました",
    );
    expect(box()).toBeNull();
  });

  it("#136 AC-1（1-2 AC-1）: 読み込み中は role=status で「読み込み中」を出す", async () => {
    respondMessages([]);
    server.use(http.get("/api/dms/:roomId", () => new Promise(() => {})));
    renderView();
    expect((await screen.findByRole("status")).textContent).toContain(
      "読み込み中",
    );
  });
});
