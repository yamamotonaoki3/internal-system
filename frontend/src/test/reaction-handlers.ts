// #138：リアクション（EP-1-12・EP-1-13）のテストで使う MSW の応答（架空のデータのみ）。サーバーの状態を持つ簡易な模擬。
// 契約（サーバーの実装・OpenAPI と同じ。計画「API」）：
//   POST   /api/messages/:messageId/reactions { kind, value }          → 200 { messageId, reactions }（その投稿の最新の集計。すでに付いていても 200）
//   DELETE /api/messages/:messageId/reactions/:kind/:value（value は URL エンコード） → 200 { messageId, reactions }（すでに外れていても 200）
//   拒否（上限・削除済み・書き込めない部屋・見えない）は 409・403・404 のエラー応答（failNext で再現する）
// ログイン中の利用者は SELF（thread-harness）。自分の分は reactedByMe: true で、users の末尾に足す。
// 名前を use〜 にしない（React Hooks の規則の誤検知を避ける）。
import { http, HttpResponse } from "msw";
import { apiErrorResponse, type TestReaction } from "./message-handlers";
import { server } from "./server";
import { SELF } from "./thread-harness";

export type ReactionRequest = {
  messageId: string;
  kind: string;
  value: string;
};

export type ReactionServer = {
  /** 投稿ごとの集計（テストが書き換えて「別のタブ・他の人の操作」を再現する） */
  reactions: Map<string, TestReaction[]>;
  /** POST の要求（届いた順） */
  posts: ReactionRequest[];
  /** DELETE の要求（届いた順。value は復号した値、rawPaths は符号化されたままのパス） */
  deletes: ReactionRequest[];
  rawPaths: string[];
  /** 次の1回の要求を、このエラーで拒否する */
  failNext: { status: number; code: string; message: string } | null;
  /** 設定すると、応答を返す前にこの約束が解けるまで待つ（遅れて届く応答を再現する） */
  gate: Promise<void> | null;
};

const SELF_USER = {
  id: SELF.id,
  displayName: SELF.displayName,
  isActive: true,
};

/** 自分の分を足した（すでにあれば変えない）集計 */
function withSelf(list: TestReaction[], kind: string, value: string) {
  const found = list.find((r) => r.kind === kind && r.value === value);
  if (found?.reactedByMe === true) return list;
  if (found !== undefined)
    return list.map((r) =>
      r === found
        ? {
            ...r,
            count: r.count + 1,
            reactedByMe: true,
            users: [...r.users, SELF_USER],
          }
        : r,
    );
  return [
    ...list,
    {
      kind: kind as TestReaction["kind"],
      value,
      count: 1,
      reactedByMe: true,
      users: [SELF_USER],
    },
  ];
}

/** 自分の分を外した集計（0人になった種類は消える） */
function withoutSelf(list: TestReaction[], kind: string, value: string) {
  return list.flatMap((r) => {
    if (r.kind !== kind || r.value !== value || !r.reactedByMe) return [r];
    if (r.count <= 1) return [];
    return [
      {
        ...r,
        count: r.count - 1,
        reactedByMe: false,
        users: r.users.filter((u) => u.id !== SELF.id),
      },
    ];
  });
}

export function respondReactions(
  initial: Record<string, TestReaction[]> = {},
): ReactionServer {
  const state: ReactionServer = {
    reactions: new Map(Object.entries(initial)),
    posts: [],
    deletes: [],
    rawPaths: [],
    failNext: null,
    gate: null,
  };
  const reject = () => {
    if (state.failNext === null) return null;
    const { status, code, message } = state.failNext;
    state.failNext = null;
    return apiErrorResponse(status, code, message);
  };
  server.use(
    http.post(
      "/api/messages/:messageId/reactions",
      async ({ params, request }) => {
        const messageId = String(params.messageId);
        const { kind, value } = (await request.json()) as {
          kind: string;
          value: string;
        };
        state.posts.push({ messageId, kind, value });
        if (state.gate !== null) await state.gate;
        const rejection = reject();
        if (rejection !== null) return rejection;
        const next = withSelf(
          state.reactions.get(messageId) ?? [],
          kind,
          value,
        );
        state.reactions.set(messageId, next);
        return HttpResponse.json({ messageId, reactions: next });
      },
    ),
    http.delete(
      "/api/messages/:messageId/reactions/:kind/:value",
      async ({ params, request }) => {
        const messageId = String(params.messageId);
        const kind = String(params.kind);
        const value = decodeURIComponent(String(params.value));
        state.deletes.push({ messageId, kind, value });
        state.rawPaths.push(new URL(request.url).pathname);
        if (state.gate !== null) await state.gate;
        const rejection = reject();
        if (rejection !== null) return rejection;
        const next = withoutSelf(
          state.reactions.get(messageId) ?? [],
          kind,
          value,
        );
        state.reactions.set(messageId, next);
        return HttpResponse.json({ messageId, reactions: next });
      },
    ),
  );
  return state;
}

