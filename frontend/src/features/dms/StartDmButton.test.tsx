// #136 AC-1（1-2 AC-1・AC-4）・AC-3（C-168(5)）: 「DMを送る」ボタン（StartDmButton）。S-05・S-20・S-27 から DM（S-06）を始める入口。API は MSW。データは架空。
// 契約（実装前の仮置き。引き継ぎに明記）：
//   <StartDmButton partnerUserId partnerDisplayName /> を features/dms/index.ts から公開する。表示の文字は「DMを送る」、
//   アクセシブルな名前は「<相手の表示名> さんに DMを送る」の button（コードレビュー1回目の指摘。同じ画面に何人分もあっても区別できる）。
//   名前には、見えている文字「DMを送る」をそのまま含める（コードレビュー2回目の指摘。WCAG 2.5.3 Label in Name。音声入力で「DMを送る」と言って押せる）。
//   押すと POST /api/dms { partnerUserId }。成功したら /dms/:roomId へ移り、DM のキー全体（dmKeys.all）を invalidate する。
//   送信中は押せない（二重に送らない）。失敗したら移らず、role=alert で API のメッセージを出す。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { dmItem, partnerId, respondDms } from "../../test/dm-handlers";
import { server } from "../../test/server";
import { DmSection, StartDmButton } from "./index";

function CurrentPath() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

function renderButton(options: { withSection?: boolean } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/members"]}>
        {options.withSection && (
          <nav aria-label="テスト用サイドバー">
            <DmSection linkClassName={() => ""} />
          </nav>
        )}
        <Routes>
          <Route
            path="/members"
            element={
              <StartDmButton
                partnerUserId={partnerId(2)}
                partnerDisplayName={PARTNER_NAME}
              />
            }
          />
          <Route path="/dms/:roomId" element={<p>DMの画面</p>} />
        </Routes>
        <CurrentPath />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user };
}

const path = () => screen.getByTestId("path").textContent;
const PARTNER_NAME = "テスト花子";
const BUTTON_NAME = "テスト花子 さんに DMを送る";

describe("#136 AC-1（1-2 AC-1・AC-4）StartDmButton", () => {
  it("#136 AC-1（1-2 AC-4）: アクセシブルな名前に相手の表示名を含める（「テスト花子 さんに DMを送る」）。表示の文字は「DMを送る」のまま", () => {
    respondDms({ items: [] });
    renderButton();
    const button = screen.getByRole("button", { name: BUTTON_NAME });
    expect(button.textContent).toBe("DMを送る");
  });

  it("#136 AC-1（1-2 AC-4）・WCAG 2.5.3（Label in Name）: アクセシブルな名前の中に、見えている文字「DMを送る」がそのまま含まれる", () => {
    respondDms({ items: [] });
    renderButton();
    const button = screen.getByRole("button", { name: /テスト花子/ });
    const visible = (button.textContent ?? "").trim();
    expect(visible).toBe("DMを送る");
    const accessibleName = button.getAttribute("aria-label") ?? visible;
    expect(accessibleName).toContain(visible);
  });

  it("#136 AC-1（1-2 AC-4）: 「DMを送る」を押すと相手の利用者IDで開始し、その DM（/dms/:roomId）へ移る", async () => {
    const world = respondDms({ items: [dmItem(2)] });
    const { user } = renderButton();
    await user.click(screen.getByRole("button", { name: BUTTON_NAME }));
    await waitFor(() => expect(path()).toBe(`/dms/${dmItem(2).roomId}`));
    expect(world.startBodies).toEqual([{ partnerUserId: partnerId(2) }]);
  });

  it("#136 AC-1（1-2 AC-1）・即時反映: 新しい相手と始めると、再読み込みせずにサイドバーの DM の欄に相手が出る", async () => {
    respondDms({ items: [], names: { [partnerId(2)]: "テスト新しい相手" } });
    const { user } = renderButton({ withSection: true });
    const nav = await screen.findByRole("navigation", {
      name: "テスト用サイドバー",
    });
    expect(nav.textContent).not.toContain("テスト新しい相手");
    await user.click(screen.getByRole("button", { name: BUTTON_NAME }));
    await waitFor(() => expect(nav.textContent).toContain("テスト新しい相手"));
  });

  it("#136 AC-1（1-2 AC-1）: 送信中は押せず、続けて押しても1回しか送らない", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const bodies: unknown[] = [];
    server.use(
      http.post("/api/dms", async ({ request }) => {
        bodies.push(await request.json());
        await gate;
        return HttpResponse.json({
          roomId: dmItem(2).roomId,
          partner: { id: partnerId(2), displayName: "テスト相手002" },
        });
      }),
    );
    const { user } = renderButton();
    const button = screen.getByRole("button", { name: BUTTON_NAME });
    await user.click(button);
    await waitFor(() =>
      expect((button as HTMLButtonElement).disabled).toBe(true),
    );
    await user.click(button);
    release?.();
    await waitFor(() => expect(path()).toBe(`/dms/${dmItem(2).roomId}`));
    expect(bodies).toHaveLength(1);
  });

  it.each([
    [422, "VALIDATION_ERROR", "このアカウントにはDMを送れません"],
    [404, "NOT_FOUND", "見つかりませんでした"],
  ])(
    "#136 AC-3（C-168(5)）: %i が返ったら移らず、エラーを知らせる",
    async (status, code, message) => {
      server.use(
        http.post("/api/dms", () =>
          HttpResponse.json({ code, message }, { status }),
        ),
      );
      const { user } = renderButton();
      await user.click(screen.getByRole("button", { name: BUTTON_NAME }));
      expect((await screen.findByRole("alert")).textContent).toContain(message);
      expect(path()).toBe("/members");
    },
  );
});
