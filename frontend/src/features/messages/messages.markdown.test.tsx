// #134 AC-2（1-5 AC-1〜AC-3）: 部屋のメッセージの一覧（RoomMessages）で、本文をマークダウンとして整形して出す。API は MSW。データは架空。
// 契約（実装前の仮置き。計画 plan-134 の「9. マークダウンの描画」「10. バンドル」・ADR-0026）：
//   一覧の各行の本文は MessageBody が出す。マークダウンの部品（MarkdownBody）は React.lazy で動的に読み込み、
//   読み込むまでは今の表示（文字のまま・whitespace-pre-wrap）にする。読み込んだ後は、外枠 class="markdown-body" の中に整形して出す。
//   入力欄（投稿・編集）にはプレビューを付けない。
// 動的読み込みを待つため、整形の結果は findBy・waitFor で待つ。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ROOM_ID, message, respondMessages } from "../../test/message-handlers";
import { RoomMessages } from "./index";

function renderRoom() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RoomMessages roomId={ROOM_ID} canPost joined />
    </QueryClientProvider>,
  );
}

const log = () => screen.getByRole("log");

describe("#134 AC-2（1-5 AC-1・AC-2）一覧の本文の整形", () => {
  it("#134 AC-2（1-5 AC-2）: 一覧の本文の記法を整形し、外枠 markdown-body の中に出す", async () => {
    respondMessages([
      message(1, {
        body: "[E2E_TEST]**太字の文字** と *斜体* と ~~取り消し~~ と `コード`",
      }),
      message(2, { body: "[E2E_TEST]箇条書き\n\n- 一つ目\n- 二つ目" }),
      message(3, { body: "[E2E_TEST][例のサイト](https://example.com)" }),
    ]);
    renderRoom();
    await screen.findByRole("log");
    await waitFor(() =>
      expect(log().querySelector(".markdown-body strong")?.textContent).toBe(
        "太字の文字",
      ),
    );
    expect(log().querySelector(".markdown-body em")?.textContent).toBe("斜体");
    expect(log().querySelector(".markdown-body del")?.textContent).toBe(
      "取り消し",
    );
    expect(log().querySelector(".markdown-body code")?.textContent).toBe(
      "コード",
    );
    expect(
      [...log().querySelectorAll(".markdown-body ul > li")].map((li) =>
        li.textContent?.trim(),
      ),
    ).toEqual(["一つ目", "二つ目"]);
    const link = within(log()).getByRole("link", { name: "例のサイト" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")?.split(/\s+/)).toEqual(
      expect.arrayContaining(["noopener", "noreferrer"]),
    );
    // 各行に外枠が1つずつ
    expect(log().querySelectorAll(".markdown-body")).toHaveLength(3);
  });

  it("#134 AC-2（1-5 AC-1・U-5）: 記法のない複数行の本文は、文字を失わず、改行を改行として出す", async () => {
    respondMessages([
      message(1, { body: "[E2E_TEST]一行目\n二行目" }),
      message(2, { body: "[E2E_TEST]**読み込みの確認**" }),
    ]);
    renderRoom();
    await screen.findByRole("log");
    await waitFor(() =>
      expect(log().querySelector(".markdown-body strong")).not.toBeNull(),
    );
    const bodies = log().querySelectorAll(".markdown-body");
    expect(bodies[0]?.querySelectorAll("br")).toHaveLength(1);
    expect(bodies[0]?.textContent?.replace(/\n/g, "")).toBe(
      "[E2E_TEST]一行目二行目",
    );
  });
});

describe("#134 AC-2（1-5 AC-3）一覧の本文の HTML・スクリプト", () => {
  it("#134 AC-2（1-5 AC-3・U-4）: 本文の HTML は実行される要素にせず、書いたままの文字で出す", async () => {
    const payloads = [
      "<img src=x onerror=alert(1)>",
      "<script>alert(1)</script>",
      '<iframe src="https://example.com"></iframe>',
      "<svg onload=alert(1)>",
      "[押す](javascript:alert(1))",
    ];
    respondMessages([
      ...payloads.map((payload, i) =>
        message(i + 1, { body: `[E2E_TEST]${payload}` }),
      ),
      message(9, { body: "[E2E_TEST]**読み込みの確認**" }),
    ]);
    const { container } = renderRoom();
    await screen.findByRole("log");
    // 動的読み込みが終わり、整形した表示に替わってから確かめる
    await waitFor(() =>
      expect(log().querySelector(".markdown-body strong")).not.toBeNull(),
    );
    expect(
      container.querySelector("script, img, iframe, svg, [onerror], [onload]"),
    ).toBeNull();
    expect(within(log()).queryByRole("link")).toBeNull();
    const text = log().textContent ?? "";
    for (const payload of payloads) expect(text).toContain(payload);
  });
});

describe("#134 AC-2（1-5 AC-2）入力欄にプレビューを付けない", () => {
  it("#134 AC-2（1-5 AC-2）: 投稿の入力欄に記法を書いても、整形したプレビューを出さない", async () => {
    respondMessages([]);
    const user = userEvent.setup();
    renderRoom();
    const box = await screen.findByRole("textbox", { name: "メッセージ" });
    await user.type(box, "**プレビューしない**");
    expect(document.querySelector("strong")).toBeNull();
    expect(screen.queryByText("プレビューしない")).toBeNull();
  });
});
