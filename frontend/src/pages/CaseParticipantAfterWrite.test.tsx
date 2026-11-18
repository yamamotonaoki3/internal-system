// #147（147-B）コードレビュー1回目（重大1・軽微1）、5-1 AC-2・AC-3：参加者の変更の後に、閲覧の資格を失った人へ前の内容を出さないことと、
// 操作者が外された後の 403 の文が消えないこと。API は MSW で返し、保留は手で解決する Promise で行う（固定の時間の待ちは使わない）。データはすべて架空。
// 契約（統括の決定。実装の担当へ）：
//  - 退出の成功のとき、ページの側で、その案件の詳細のキャッシュを取り除き（進行中の取得も取り消す）、概要は非参加に更新するか取り除く。
//    同じ利用者が同じ案件に戻ったとき、再取得の応答を待つ間も、前の説明・参加者の一覧を出さない
//  - 追加・削除の結果のエラーの文は、詳細の閲覧の資格で破棄されないページの側で持つ。403 の後の取り直しで非参加になっても、
//    「参加者だけが操作できます」を role="alert" で、非公開の表示とあわせて出す
// 外された人が開き直したときに詳細の 403 の後に前の詳細が残らないことは、CaseDetailPage.test.tsx で確かめているので重ねない。
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { authKeys } from "../features/auth";
import { TEST_USER } from "../test/auth-handlers";
import {
  CASE_147B_TEXTS,
  PARTICIPANT_CREATOR,
  caseDetail,
  caseId,
  caseSummary,
  outsiderSummary,
  respondCaseWrites,
  respondUserSearch,
  type CaseParticipant,
} from "../test/case-handlers";
import { server } from "../test/server";
import { CaseDetailPage } from "./CaseDetailPage";

const N = 24;
const SECRET = "[UNIT_TEST]147B退出の前だけに見える説明";
const PRIVATE_TEXT = "参加者だけが見られます（非公開）";
const SELF: CaseParticipant = {
  userId: TEST_USER.id,
  displayName: TEST_USER.displayName,
  departmentName: null,
  isActive: true,
  isCreator: false,
  autoRole: null,
  removable: true,
};
const MEMBER: CaseParticipant = {
  userId: "01JTESTCASE147BPART00000MC",
  displayName: "testuser_147b_other_member",
  departmentName: null,
  isActive: true,
  isCreator: false,
  autoRole: null,
  removable: true,
};
const NEWCOMER = {
  id: "01JTESTCASE147BPART00000NC",
  displayName: "testuser_147b_after_new",
};

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

type State = {
  participant: boolean;
  participants: CaseParticipant[];
  gate: Promise<void> | null;
};