/** 種類1つ分の集計を作る（付けた人は SELF 以外の架空の利用者。reactedByMe が真なら SELF も含める） */
export function reaction(
  kind: TestReaction["kind"],
  value: string,
  options: {
    others?: { id: string; displayName: string; isActive?: boolean }[];
    mine?: boolean;
  } = {},
): TestReaction {
  const others = (options.others ?? []).map((u) => ({
    id: u.id,
    displayName: u.displayName,
    isActive: u.isActive ?? true,
  }));
  const users = options.mine === true ? [...others, SELF_USER] : others;
  return {
    kind,
    value,
    count: users.length,
    reactedByMe: options.mine === true,
    users,
  };
}

/** 架空の他の利用者（n 番目）。ID は ULID の形、表示名は明らかな架空名 */
export const reactor = (n: number, isActive = true) => ({
  id: `01JTESTUSER00000000000R${String(n).padStart(3, "0")}`,
  displayName: `テストリアクション${n}`,
  isActive,
});

// ---- #138 コードレビュー1回目（軽微）：応答の順を入れ替えるための模擬 ----

export type HeldRequest = ReactionRequest & {
  method: "POST" | "DELETE";
  /** サーバーが要求を受けた時点の集計（応答の中身）。release するまで応答を返さない */
  snapshot: TestReaction[];
  released: boolean;
  release: () => void;
};

export type HeldReactionServer = {
  /** サーバー側の今の集計（要求を受けた順に反映する） */
  reactions: Map<string, TestReaction[]>;
  /** 届いた要求（届いた順）。release を呼ぶまで応答は返らない */
  requests: HeldRequest[];
};

/**
 * 要求を受けた時点でサーバーの状態に反映し、その時点の集計を応答として持つ。応答を返す（届ける）のは、テストが release を呼んだときだけ。
 * 後から受けた要求の応答を先に release すると、「古い応答が後から届く」順を再現できる。
 */
export function respondReactionsHeld(
  initial: Record<string, TestReaction[]> = {},
): HeldReactionServer {
  const state: HeldReactionServer = {
    reactions: new Map(Object.entries(initial)),
    requests: [],
  };
  const hold = (
    method: "POST" | "DELETE",
    request: ReactionRequest,
    next: TestReaction[],
  ) =>
    new Promise<Response>((resolve) => {
      state.reactions.set(request.messageId, next);
      const held: HeldRequest = {
        ...request,
        method,
        snapshot: next,
        released: false,
        release: () => {
          held.released = true;
          resolve(
            HttpResponse.json({
              messageId: request.messageId,
              reactions: next,
            }),
          );
        },
      };
      state.requests.push(held);
    });
  server.use(
    http.post(
      "/api/messages/:messageId/reactions",
      async ({ params, request }) => {
        const messageId = String(params.messageId);
        const { kind, value } = (await request.json()) as {
          kind: string;
          value: string;
        };
        return hold(
          "POST",
          { messageId, kind, value },
          withSelf(state.reactions.get(messageId) ?? [], kind, value),
        );
      },
    ),
    http.delete(
      "/api/messages/:messageId/reactions/:kind/:value",
      ({ params }) => {
        const messageId = String(params.messageId);
        const kind = String(params.kind);
        const value = decodeURIComponent(String(params.value));
        return hold(
          "DELETE",
          { messageId, kind, value },
          withoutSelf(state.reactions.get(messageId) ?? [], kind, value),
        );
      },
    ),
  );
  return state;
}
