// #148（148-B-1）S-17 の「添付ファイル」の区画のテストで使う、架空の応答（MSW）。
// 応答の形は、バックエンドのテスト（backend/src/routes/cases.attachments.test.ts）が決めた契約と同じ。データはすべて架空（testuser_・[UNIT_TEST]）。
// state を書き換えると、次の取得からその内容を返す（ほかの参加者の投稿の代わり）。
import { http, HttpResponse } from "msw";
import { server } from "./server";

export type CaseAttachmentUploader = {
  id: string;
  displayName: string;
  isActive: boolean;
};

export type CaseAttachmentItem = {
  id: string;
  name: string;
  kind: "image" | "document" | "video";
  contentType: string;
  size: number;
  uploadedAt: string;
  messageId: string;
  threadParentId: string | null;
  uploader: CaseAttachmentUploader;
};

/** 画面の文言（テストが決めたもの。計画 148-B-1「画面」と、既存の TODO の区画の文言の型に合わせる） */
export const CASE_ATTACHMENT_TEXTS = {
  heading: "添付ファイル",
  loading: "添付ファイルを読み込み中です",
  empty: "添付ファイルはありません",
  loadError: "添付ファイルを読み込めませんでした",
  retry: "再試行",
  jump: "元のメッセージへ",
  more: "次のページ",
  retired: "退職者",
} as const;

/** 添付の ID（ULID の形。n は 1〜99999） */
export const caseAttachmentId = (n: number) =>
  `01JTESTATT148B${String(n).padStart(12, "0")}`;
/** 元のメッセージの ID（ULID の形） */
export const caseMessageId = (n: number) =>
  `01JTESTMSG148B${String(n).padStart(12, "0")}`;
export const caseAttachmentName = (n: number) => `[UNIT_TEST]148B添付${n}.txt`;

export const UPLOADER = {
  id: "01JTESTUSER148B00000000001",
  displayName: "testuser_148b_uploader",
  isActive: true,
} as const;

export function caseAttachment(
  n: number,
  overrides: Partial<CaseAttachmentItem> = {},
): CaseAttachmentItem {
  return {
    id: caseAttachmentId(n),
    name: caseAttachmentName(n),
    kind: "document",
    contentType: "text/plain; charset=utf-8",
    size: 2_500_000,
    uploadedAt: "2026-11-18T01:02:03.000Z",
    messageId: caseMessageId(n),
    threadParentId: null,
    uploader: { ...UPLOADER },
    ...overrides,
  };
}

export type CaseAttachmentServerState = {
  /** 全項目（新しい順＝サーバーの並び） */
  items: CaseAttachmentItem[];
  /** 1ページの件数（既定 50） */
  pageSize: number;
  /** 取得の応答を差し替える（403・500 など）。null なら通常 */
  failWith: { status: number; code: string; message: string } | null;
  /** GET の記録（案件の ID と cursor） */
  requests: { caseId: string; cursor: string | null }[];
};

/**
 * 案件の添付の一覧（GET /api/cases/:caseId/attachments?cursor）の架空の応答。cursor は「次のページの先頭の位置」（"p2"・"p3" …）。
 */
export function respondCaseAttachments(
  initial: CaseAttachmentItem[] = [],
  options: Partial<Omit<CaseAttachmentServerState, "items" | "requests">> = {},
): CaseAttachmentServerState {
  const state: CaseAttachmentServerState = {
    items: [...initial],
    pageSize: options.pageSize ?? 50,
    failWith: options.failWith ?? null,
    requests: [],
  };
  server.use(
    http.get("/api/cases/:caseId/attachments", ({ request, params }) => {
      const cursor = new URL(request.url).searchParams.get("cursor");
      state.requests.push({ caseId: String(params.caseId), cursor });
      if (state.failWith !== null)
        return HttpResponse.json(
          { code: state.failWith.code, message: state.failWith.message },
          { status: state.failWith.status },
        );
      const page = cursor === null ? 1 : Number(cursor.replace("p", ""));
      const start = (page - 1) * state.pageSize;
      const items = state.items.slice(start, start + state.pageSize);
      const hasMore = state.items.length > start + state.pageSize;
      return HttpResponse.json({
        items,
        nextCursor: hasMore ? `p${page + 1}` : null,
      });
    }),
  );
  return state;
}
