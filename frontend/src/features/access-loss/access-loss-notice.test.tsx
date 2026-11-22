// #338 AC-5（計画 plan-338 の 5-7・7-2 の U-14〜U-16b）：読み込み直した後の知らせ。保存するのは種類（lost・left）だけ。
// 保存先（sessionStorage）を使えない端末でも起動し、SecurityError 以外の例外は伝える。知らせは最初に確定した利用者にだけ出す。
// データはすべて架空（testuser_338_）。文言は受け入れ条件 AC-5 のもの（実装から写さない）。
// 前提にした口（実装の担当へ）：
//   openNoticeStorage(): Storage | null（参照が SecurityError のときだけ null）
//   writeAccessLossNotice(kind)：種類だけを書く
//   takeAccessLossNotice(queryClient): "lost" | "left" | null：読んで消し、この文書で出す知らせとして持つ（main.tsx が描画の前に呼ぶ）。
//     セッションのクエリを購読して、捨てる条件（5-7）を判定する
//   AccessLossNotice：props なし。QueryClientProvider の下に置く。「閉じる」のボタンを持つ
import {
  isCancelledError,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authKeys } from "../auth";
import {
  AccessLossNotice,
  openNoticeStorage,
  takeAccessLossNotice,
  writeAccessLossNotice,
} from ".";

const USER_A = "01JTESTUSER338A00000000001";
const USER_B = "01JTESTUSER338B00000000001";
const LOST_TEXT =
  "この案件を表示できなくなったため、画面を読み込み直しました。保存していない入力は消えています。";
const LEFT_TEXT = "案件から退出しました。";

function sessionOf(id: string) {
  return {
    user: { id, displayName: `testuser_338_${id.slice(-3)}`, loginId: id },
    permissions: [],
    mustChangePassword: false,
    reauthenticatedAt: null,
  };
}

function newClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderNotice(client: QueryClient) {
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <AccessLossNotice />
    </QueryClientProvider>,
  );
  return user;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("#338 AC-5 U-15 保存するのは種類だけ。読んだら消す", () => {
  it.each(["lost", "left"] as const)(
    "#338 AC-5 U-15: 種類（%s）を書くと、保存先は1件で、読むと同じ種類が返り、保存先から消える",
    (kind) => {
      writeAccessLossNotice(kind);
      expect(window.sessionStorage.length).toBe(1);
      expect(takeAccessLossNotice(newClient())).toBe(kind);
      expect(window.sessionStorage.length).toBe(0);
      // 2回目は何もない（同じ知らせを繰り返さない。AC-4）
      expect(takeAccessLossNotice(newClient())).toBeNull();
    },
  );

  it("#338 AC-5 U-15: 決めた種類以外の値は無視する（知らせを出さない）", () => {
    writeAccessLossNotice("lost");
    const key = window.sessionStorage.key(0);
    if (key === null) throw new Error("知らせが書かれていません");
    window.sessionStorage.setItem(key, "admin");
    const client = newClient();
    expect(takeAccessLossNotice(client)).toBeNull();
    client.setQueryData(authKeys.session, sessionOf(USER_A));
    renderNotice(client);
    expect(screen.queryByText(LOST_TEXT)).toBeNull();
    expect(screen.queryByText(LEFT_TEXT)).toBeNull();
    expect(screen.queryByText("admin")).toBeNull();
  });
});

describe("#338 AC-5 U-14 保存先を使えない端末でも起動する", () => {
  it("#338 AC-5 U-14: 保存先の参照が SecurityError なら null（例外を出さない）。知らせの読みも書きも例外を出さない", () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(openNoticeStorage()).toBeNull();
    expect(takeAccessLossNotice(newClient())).toBeNull();
  });

  it("#338 AC-5 U-14: 保存先の参照が SecurityError 以外の例外なら、伝える（もみ消さない）", () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new TypeError("[UNIT_TEST]想定外の失敗");
    });
    expect(() => openNoticeStorage()).toThrow(TypeError);
  });

  it("#338 AC-5 U-14: 読みが SecurityError なら知らせなし。SecurityError 以外は伝える", () => {
    writeAccessLossNotice("lost");
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });
    expect(takeAccessLossNotice(newClient())).toBeNull();
    getItem.mockImplementation(() => {
      throw new TypeError("[UNIT_TEST]想定外の失敗");
    });
    expect(() => takeAccessLossNotice(newClient())).toThrow(TypeError);
  });

  it("#338 AC-5 U-14: 消しが SecurityError なら知らせなし（消せない知らせを出し続けない）。SecurityError 以外は伝える", () => {
    writeAccessLossNotice("lost");
    const removeItem = vi
      .spyOn(Storage.prototype, "removeItem")
      .mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });
    expect(takeAccessLossNotice(newClient())).toBeNull();
    removeItem.mockImplementation(() => {
      throw new TypeError("[UNIT_TEST]想定外の失敗");
    });
    expect(() => takeAccessLossNotice(newClient())).toThrow(TypeError);
  });
});

