// #147（147-A）案件の一覧（S-16）・詳細（S-17 の骨格）・サイドバーの参加中の案件のテストで使う、架空の応答（MSW）。
// 応答の形は、バックエンドのテスト（backend/src/routes/cases.test.ts）が決めた契約と同じ。データはすべて架空（testuser_・テスト太郎・[UNIT_TEST]）。
import { http, HttpResponse } from "msw";
import { server } from "./server";

export type CaseScope = "joined" | "all";
export type CaseStatus = "active" | "closed";

export type CaseSummary = {
  id: string;
  caseNumber: string;
  title: string;
  status: CaseStatus;
  client: { id: string; name: string; isActive: boolean };
  departments: { id: string; name: string; isActive: boolean }[];
  dueDate: string | null;
  isParticipant: boolean;
  canManage: boolean;
  participantCount: number | null;
  /** #147（147-B）：納期を変えられるか（表示の制御。認可はサーバー） */
  canEditDueDate: boolean;
};

export type CaseParticipant = {
  userId: string;
  displayName: string;
  departmentName: string | null;
  isActive: boolean;
  isCreator: boolean;
  /** #147（147-B）Q8：自動参加の役割（その時点の割り当て） */
  autoRole: "global_admin" | "department_owner" | null;
  /** #147（147-B）：外せるか（自動参加でなく、外しても有効な参加者が残る） */
  removable: boolean;
};

export type CaseDetail = CaseSummary & {
  description: string;
  channelId: string;
  createdBy: string;
  participants: CaseParticipant[];
};

export const CASE_CLIENT = {
  id: "01JTESTCASE147ACC000000001",
  name: "テスト商事147A [UNIT_TEST]",
};
export const CASE_DEPT_SALES = {
  id: "01JTESTCASE147ADS000000001",
  name: "[UNIT_TEST]営業147A",
};
export const CASE_DEPT_DEV = {
  id: "01JTESTCASE147ADD000000001",
  name: "[UNIT_TEST]開発147A",
};

/** 画面の文言（計画 147-A の画面・判定の順。サーバーの文言と同じもの） */
export const CASE_TEXTS = {
  participantsOnly: "参加者だけが見られます（非公開）",
  notFound: "案件が見つかりません",
  emptyJoined: "参加している案件はありません",
  emptyAll: "案件はありません",
  emptyClosed: "終了した案件はありません",
  loading: "読み込み中です",
} as const;

/** 案件の ID（ULID の形。n は 1〜999） */
export const caseId = (n: number) =>
  `01JTESTCASE147A${String(n).padStart(11, "0")}`;
export const caseRoomId = (n: number) =>
  `01JTESTCASE147AR${String(n).padStart(10, "0")}`;
export const caseTitle = (n: number) => `[UNIT_TEST]147A案件${n}`;
export const caseNumberOf = (n: number) =>
  `QZA-261117-${String(n).padStart(4, "0")}`;

export function caseSummary(
  n: number,
  overrides: Partial<CaseSummary> = {},
): CaseSummary {
  return {
    id: caseId(n),
    caseNumber: caseNumberOf(n),
    title: caseTitle(n),
    status: "active",
    client: { ...CASE_CLIENT, isActive: true },
    departments: [{ ...CASE_DEPT_SALES, isActive: true }],
    dueDate: "2026-12-01",
    isParticipant: true,
    canManage: false,
    participantCount: 2,
    canEditDueDate: true,
    ...overrides,
  };
}

/** 参加していない一般の社員から見た行（概要だけ。参加者数は null） */
export function outsiderSummary(
  n: number,
  overrides: Partial<CaseSummary> = {},
): CaseSummary {
  return caseSummary(n, {
    isParticipant: false,
    canManage: false,
    participantCount: null,
    canEditDueDate: false,
    ...overrides,
  });
}

export const PARTICIPANT_CREATOR: CaseParticipant = {
  userId: "01JTESTCASE147APC000000001",
  displayName: "testuser_147a_creator",
  departmentName: CASE_DEPT_SALES.name,
  isActive: true,
  isCreator: true,
  autoRole: null,
  removable: true,
};
export const PARTICIPANT_RETIRED: CaseParticipant = {
  userId: "01JTESTCASE147APR000000001",
  displayName: "testuser_147a_retired",
  departmentName: CASE_DEPT_DEV.name,
  isActive: false,
  isCreator: false,
  autoRole: null,
  removable: true,
};

export function caseDetail(
  n: number,
  overrides: Partial<CaseDetail> = {},
): CaseDetail {
  return {
    ...caseSummary(n),
    description: `[UNIT_TEST]147A案件${n}の説明`,
    channelId: caseRoomId(n),
    createdBy: PARTICIPANT_CREATOR.userId,
    participants: [PARTICIPANT_CREATOR, PARTICIPANT_RETIRED],
    ...overrides,
  };
}

type ListKey = `${CaseScope}:${CaseStatus}`;

/**
 * 案件の一覧・概要・詳細の架空の応答。
 * lists は「scope:status」ごとの行（cursor が null の最初のページ）。summaries・details は ID ごと。
 * queries に一覧のクエリを、detailCalls に詳細を取った案件の ID を記録する。
 * 概要・詳細がないときは 404「案件が見つかりません」、denied の ID の詳細は 403「参加者だけが見られます（非公開）」を返す。
 */
