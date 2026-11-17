// #146（146-B）案件作成の承認一覧（S-29）のテストで使う、架空の応答（MSW）。データはすべて架空（testuser_・テスト太郎・[UNIT_TEST]）。
// 審査一覧（GET /api/case-requests）をテストの中の配列で状態として持ち、成功した承認・却下のあとの一覧に反映する。
// 応答の形は、バックエンドのテスト（backend/src/routes/case-requests.decide.test.ts）が決めた契約と同じ。
import { http, HttpResponse } from "msw";
import {
  CLIENT_A,
  DEPT_SALES,
  NOW,
  caseRequestItem,
  type CaseRequestItem,
  type Sent,
} from "./case-request-handlers";
import { server } from "./server";

export const APPROVE_PERMISSION = "perm.case.request.approve";

export type ReviewCaseRequest = Omit<CaseRequestItem, "candidates"> & {
  candidates: { userId: string; displayName: string; isActive: boolean }[];
  requesterId: string;
  requesterDisplayName: string;
  hasSimilarTitle: boolean;
  canApprove: boolean;
};

/** サーバーが返す 409 の文言（計画 B-5。画面はそのまま表示する） */
export const DECIDE_MESSAGES = {
  decided: "この申請はすでに処理されています",
  departmentInactive:
    "担当部署の一部が無効のため承認できません。却下して再申請を依頼してください",
  clientInactive:
    "取引先が無効のため承認できません。却下して再申請を依頼してください",
  candidateInactive:
    "無効になった候補がいます。申請者に取り下げと再申請を依頼してください",
  numberExhausted: "この取引先の今年の案件番号が上限に達したため承認できません",
} as const;

export function reviewCaseRequest(
  suffix: string,
  overrides: Partial<ReviewCaseRequest> = {},
): ReviewCaseRequest {
  const base = caseRequestItem(suffix);
  return {
    ...base,
    client: { ...CLIENT_A, isActive: true },
    departments: [{ ...DEPT_SALES, isActive: true }],
    candidates: [],
    requesterId: "01JTESTCASEAPPREQ0000001AB",
    requesterDisplayName: "テスト申請者A",
    hasSimilarTitle: false,
    canApprove: true,
    ...overrides,
  };
}

/** 審査一覧と、承認・却下の架空の応答。sent に送った要求、queries に一覧のクエリを記録する */
export function respondReviewCaseRequests(initial: ReviewCaseRequest[] = []) {
  let items = [...initial];
  const sent: Sent[] = [];
  const queries: URLSearchParams[] = [];
  server.use(
    http.get("/api/case-requests", ({ request }) => {
      const params = new URL(request.url).searchParams;
      queries.push(params);
      const status = params.get("status");
      return HttpResponse.json({
        items: items.filter(
          (item) => status === null || item.status === status,
        ),
        nextCursor: null,
      });
    }),
    http.post(
      "/api/case-requests/:requestId/approve",
      async ({ params, request }) => {
        const id = String(params.requestId);
        const text = await request.text();
        sent.push({
          method: "POST",
          path: `/api/case-requests/${id}/approve`,
          body: text === "" ? null : (JSON.parse(text) as unknown),
        });
        items = items.map((item) =>
          item.id === id
            ? {
                ...item,
                status: "approved" as const,
                canApprove: false,
                decidedAt: NOW,
                caseId: "01JTESTCASEAPPNEWCASE00001",
              }
            : item,
        );
        return HttpResponse.json({
          requestId: id,
          status: "approved",
          caseId: "01JTESTCASEAPPNEWCASE00001",
          caseNumber: "QZA-261117-0001",
          roomId: "01JTESTCASEAPPNEWR00M00001",
        });
      },
    ),
    http.post(
      "/api/case-requests/:requestId/reject",
      async ({ params, request }) => {
        const id = String(params.requestId);
        const body = (await request.json()) as { reason: string };
        sent.push({
          method: "POST",
          path: `/api/case-requests/${id}/reject`,
          body,
        });
        items = items.map((item) =>
          item.id === id
            ? {
                ...item,
                status: "rejected" as const,
                canApprove: false,
                decidedAt: NOW,
                rejectReason: body.reason.trim(),
              }
            : item,
        );
        return HttpResponse.json({ requestId: id, status: "rejected" });
      },
    ),
  );
  return { sent, queries };
}