describe("#338 AC-5 U-16 知らせは、最初に確定した利用者にだけ出す", () => {
  it.each([
    ["lost", LOST_TEXT],
    ["left", LEFT_TEXT],
  ] as const)(
    "#338 AC-5 U-16: 種類 %s の知らせを1回出し、「閉じる」で消える",
    async (kind, text) => {
      writeAccessLossNotice(kind);
      const client = newClient();
      takeAccessLossNotice(client);
      client.setQueryData(authKeys.session, sessionOf(USER_A));
      const user = renderNotice(client);
      expect(screen.getAllByText(text)).toHaveLength(1);
      await user.click(screen.getByRole("button", { name: "閉じる" }));
      expect(screen.queryByText(text)).toBeNull();
    },
  );

  it("#338 AC-5 U-16: セッションが無い間は出さず、最初の利用者が確定したら出す", () => {
    writeAccessLossNotice("lost");
    const client = newClient();
    takeAccessLossNotice(client);
    renderNotice(client);
    expect(screen.queryByText(LOST_TEXT)).toBeNull();
    act(() => {
      client.setQueryData(authKeys.session, sessionOf(USER_A));
    });
    expect(screen.getByText(LOST_TEXT)).toBeTruthy();
  });

  it("#338 AC-5 U-16: 最初に確定した利用者から別の利用者に替わったら出さず、元の利用者に戻っても出さない", () => {
    writeAccessLossNotice("lost");
    const client = newClient();
    takeAccessLossNotice(client);
    client.setQueryData(authKeys.session, sessionOf(USER_A));
    renderNotice(client);
    expect(screen.getByText(LOST_TEXT)).toBeTruthy();
    act(() => {
      client.setQueryData(authKeys.session, sessionOf(USER_B));
    });
    expect(screen.queryByText(LOST_TEXT)).toBeNull();
    act(() => {
      client.setQueryData(authKeys.session, sessionOf(USER_A));
    });
    expect(screen.queryByText(LOST_TEXT)).toBeNull();
  });

  it("#338 AC-5 U-16（境界）: 最初の利用者が確定した後に 401 → 同じ利用者が戻ったら、まだ出す（捨てるのは確定の前の未認証と、別の利用者だけ）", () => {
    writeAccessLossNotice("lost");
    const client = newClient();
    takeAccessLossNotice(client);
    client.setQueryData(authKeys.session, sessionOf(USER_A));
    renderNotice(client);
    act(() => {
      client.removeQueries({ queryKey: authKeys.session });
    });
    expect(screen.queryByText(LOST_TEXT)).toBeNull();
    act(() => {
      client.setQueryData(authKeys.session, sessionOf(USER_A));
    });
    expect(screen.getByText(LOST_TEXT)).toBeTruthy();
  });
});

describe("#338 AC-5 U-16b 最初のセッションの確認が成功する前の未認証で、知らせを捨てる", () => {
  it("#338 AC-5 U-16b: 知らせを読んだ文書で、最初のセッションの確認が 401（UNAUTHENTICATED）→ B がログイン：B に知らせを出さない", async () => {
    writeAccessLossNotice("lost");
    const client = newClient();
    takeAccessLossNotice(client);
    renderNotice(client);
    await act(async () => {
      await expect(
        client.fetchQuery({
          queryKey: authKeys.session,
          queryFn: () =>
            Promise.reject({
              status: 401,
              code: "UNAUTHENTICATED",
              message: "ログインしてください",
            }),
        }),
      ).rejects.toMatchObject({ status: 401 });
    });
    act(() => {
      client.setQueryData(authKeys.session, sessionOf(USER_B));
    });
    expect(screen.queryByText(LOST_TEXT)).toBeNull();
  });

  it("#338 AC-5 U-16b: 最初のセッションの確認の前に、セッションのクエリが消された（401 の共通の処理）→ ログイン：知らせを出さない", async () => {
    writeAccessLossNotice("left");
    const client = newClient();
    takeAccessLossNotice(client);
    renderNotice(client);
    // 最初のセッションの確認が、応答の前に（401 の共通の処理で）消される。取り除かれた取得は取り消される
    const firstCheck = client.fetchQuery({
      queryKey: authKeys.session,
      queryFn: () => new Promise<never>(() => undefined),
    });
    act(() => {
      client.removeQueries({ queryKey: authKeys.session });
    });
    // 取り除かれた最初の確認は、取り消し（CancelledError）で終わる
    await expect(firstCheck).rejects.toSatisfy(isCancelledError);
    act(() => {
      client.setQueryData(authKeys.session, sessionOf(USER_A));
    });
    expect(screen.queryByText(LEFT_TEXT)).toBeNull();
  });
});