/** 状態で応答を変える概要・詳細。gate があれば、応答を保留する */
function respondByState(state: State) {
  server.use(
    http.get("/api/cases/:caseId/detail", async () => {
      if (state.gate !== null) await state.gate;
      return state.participant
        ? HttpResponse.json(
            caseDetail(N, {
              description: SECRET,
              participants: state.participants,
            }),
          )
        : HttpResponse.json(
            { code: "FORBIDDEN", message: PRIVATE_TEXT },
            { status: 403 },
          );
    }),
    http.get("/api/cases/:caseId", async () => {
      if (state.gate !== null) await state.gate;
      return HttpResponse.json(
        state.participant
          ? caseSummary(N, { participantCount: state.participants.length })
          : outsiderSummary(N),
      );
    }),
  );
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  const session = {
    user: TEST_USER,
    mustChangePassword: false,
    reauthenticatedAt: null,
    permissions: [],
  };
  client.setQueryData(authKeys.session, session);
  server.use(http.get("/api/auth/session", () => HttpResponse.json(session)));
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/cases/${caseId(N)}`]}>
        <Routes>
          <Route path="/cases/:caseId" element={<CaseDetailPage />} />
          <Route
            path="/cases"
            element={<Link to={`/cases/${caseId(N)}`}>案件に戻る</Link>}
          />
        </Routes>
        {/* 応答の前に画面を離れる操作（ブラウザーの「戻る」の代わり）。どの画面にも置く */}
        <Link to="/cases">一覧へ移る</Link>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user };
}

async function openManager(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "参加者を管理" }));
  return screen.findByRole("dialog", { name: "参加者を管理" });
}

const forbidden = () =>
  HttpResponse.json(
    { code: "FORBIDDEN", message: CASE_147B_TEXTS.participantsOnly },
    { status: 403 },
  );

describe("#147 147-B コードレビュー1回目（重大1）: 退出の後に前の詳細を出さない", () => {
  it("#147 5-1 AC-2・AC-3: 退出 → /cases → 同じ案件に戻ると、再取得を待つ間も前の説明・参加者の一覧を出さず、応答の後は非公開の表示", async () => {
    const state: State = {
      participant: true,
      participants: [PARTICIPANT_CREATOR, SELF],
      gate: null,
    };
    respondByState(state);
    respondCaseWrites(() => {
      state.participant = false;
      return new HttpResponse(null, { status: 204 });
    });
    const { user } = renderPage();
    expect(await screen.findByText(SECRET)).toBeTruthy();
    const manager = await openManager(user);
    const selfRow = within(manager)
      .getAllByRole("listitem")
      .find((row) => row.textContent?.includes(SELF.displayName));
    if (selfRow === undefined) throw new Error("本人の行がありません");
    await user.click(within(selfRow).getByRole("button", { name: "退出する" }));
    const confirm = await screen.findByRole("dialog", {
      name: "案件からの退出",
    });
    await user.click(within(confirm).getByRole("button", { name: "退出する" }));
    const back = await screen.findByRole("link", { name: "案件に戻る" });

    const gate = deferred();
    state.gate = gate.promise;
    await user.click(back);
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "案件に戻る" })).toBeNull(),
    );
    expect(screen.queryByText(SECRET)).toBeNull();
    expect(screen.queryByRole("list", { name: "参加者" })).toBeNull();

    gate.release();
    state.gate = null;
    expect(await screen.findByText(PRIVATE_TEXT)).toBeTruthy();
    expect(screen.queryByText(SECRET)).toBeNull();
    expect(screen.queryByRole("list", { name: "参加者" })).toBeNull();
  });

  it("#147 5-1 AC-3（退行なし）: ほかの人を削除したときは、自分は参加者のままで、詳細が取り直されて、削除した人が一覧から消える", async () => {
    const state: State = {
      participant: true,
      participants: [PARTICIPANT_CREATOR, SELF, MEMBER],
      gate: null,
    };
    respondByState(state);
    respondCaseWrites(() => {
      state.participants = [PARTICIPANT_CREATOR, SELF];
      return new HttpResponse(null, { status: 204 });
    });
    const { user } = renderPage();
    const manager = await openManager(user);
    await user.click(
      within(manager).getByRole("button", {
        name: `${MEMBER.displayName}を削除`,
      }),
    );
    const confirm = await screen.findByRole("dialog", { name: "参加者の削除" });
    await user.click(within(confirm).getByRole("button", { name: "削除する" }));
    const list = await screen.findByRole("list", { name: "参加者" });
    await waitFor(() =>
      expect(list.textContent).not.toContain(MEMBER.displayName),
    );
    expect(screen.getByText(SECRET)).toBeTruthy();
  });
});

describe("#147 147-B コードレビュー2回目（重大）: 退出の応答の前に画面を離れても、前の詳細を残さない", () => {
  /** 退出を送り、応答を保留したまま /cases へ移る。release で応答を返す */
  async function leaveThenNavigate(respond: () => Response) {
    const state: State = {
      participant: true,
      participants: [PARTICIPANT_CREATOR, SELF],
      gate: null,
    };
    respondByState(state);
    const pending = deferred();
    let answered = false;
    respondCaseWrites(async () => {
      await pending.promise;
      answered = true;
      const res = respond();
      if (res.status === 204) state.participant = false;
      return res;
    });
    const { user } = renderPage();
    expect(await screen.findByText(SECRET)).toBeTruthy();
    const manager = await openManager(user);
    const selfRow = within(manager)
      .getAllByRole("listitem")
      .find((row) => row.textContent?.includes(SELF.displayName));
    if (selfRow === undefined) throw new Error("本人の行がありません");
    await user.click(within(selfRow).getByRole("button", { name: "退出する" }));
    const confirm = await screen.findByRole("dialog", {
      name: "案件からの退出",
    });
    await user.click(within(confirm).getByRole("button", { name: "退出する" }));
    // 応答の前に画面を離れる
    await user.click(screen.getByRole("link", { name: "一覧へ移る" }));
    const back = await screen.findByRole("link", { name: "案件に戻る" });
    expect(answered).toBe(false);
    pending.release();
    await waitFor(() => expect(answered).toBe(true));
    return { user, state, back };
  }

  it("#147 5-1 AC-2・AC-3: 退出の成功が画面を離れた後に返っても、同じ案件に戻ったとき、再取得を待つ間に前の説明・参加者の一覧を出さず、応答の後は非公開の表示", async () => {
    const { user, state, back } = await leaveThenNavigate(
      () => new HttpResponse(null, { status: 204 }),
    );
    const gate = deferred();
    state.gate = gate.promise;
    await user.click(back);
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "案件に戻る" })).toBeNull(),
    );
    expect(screen.queryByText(SECRET)).toBeNull();
    expect(screen.queryByRole("list", { name: "参加者" })).toBeNull();
    state.gate = null;
    gate.release();
    expect(await screen.findByText(PRIVATE_TEXT)).toBeTruthy();
    expect(screen.queryByText(SECRET)).toBeNull();
  });

  it("#147 5-1 AC-3（対）: 退出が画面を離れた後に 409 で失敗したら、参加者のままなので、戻ったときに説明と参加者の一覧が見られる", async () => {
    const { user, back } = await leaveThenNavigate(() =>
      HttpResponse.json(
        {
          code: "CONFLICT",
          message: "最後の参加者は退出できません（[UNIT_TEST]）",
          reason: "last_active_participant",
        },
        { status: 409 },
      ),
    );
    await user.click(back);
    expect(await screen.findByRole("list", { name: "参加者" })).toBeTruthy();
    expect(screen.getByText(SECRET)).toBeTruthy();
    expect(screen.queryByText(PRIVATE_TEXT)).toBeNull();
  });
});

describe("#147 147-B コードレビュー1回目（軽微）: 操作者が外された後の 403 の文を消さない", () => {
  it("#147 5-1 AC-3: 削除が 403 を返し、取り直しで非参加・詳細 403 になっても、「参加者だけが操作できます」を role=alert で、非公開の表示とあわせて出す", async () => {
    const state: State = {
      participant: true,
      participants: [PARTICIPANT_CREATOR, SELF, MEMBER],
      gate: null,
    };
    respondByState(state);
    respondCaseWrites(() => {
      state.participant = false;
      return forbidden();
    });
    const { user } = renderPage();
    const manager = await openManager(user);
    await user.click(
      within(manager).getByRole("button", {
        name: `${MEMBER.displayName}を削除`,
      }),
    );
    const confirm = await screen.findByRole("dialog", { name: "参加者の削除" });
    await user.click(within(confirm).getByRole("button", { name: "削除する" }));
    expect(await screen.findByText(PRIVATE_TEXT)).toBeTruthy();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(CASE_147B_TEXTS.participantsOnly);
    expect(screen.queryByText(SECRET)).toBeNull();
  });

  it("#147 5-1 AC-3: 追加が 403 を返し、取り直しで非参加・詳細 403 になっても、「参加者だけが操作できます」を role=alert で出す", async () => {
    const state: State = {
      participant: true,
      participants: [PARTICIPANT_CREATOR, SELF],
      gate: null,
    };
    respondByState(state);
    respondUserSearch([[NEWCOMER]]);
    respondCaseWrites(() => {
      state.participant = false;
      return forbidden();
    });
    const { user } = renderPage();
    const manager = await openManager(user);
    await user.type(
      within(manager).getByRole("textbox", { name: "社員の検索" }),
      "147b",
    );
    await user.click(
      await within(manager).findByRole("button", {
        name: `${NEWCOMER.displayName}を追加`,
      }),
    );
    expect(await screen.findByText(PRIVATE_TEXT)).toBeTruthy();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(CASE_147B_TEXTS.participantsOnly);
  });
});