export function respondCases(
  options: {
    lists?: Partial<Record<ListKey, CaseSummary[]>>;
    nextPages?: Partial<Record<ListKey, CaseSummary[]>>;
    summaries?: CaseSummary[];
    details?: CaseDetail[];
    denied?: string[];
  } = {},
) {
  const queries: URLSearchParams[] = [];
  const detailCalls: string[] = [];
  const summaryCalls: string[] = [];
  server.use(
    http.get("/api/cases", ({ request }) => {
      const params = new URL(request.url).searchParams;
      queries.push(params);
      const key = `${params.get("scope")}:${params.get("status")}` as ListKey;
      if (params.get("cursor") === "page-2")
        return HttpResponse.json({
          items: options.nextPages?.[key] ?? [],
          nextCursor: null,
        });
      return HttpResponse.json({
        items: options.lists?.[key] ?? [],
        nextCursor: options.nextPages?.[key] === undefined ? null : "page-2",
      });
    }),
    http.get("/api/cases/:caseId/detail", ({ params }) => {
      const id = String(params.caseId);
      detailCalls.push(id);
      if (options.denied?.includes(id))
        return HttpResponse.json(
          { code: "FORBIDDEN", message: CASE_TEXTS.participantsOnly },
          { status: 403 },
        );
      const found = options.details?.find((item) => item.id === id);
      return found === undefined
        ? HttpResponse.json(
            { code: "NOT_FOUND", message: CASE_TEXTS.notFound },
            { status: 404 },
          )
        : HttpResponse.json(found);
    }),
    http.get("/api/cases/:caseId", ({ params }) => {
      const id = String(params.caseId);
      summaryCalls.push(id);
      const found = options.summaries?.find((item) => item.id === id);
      return found === undefined
        ? HttpResponse.json(
            { code: "NOT_FOUND", message: CASE_TEXTS.notFound },
            { status: 404 },
          )
        : HttpResponse.json(found);
    }),
  );
  return { queries, detailCalls, summaryCalls };
}

// ---- #147（147-B）参加者の追加・削除・退出と、納期の変更 ----

/** 画面の文言（計画 147-B の画面・S-18。サーバーの文言と同じもの） */
export const CASE_147B_TEXTS = {
  updated: "参加者を更新しました",
  participantsOnly: "参加者だけが操作できます",
  autoParticipant: "担当部署のオーナー・全体管理者は外せません",
  roleOwner: "担当部署のオーナー",
  roleAdmin: "全体管理者",
} as const;

export type CaseWrite = { method: string; path: string; body: unknown };

export type CaseWriteResponder = (
  write: CaseWrite,
) => Response | Promise<Response>;

/**
 * 参加者の追加（POST /api/cases/:caseId/participants）・削除（DELETE …/participants/:userId）・納期の変更（PATCH …/due-date）の架空の応答。
 * respond を省くと、追加は 201 { caseId, userId }、削除は 204、納期は 200 { caseId, dueDate } を返す。送った要求を writes に記録する。
 */
export function respondCaseWrites(respond?: CaseWriteResponder) {
  const writes: CaseWrite[] = [];
  async function record(request: {
    method: string;
    url: string;
    text(): Promise<string>;
  }): Promise<CaseWrite> {
    const text = await request.text();
    const write: CaseWrite = {
      method: request.method,
      path: new URL(request.url).pathname,
      body: text === "" ? undefined : (JSON.parse(text) as unknown),
    };
    writes.push(write);
    return write;
  }
  server.use(
    http.post(
      "/api/cases/:caseId/participants",
      async ({ request, params }) => {
        const write = await record(request);
        if (respond !== undefined) return respond(write);
        return HttpResponse.json(
          {
            caseId: String(params.caseId),
            userId: (write.body as { userId?: string } | undefined)?.userId,
          },
          { status: 201 },
        );
      },
    ),
    http.delete(
      "/api/cases/:caseId/participants/:userId",
      async ({ request }) => {
        const write = await record(request);
        if (respond !== undefined) return respond(write);
        return new HttpResponse(null, { status: 204 });
      },
    ),
    http.patch("/api/cases/:caseId/due-date", async ({ request, params }) => {
      const write = await record(request);
      if (respond !== undefined) return respond(write);
      return HttpResponse.json({
        caseId: String(params.caseId),
        dueDate: (write.body as { dueDate?: string | null } | undefined)
          ?.dueDate,
      });
    }),
  );
  return { writes };
}

export type SearchUser = { id: string; displayName: string };

/** 社員の検索（GET /api/users?q&cursor）。pages の順にページを返す（cursor は "page-2"・"page-3" …）。送った q を記録する */
export function respondUserSearch(pages: SearchUser[][]) {
  const queries: { q: string; cursor: string | null }[] = [];
  server.use(
    http.get("/api/users", ({ request }) => {
      const params = new URL(request.url).searchParams;
      const cursor = params.get("cursor");
      queries.push({ q: params.get("q") ?? "", cursor });
      const index =
        cursor === null ? 0 : Number(cursor.replace("page-", "")) - 1;
      const items = (pages[index] ?? []).map((user) => ({
        id: user.id,
        displayName: user.displayName,
        department: null,
        extension: null,
        email: `${user.displayName}@example.com`,
        status: { kind: "available", returnAt: null, message: null },
        canSetStatus: false,
      }));
      return HttpResponse.json({
        items,
        nextCursor: index + 1 < pages.length ? `page-${index + 2}` : null,
      });
    }),
  );
  return { queries };
}