// #340 AC-5 D-5（利用者の決定 Q3、計画レビュー2回目の軽微）：下書きを消せなかったときの知らせの種類 lostDraftsRemain・leftDraftsRemain。
// 文の全体は実装の担当が決めるため固定しない。役割（status）と、要点の語で確かめる：
//   もとの知らせの要点（lost は「読み込み直しました」、left は「退出しました」）に、「書きかけ」「残っている可能性」と、共用の端末向けの「サイトデータ」の削除の案内を足す。
//   「ログアウトすると消えます」とは言い切らない。
describe("#340 AC-5 D-5 下書きを消せなかったときの知らせ", () => {
  it.each([
    ["lostDraftsRemain", "読み込み直しました"],
    ["leftDraftsRemain", "退出しました"],
  ] as const)(
    "#340 AC-5 D-5: %s を書くと、読んで同じ種類が返り、役割 status で、もとの知らせの要点と、書きかけが残っている可能性・サイトデータの削除の案内を出す。「ログアウトすると消えます」とは言い切らない",
    (kind, base) => {
      writeAccessLossNotice(kind);
      expect(window.sessionStorage.length).toBe(1);
      const key = window.sessionStorage.key(0) ?? "";
      expect(window.sessionStorage.getItem(key)).toBe(kind);
      const client = newClient();
      client.setQueryData(authKeys.session, sessionOf(USER_A));
      expect(takeAccessLossNotice(client)).toBe(kind);
      renderNotice(client);
      const status = screen.getByRole("status");
      const text = status.textContent ?? "";
      expect(text).toContain(base);
      expect(text).toContain("書きかけ");
      expect(text).toContain("残っている可能性");
      expect(text).toContain("サイトデータ");
      expect(text).not.toContain("ログアウトすると消えます");
    },
  );

  it("#340 AC-5 D-5: 新しい種類でも、「閉じる」で消え、別の利用者に替わると出さない", async () => {
    writeAccessLossNotice("lostDraftsRemain");
    const client = newClient();
    client.setQueryData(authKeys.session, sessionOf(USER_A));
    takeAccessLossNotice(client);
    const user = renderNotice(client);
    expect(screen.getByRole("status").textContent).toContain("書きかけ");
    await user.click(screen.getByRole("button", { name: "閉じる" }));
    expect(screen.queryByRole("status")).toBeNull();

    writeAccessLossNotice("leftDraftsRemain");
    const other = newClient();
    other.setQueryData(authKeys.session, sessionOf(USER_A));
    takeAccessLossNotice(other);
    act(() => {
      other.setQueryData(authKeys.session, sessionOf(USER_B));
    });
    expect(screen.queryByText(/書きかけ/)).toBeNull();
  });
});

// #341（計画 plan-341 の 8-1 と 13 の T-N1）：取り違え（画面は A、Cookie は B。#298・#376）で読み込み直した場合の、いまの動きを既知の動きとして固定する。
// 保存先には種類だけがあり、書いた側の利用者を持たない（project-rules の #338 の項目）ため、新しい文書で最初に確定した利用者 B に lost が1回出る。
// 案件の中身は含まない。続けて別の利用者 C に替わると、既存の条件で捨てる。期待は計画 8-1 から独立に書く（回帰のテスト。実装の前から通る）。
describe("#341 T-N1 取り違えで読み込み直した後の知らせ（既知の動き）", () => {
  const USER_C = "01JTESTUSER341C00000000001";

  it("#341 T-N1: A の文書が lost を書く → 新しい文書の最初のセッションが B：lost の知らせが B に1回出る（中身は含まない）。続けて C に替わると消える", () => {
    // A の画面のタブ（Cookie は B）が、読み込み直す前に種類だけを書いた
    writeAccessLossNotice("lost");
    const client = newClient();
    expect(takeAccessLossNotice(client)).toBe("lost");
    act(() => {
      client.setQueryData(authKeys.session, sessionOf(USER_B));
    });
    renderNotice(client);
    expect(screen.getAllByText(LOST_TEXT)).toHaveLength(1);
    act(() => {
      client.setQueryData(authKeys.session, sessionOf(USER_C));
    });
    expect(screen.queryByText(LOST_TEXT)).toBeNull();
  });
});
