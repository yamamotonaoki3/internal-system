// #206 AC-1・AC-2: 全体管理者が部署のオーナーになると専用チャンネルへ自動参加するため、
// 部署の作成・オーナー交代の成功後に、サイドバーの「参加中のチャンネル」（GET /api/channels?joined=true）を取り直す。
// サイドバーは常に表示されている想定で、画面の遷移で作り直されないよう Routes の外側（splat ルートの直下）に置く。
// 取り直しが無いと、再読込するまで自分が参加したチャンネルがサイドバーに出ない。
// データはすべて架空（[UNIT_TEST]・テスト用の ID）。
import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server";
import { installDomStubs, type DomStubs } from "../../test/app-shell-harness";
import {
  ADMIN,
  SALES,
  renderDepartments,
  respondDepartments,
} from "../../test/department-harness";
import { JoinedChannelsSection } from "../channels";
import { DepartmentCreateForm } from "./DepartmentCreateForm";
import { DepartmentsManager } from "./DepartmentsManager";

const NEW_CHANNEL_NAME = "[UNIT_TEST]自動参加で増えたチャンネル";

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
});
afterEach(() => {
  stubs.restore();
  vi.restoreAllMocks();
});

/** 参加中の一覧の模擬。最初の取得では空、2回目以降（書き込みの成功後の取り直し）は新しいチャンネルを返す */
function respondJoinedChannels() {
  const requests: URL[] = [];
  server.use(
    http.get("/api/channels", ({ request }) => {
      const url = new URL(request.url);
      requests.push(url);
      const id = "01JTESTCHAN000000000000A01";
      const items =
        requests.length >= 2
          ? [
              {
                id,
                roomId: id,
                name: NEW_CHANNEL_NAME,
                visibility: "public",
                departmentId: null,
                departmentName: null,
                joined: true,
              },
            ]
          : [];
      return HttpResponse.json({ items, nextCursor: null });
    }),
  );
  return {
    joinedRequests: () =>
      requests.filter((url) => url.searchParams.get("joined") === "true"),
  };
}

function renderWithSidebar(at: string) {
  return renderDepartments(
    [
      {
        path: "/*",
        element: (
          <>
            <JoinedChannelsSection linkClassName={() => ""} />
            <Routes>
              <Route
                path="/departments/new"
                element={<DepartmentCreateForm />}
              />
              <Route path="/departments" element={<DepartmentsManager />} />
            </Routes>
          </>
        ),
      },
    ],
    { at, reauthenticatedAt: new Date().toISOString() },
  );
}

describe("#206 AC-1・AC-2 部署の作成・オーナー交代の成功後に、参加中のチャンネルを取り直す", () => {
  it("#206 AC-1: 部署を作成すると、参加中のチャンネルが取り直され、増えたチャンネルがサイドバーに出る", async () => {
    respondDepartments();
    const channels = respondJoinedChannels();
    const { user } = renderWithSidebar("/departments/new");
    // 最初の取得（空）
    expect(
      await screen.findByText("参加中のチャンネルはありません"),
    ).toBeTruthy();
    expect(channels.joinedRequests()).toHaveLength(1);
    await user.type(
      screen.getByRole("textbox", { name: "部署名" }),
      "[[UNIT_TEST]新部署",
    );
    await user.click(screen.getByRole("button", { name: "作成" }));
    expect(
      await screen.findByRole("link", { name: NEW_CHANNEL_NAME }),
    ).toBeTruthy();
    expect(channels.joinedRequests().length).toBeGreaterThanOrEqual(2);
  });

  it("#206 AC-2: 全体管理者をオーナーに任命すると、参加中のチャンネルが取り直され、増えたチャンネルがサイドバーに出る", async () => {
    respondDepartments();
    const channels = respondJoinedChannels();
    const { user } = renderWithSidebar("/departments");
    expect(
      await screen.findByText("参加中のチャンネルはありません"),
    ).toBeTruthy();
    expect(channels.joinedRequests()).toHaveLength(1);
    const row = await screen.findByRole("row", {
      name: new RegExp(SALES.name.replace(/[[\]]/g, "\\$&")),
    });
    await user.click(
      within(row).getByRole("button", { name: "オーナーを変更" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "オーナーの変更",
    });
    await within(dialog).findByRole("option", { name: ADMIN.displayName });
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "新しいオーナー" }),
      ADMIN.id,
    );
    await user.click(within(dialog).getByRole("button", { name: "変更する" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "オーナーの変更" }),
      ).toBeNull(),
    );
    expect(
      await screen.findByRole("link", { name: NEW_CHANNEL_NAME }),
    ).toBeTruthy();
    expect(channels.joinedRequests().length).toBeGreaterThanOrEqual(2);
  });

  it("#206 AC-1・AC-2: 部署名の変更（改名）では、参加中のチャンネルを取り直さない（範囲外の挙動を変えない）", async () => {
    const departments = respondDepartments();
    const channels = respondJoinedChannels();
    const { user, client } = renderWithSidebar("/departments");
    expect(
      await screen.findByText("参加中のチャンネルはありません"),
    ).toBeTruthy();
    const row = await screen.findByRole("row", {
      name: new RegExp(SALES.name.replace(/[[\]]/g, "\\$&")),
    });
    await user.click(within(row).getByRole("button", { name: "名前を変更" }));
    const input = screen.getByRole("textbox", { name: "部署名" });
    await user.clear(input);
    await user.type(input, "[[UNIT_TEST]営業改");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(
      await screen.findByRole("row", { name: /\[UNIT_TEST\]営業改/ }),
    ).toBeTruthy();
    // 成功後の取り直し（一覧の再取得）が終わり、進行中の取得が無くなるまで待ってから、回数が増えていないことを確かめる
    await waitFor(() => {
      expect(departments.listCalls()).toBeGreaterThanOrEqual(2);
      expect(client.isFetching()).toBe(0);
    });
    expect(channels.joinedRequests()).toHaveLength(1);
  });
});
