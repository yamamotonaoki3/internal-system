// #135 AC-1（2-5 AC-1〜AC-3・AC-5・AC-7）・#132 AC-2（2-4 AC-2・AC-3）: 招待の Service（channel.service.ts の invite）の判定の順と、0行の後の再判定。
// Repository は偽物（vi.fn）にし、判定の順の組み合わせを速く網羅する（計画 10節「判定の順」「2-5 AC-3」「0行の後」「読み取り専用」）。
// 判定の順（計画 5節。この順を変えない）：
//   ③ 閲覧可否（見えなければ 404）→ ④ 招待の権限（参加していない公開は 403）→ ⑤ 再認証（403 REAUTH_REQUIRED）
//   → ⑥ チャンネルの状態（case・部署が無効は 409）→ ⑦ 相手の有効性（存在しない・無効は同じ 404）→ ⑧ 参加済み（409）→ ⑨ 書き込み
//   ⑩ 書き込みが0行なら、招待者が有効か（401）→③→④→⑥→⑦→⑧ の順で読み直して判定する（再認証はやり直さない）。どれにも当たらなければ例外（成功にしない）。
//      招待者が無効の 401 は、セッションの層と同じ code・文言（UNAUTHENTICATED「ログインしてください」）。
// 実装が前提とする約束（実装前。報告に明記）：
//   createChannelService(repository).invite(actor: { userId; traceId; reauthenticatedAt: string | null }, roomId, inviteeId)
//     : Promise<{ channelId: string; userId: string; joinedAt: string }>
//   repository.findForViewer(roomId, inviterId)（既存。ChannelViewRow | null）
//   repository.findInvitee(roomId, inviteeId): Promise<{ isActive: boolean; joined: boolean } | null>（null は社員が存在しない）
//   repository.invite({ roomId, inviterId, inviteeId, traceId }): Promise<string | null>（挿入した参加の joined_at。0行なら null）
//   createChannelService(repository, roles?, { authorizer })：第3引数で authorizer（authorize(principal, permission, scope)）を受け取る（#135 追加の依頼）。
//     招待の権限 perm.channel.invite（R-49）を、範囲 { type: "company" } で確かめる（返信・リアクションと同じ。参加の条件は Service が先に確かめる）。
//     拒否は authorize が投げる FORBIDDEN のまま。閲覧可否（404）・招待者の参加（403）の後、再認証の前。0行の後の読み直しでも確かめ直す。
//   repository.isUserActive(userId): Promise<boolean>（0行の後の読み直しで、招待者が今も有効かを読む。名前は仮置き）
// データは架空（testuser_、[UNIT_TEST]）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelRepository } from "../db/channel.repository";
import { AppError } from "../lib/app-error";
import type { Permission } from "../lib/permissions";
import { createChannelService } from "./channel.service";

const ROOM = "01JTESTINVROOM000000000001";
const INVITER = "01JTESTINVUSER000000000001";
const INVITEE = "01JTESTINVUSER000000000002";
const JOINED_AT = "2026-11-16T00:00:00.000Z";
const ARCHIVED_AT = "2026-11-15T00:00:00.000Z";
const DEPARTMENT_INACTIVE_MESSAGE =
  "部署が無効になっているため、招待できません";

type ViewRow = {
  roomId: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  departmentId: string | null;
  deletedAt: string | null;
  joinedAt: string | null;
  purpose:
    "normal" | "department" | "announcement" | "company_general" | "case";
  departmentIsActive: boolean;
};
type Invitee = { isActive: boolean; joined: boolean } | null;

/** 招待者から見たチャンネル（既定：参加中の非公開・通常・部署は有効） */
const view = (overrides: Partial<ViewRow> = {}): ViewRow => ({
  roomId: ROOM,
  name: "[UNIT_TEST]招待の部屋",
  description: "",
  visibility: "private",
  departmentId: "01JTESTINVDEPT000000000001",
  deletedAt: null,
  joinedAt: JOINED_AT,
  purpose: "normal",
  departmentIsActive: true,
  ...overrides,
});
const ACTIVE_NOT_JOINED: Invitee = { isActive: true, joined: false };

const recent = () => new Date().toISOString();

type Fake = {
  findForViewer: ReturnType<typeof vi.fn>;
  findInvitee: ReturnType<typeof vi.fn>;
  invite: ReturnType<typeof vi.fn>;
  isUserActive: ReturnType<typeof vi.fn>;
};

/**
 * 偽の Repository。views・invitees は呼ばれた順に返す（最後の値を以後も返す）。
 * 0行の後の読み直しでは2つ目の値が使われる。
 */
function fakeRepository(options: {
  views: (ViewRow | null)[];
  invitees?: Invitee[];
  inviteResult?: string | null;
  /** 0行の後に読む、招待者が有効か（既定は true） */
  inviterActive?: boolean;
}): Fake {
  const sequence = <T>(values: T[]) => {
    let i = 0;
    return vi.fn(async () => {
      const value = values[Math.min(i, values.length - 1)];
      i += 1;
      return value;
    });
  };
  return {
    findForViewer: sequence(options.views),
    findInvitee: sequence(options.invitees ?? [ACTIVE_NOT_JOINED]),
    invite: vi.fn(async () =>
      options.inviteResult === undefined ? JOINED_AT : options.inviteResult,
    ),
    isUserActive: vi.fn(async () => options.inviterActive ?? true),
  };
}

type AuthorizeRecord = {
  userId: string;
  permission: Permission;
  scope: unknown;
};

/**
 * 偽の authorizer。deniedFromCall 回目以降の perm.channel.invite を FORBIDDEN（本物と同じ 403）で拒否する。
 * 既定は拒否しない。呼ばれた順に calls に記録する。
 */
function fakeAuthorizer(deniedFromCall = Number.POSITIVE_INFINITY) {
  const calls: AuthorizeRecord[] = [];
  return {
    calls,
    async can() {
      return true;
    },
    async authorize(
      principal: { userId: string },
      permission: Permission,
      scope?: unknown,
    ) {
      calls.push({ userId: principal.userId, permission, scope });
      const n = calls.filter((c) => c.permission === permission).length;
      if (permission === "perm.channel.invite" && n >= deniedFromCall)
        throw new AppError("FORBIDDEN", "この操作を行う権限がありません");
    },
  };
}

async function run(
  fake: Fake,
  reauthenticatedAt: string | null = recent(),
  inviteeId = INVITEE,
  authorizer: ReturnType<typeof fakeAuthorizer> = fakeAuthorizer(),
) {
  const service = createChannelService(
    fake as unknown as ChannelRepository,
    undefined,
    { authorizer } as never,
  );
  try {
    const result = await service.invite(
      { userId: INVITER, traceId: "unit-auth-invite", reauthenticatedAt },
      ROOM,
      inviteeId,
    );
    return { result, error: undefined };
  } catch (error) {
    return { result: undefined, error };
  }
}

function expectAppError(error: unknown, code: string) {
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("#135 AC-1（2-5 AC-1）・#132 AC-2（2-4 AC-2）成功", () => {
  it("#135 AC-1（2-5 AC-1）: 参加中の非公開チャンネルに有効な未参加の社員を招待すると { channelId, userId, joinedAt } を返し、書き込みを1回だけ呼ぶ", async () => {
    const fake = fakeRepository({ views: [view()] });
    const { result, error } = await run(fake);
    expect(error).toBeUndefined();
    expect(result).toEqual({
      channelId: ROOM,
      userId: INVITEE,
      joinedAt: JOINED_AT,
    });
    expect(fake.invite).toHaveBeenCalledTimes(1);
    expect(fake.invite).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: ROOM,
        inviterId: INVITER,
        inviteeId: INVITEE,
      }),
    );
    expect(fake.findForViewer).toHaveBeenCalledWith(ROOM, INVITER);
  });

  it("#135 AC-1（読み取り専用）: 会社直属（部署なし）のチャンネルには招待できる", async () => {
    const fake = fakeRepository({
      views: [
        view({
          departmentId: null,
          departmentIsActive: true,
          purpose: "company_general",
          visibility: "public",
        }),
      ],
    });
    const { error } = await run(fake);
    expect(error).toBeUndefined();
    expect(fake.invite).toHaveBeenCalledTimes(1);
  });
});

describe("#135 AC-1 判定の順（各段で後の段の Repository を呼ばない）", () => {
  it.each([
    ["存在しない", null],
    ["参加していない非公開", view({ joinedAt: null })],
    ["アーカイブ済み（参加中）", view({ deletedAt: ARCHIVED_AT })],
    [
      "アーカイブ済みの公開",
      view({ visibility: "public", deletedAt: ARCHIVED_AT }),
    ],
  ])(
    "#132 AC-2（2-4 AC-1）: %sのチャンネルは 404 で、再認証がなくても 404。相手を読まず、書き込まない",
    async (_label, row) => {
      const fake = fakeRepository({ views: [row] });
      const { error } = await run(fake, null);
      expectAppError(error, "NOT_FOUND");
      expect(fake.findInvitee).not.toHaveBeenCalled();
      expect(fake.invite).not.toHaveBeenCalled();
    },
  );

  it("#132 AC-2（2-4 AC-1）: 404 の文言は、存在しない・参加していない非公開・アーカイブ済みで同じ", async () => {
    const messages: string[] = [];
    for (const row of [
      null,
      view({ joinedAt: null }),
      view({ deletedAt: ARCHIVED_AT }),
    ]) {
      const { error } = await run(fakeRepository({ views: [row] }));
      messages.push(expectAppError(error, "NOT_FOUND").userMessage);
    }
    expect(new Set(messages).size).toBe(1);
  });

  it("#135 AC-1（2-5 AC-1）: 参加していない非公開では、案件・部署が無効・相手が参加済みでも 404（存在を開示しない）", async () => {
    const fake = fakeRepository({
      views: [
        view({ joinedAt: null, purpose: "case", departmentIsActive: false }),
      ],
      invitees: [{ isActive: true, joined: true }],
    });
    const { error } = await run(fake, null);
    expectAppError(error, "NOT_FOUND");
    expect(fake.findInvitee).not.toHaveBeenCalled();
  });

  it("#135 決定 Q3: 公開チャンネルで招待者が参加していなければ 403 FORBIDDEN。再認証がなくても 403 FORBIDDEN が先。相手を読まず、書き込まない", async () => {
    const fake = fakeRepository({
      views: [view({ visibility: "public", joinedAt: null })],
    });
    const { error } = await run(fake, null);
    expectAppError(error, "FORBIDDEN");
    expect(fake.findInvitee).not.toHaveBeenCalled();
    expect(fake.invite).not.toHaveBeenCalled();
  });

  it("#135 AC-1（2-5 AC-5）・#132 AC-2（2-4 AC-3）: 再認証がなければ 403 REAUTH_REQUIRED。案件・部署が無効より先。相手を読まず、書き込まない", async () => {
    const fake = fakeRepository({
      views: [view({ purpose: "case", departmentIsActive: false })],
    });
    const { error } = await run(fake, null);
    expectAppError(error, "REAUTH_REQUIRED");
    expect(fake.findInvitee).not.toHaveBeenCalled();
    expect(fake.invite).not.toHaveBeenCalled();
  });

  it("#135 AC-1（2-5 AC-5）: 再認証から時間が経ちすぎていれば 403 REAUTH_REQUIRED", async () => {
    const fake = fakeRepository({ views: [view()] });
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { error } = await run(fake, old);
    expectAppError(error, "REAUTH_REQUIRED");
    expect(fake.invite).not.toHaveBeenCalled();
  });

  it("#135 AC-1（2-5 AC-7）: 案件専用チャンネルは 409 CONFLICT。相手を読まず、書き込まない", async () => {
    const fake = fakeRepository({ views: [view({ purpose: "case" })] });
    const { error } = await run(fake);
    expectAppError(error, "CONFLICT");
    expect(fake.findInvitee).not.toHaveBeenCalled();
    expect(fake.invite).not.toHaveBeenCalled();
  });

  it("#135 AC-1（読み取り専用）: 部署が無効なチャンネルは 409 CONFLICT「部署が無効になっているため、招待できません」。相手が存在しなくても 409 が先", async () => {
    const fake = fakeRepository({
      views: [view({ departmentIsActive: false })],
      invitees: [null],
    });
    const { error } = await run(fake);
    expect(expectAppError(error, "CONFLICT").userMessage).toBe(
      DEPARTMENT_INACTIVE_MESSAGE,
    );
    expect(fake.findInvitee).not.toHaveBeenCalled();
    expect(fake.invite).not.toHaveBeenCalled();
  });

  it("#135 AC-1（2-5 AC-3）: 相手が存在しない・無効は同じ 404（code・文言とも同じ）で、書き込まない", async () => {
    const missing = fakeRepository({ views: [view()], invitees: [null] });
    const inactive = fakeRepository({
      views: [view()],
      invitees: [{ isActive: false, joined: false }],
    });
    const a = expectAppError((await run(missing)).error, "NOT_FOUND");
    const b = expectAppError((await run(inactive)).error, "NOT_FOUND");
    expect(a.userMessage).toBe(b.userMessage);
    expect(missing.invite).not.toHaveBeenCalled();
    expect(inactive.invite).not.toHaveBeenCalled();
    expect(missing.findInvitee).toHaveBeenCalledWith(ROOM, INVITEE);
  });

  it("#135 AC-1（2-5 AC-3）: 相手が無効で参加の行が残っていても 404（参加済みの 409 より有効性が先）", async () => {
    const fake = fakeRepository({
      views: [view()],
      invitees: [{ isActive: false, joined: true }],
    });
    expectAppError((await run(fake)).error, "NOT_FOUND");
    expect(fake.invite).not.toHaveBeenCalled();
  });

  it("#135 AC-1（2-5 AC-2）: 相手が参加済みなら 409 CONFLICT で、書き込まない", async () => {
    const fake = fakeRepository({
      views: [view()],
      invitees: [{ isActive: true, joined: true }],
    });
    expectAppError((await run(fake)).error, "CONFLICT");
    expect(fake.invite).not.toHaveBeenCalled();
  });

  it("#135 AC-1（2-5 AC-2）: 自分自身（参加済み）を招待すると 409 CONFLICT", async () => {
    const fake = fakeRepository({
      views: [view()],
      invitees: [{ isActive: true, joined: true }],
    });
    expectAppError((await run(fake, recent(), INVITER)).error, "CONFLICT");
    expect(fake.invite).not.toHaveBeenCalled();
  });
});

describe("#135 AC-1 書き込みが0行の後の再判定（重大1）", () => {
  // 書き込み（invite）が0行（null）を返した後、2回目の読み直しの値で判定する
  it.each([
    [
      "相手が参加済みになった → 409",
      [view(), view()],
      [ACTIVE_NOT_JOINED, { isActive: true, joined: true }],
      "CONFLICT",
    ],
    [
      "チャンネルがアーカイブされた → 404",
      [view(), view({ deletedAt: ARCHIVED_AT })],
      [ACTIVE_NOT_JOINED, ACTIVE_NOT_JOINED],
      "NOT_FOUND",
    ],
    [
      "非公開で招待者が外れた → 404",
      [view(), view({ joinedAt: null })],
      [ACTIVE_NOT_JOINED, ACTIVE_NOT_JOINED],
      "NOT_FOUND",
    ],
    [
      "公開で招待者が外れた → 403",
      [
        view({ visibility: "public" }),
        view({ visibility: "public", joinedAt: null }),
      ],
      [ACTIVE_NOT_JOINED, ACTIVE_NOT_JOINED],
      "FORBIDDEN",
    ],
    [
      "部署が無効になった → 409",
      [view(), view({ departmentIsActive: false })],
      [ACTIVE_NOT_JOINED, ACTIVE_NOT_JOINED],
      "CONFLICT",
    ],
    [
      "相手が無効になった → 404",
      [view(), view()],
      [ACTIVE_NOT_JOINED, { isActive: false, joined: false }],
      "NOT_FOUND",
    ],
    [
      "重なり：非公開で招待者が外れた＋相手が参加済み → 404（参加状態を漏らさない）",
      [view(), view({ joinedAt: null })],
      [ACTIVE_NOT_JOINED, { isActive: true, joined: true }],
      "NOT_FOUND",
    ],
    [
      "重なり：非公開で招待者が外れた＋相手が無効 → 404",
      [view(), view({ joinedAt: null })],
      [ACTIVE_NOT_JOINED, { isActive: false, joined: false }],
      "NOT_FOUND",
    ],
    [
      "重なり：相手が無効＋参加の行が残っている → 404",
      [view(), view()],
      [ACTIVE_NOT_JOINED, { isActive: false, joined: true }],
      "NOT_FOUND",
    ],
  ] as const)(
    "#135 AC-1（0行の後）: %s",
    async (_label, views, invitees, code) => {
      const fake = fakeRepository({
        views: [...views],
        invitees: [...invitees],
        inviteResult: null,
      });
      const { result, error } = await run(fake);
      expect(result).toBeUndefined();
      expectAppError(error, code);
      // 書き込みのやり直しはしない
      expect(fake.invite).toHaveBeenCalledTimes(1);
    },
  );

  it("#135 AC-1（0行の後・計画レビュー2回目）: 招待者が無効になった場合は 401 UNAUTHENTICATED「ログインしてください」（セッションの層と同じ）。チャンネル・相手の状態より先", async () => {
    const fake = fakeRepository({
      views: [view(), view({ joinedAt: null })],
      invitees: [ACTIVE_NOT_JOINED, { isActive: true, joined: true }],
      inviteResult: null,
      inviterActive: false,
    });
    const error = expectAppError((await run(fake)).error, "UNAUTHENTICATED");
    expect(error.userMessage).toBe("ログインしてください");
    expect(fake.isUserActive).toHaveBeenCalledWith(INVITER);
    expect(fake.findInvitee).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["相手が参加済み", { isActive: true, joined: true }],
    ["相手が無効", { isActive: false, joined: false }],
  ] as const)(
    "#135 AC-1（0行の後・計画レビュー2回目）: 公開で招待者が外れ、%sの場合は 403 FORBIDDEN（相手の状態を返さない）",
    async (_label, inviteeAfter) => {
      const fake = fakeRepository({
        views: [
          view({ visibility: "public" }),
          view({ visibility: "public", joinedAt: null }),
        ],
        invitees: [ACTIVE_NOT_JOINED, inviteeAfter],
        inviteResult: null,
      });
      expectAppError((await run(fake)).error, "FORBIDDEN");
    },
  );

  it("#135 AC-1（0行の後）: 部署が無効になったときの 409 は「部署が無効になっているため、招待できません」", async () => {
    const fake = fakeRepository({
      views: [view(), view({ departmentIsActive: false })],
      inviteResult: null,
    });
    const error = expectAppError((await run(fake)).error, "CONFLICT");
    expect(error.userMessage).toBe(DEPARTMENT_INACTIVE_MESSAGE);
  });

  it("#135 AC-1（0行の後）: 非公開で招待者が外れた場合、相手を読み直さない（相手の状態を判定に使わない）", async () => {
    const fake = fakeRepository({
      views: [view(), view({ joinedAt: null })],
      inviteResult: null,
    });
    expectAppError((await run(fake)).error, "NOT_FOUND");
    expect(fake.findInvitee).toHaveBeenCalledTimes(1);
  });

  it("#135 AC-1（0行の後）: 再認証はやり直さない（読み直しの間に期限が来ても REAUTH_REQUIRED にしない）", async () => {
    // 再認証の判定は書き込みの前の1回だけ。0行の後は、状態が変わっていれば状態の応答になる
    const fake = fakeRepository({
      views: [view(), view()],
      invitees: [ACTIVE_NOT_JOINED, { isActive: true, joined: true }],
      inviteResult: null,
    });
    const error = expectAppError((await run(fake)).error, "CONFLICT");
    expect(error.code).not.toBe("REAUTH_REQUIRED");
  });

  it("#135 AC-1（0行の後）: 読み直してもどの理由にも当たらない0行は、成功にせず例外（4xx の AppError にしない）", async () => {
    const fake = fakeRepository({
      views: [view(), view()],
      invitees: [ACTIVE_NOT_JOINED, ACTIVE_NOT_JOINED],
      inviteResult: null,
    });
    const { result, error } = await run(fake);
    expect(result).toBeUndefined();
    expect(error).toBeInstanceOf(Error);
    if (error instanceof AppError)
      expect(error.status).toBeGreaterThanOrEqual(500);
  });
});

describe("#135 AC-1（R-49）招待の権限 perm.channel.invite", () => {
  const inviteCalls = (a: ReturnType<typeof fakeAuthorizer>) =>
    a.calls.filter((c) => c.permission === "perm.channel.invite");

  it('#135 AC-1（R-49）: 成功の経路で、招待者について perm.channel.invite を範囲 { type: "company" } で1回確かめる', async () => {
    const authorizer = fakeAuthorizer();
    const fake = fakeRepository({ views: [view()] });
    const { error } = await run(fake, recent(), INVITEE, authorizer);
    expect(error).toBeUndefined();
    expect(inviteCalls(authorizer)).toEqual([
      {
        userId: INVITER,
        permission: "perm.channel.invite",
        scope: { type: "company" },
      },
    ]);
  });

  it("#135 AC-1（R-49）: 権限が拒否されたら authorize のエラーのまま 403 FORBIDDEN。相手を読まず、書き込まない", async () => {
    const authorizer = fakeAuthorizer(1);
    const fake = fakeRepository({ views: [view()] });
    const error = expectAppError(
      (await run(fake, recent(), INVITEE, authorizer)).error,
      "FORBIDDEN",
    );
    expect(error.userMessage).toBe("この操作を行う権限がありません");
    expect(fake.findInvitee).not.toHaveBeenCalled();
    expect(fake.invite).not.toHaveBeenCalled();
  });

  it("#135 AC-1（判定の順）: 権限の拒否は再認証より先（再認証がなくても 403 FORBIDDEN）", async () => {
    const authorizer = fakeAuthorizer(1);
    const fake = fakeRepository({
      views: [view({ purpose: "case", departmentIsActive: false })],
    });
    expectAppError(
      (await run(fake, null, INVITEE, authorizer)).error,
      "FORBIDDEN",
    );
    expect(fake.findInvitee).not.toHaveBeenCalled();
  });

  it.each([
    ["存在しない", null],
    ["参加していない非公開", view({ joinedAt: null })],
    ["アーカイブ済み", view({ deletedAt: ARCHIVED_AT })],
  ])(
    "#135 AC-1（判定の順）: %sチャンネルでは権限を確かめない（404 が先。拒否の監査に見えないチャンネルを残さない）",
    async (_label, row) => {
      const authorizer = fakeAuthorizer(1);
      const fake = fakeRepository({ views: [row] });
      expectAppError(
        (await run(fake, recent(), INVITEE, authorizer)).error,
        "NOT_FOUND",
      );
      expect(inviteCalls(authorizer)).toEqual([]);
    },
  );

  it("#135 AC-1（判定の順）: 公開チャンネルで招待者が参加していなければ、権限を確かめずに 403（参加の確認が先）", async () => {
    const authorizer = fakeAuthorizer();
    const fake = fakeRepository({
      views: [view({ visibility: "public", joinedAt: null })],
    });
    expectAppError(
      (await run(fake, recent(), INVITEE, authorizer)).error,
      "FORBIDDEN",
    );
    expect(inviteCalls(authorizer)).toEqual([]);
  });

  it("#135 AC-1（0行の後）: 読み直しでも権限を確かめ直し、拒否なら 403 FORBIDDEN（チャンネルの状態・相手の状態より先）", async () => {
    const authorizer = fakeAuthorizer(2);
    const fake = fakeRepository({
      views: [view(), view({ departmentIsActive: false })],
      invitees: [ACTIVE_NOT_JOINED, { isActive: true, joined: true }],
      inviteResult: null,
    });
    const error = expectAppError(
      (await run(fake, recent(), INVITEE, authorizer)).error,
      "FORBIDDEN",
    );
    expect(error.userMessage).toBe("この操作を行う権限がありません");
    expect(inviteCalls(authorizer)).toHaveLength(2);
    expect(fake.findInvitee).toHaveBeenCalledTimes(1);
  });

  it("#135 AC-1（0行の後）: 非公開で招待者が外れた場合は、権限を確かめ直さずに 404", async () => {
    const authorizer = fakeAuthorizer(2);
    const fake = fakeRepository({
      views: [view(), view({ joinedAt: null })],
      inviteResult: null,
    });
    expectAppError(
      (await run(fake, recent(), INVITEE, authorizer)).error,
      "NOT_FOUND",
    );
    expect(inviteCalls(authorizer)).toHaveLength(1);
  });
});

describe("#135 AC-1 エラーの文言（設計書に全文の定めがないものは、空でないことと区別の有無だけ）", () => {
  const message = async (fake: Fake) =>
    expectAppError((await run(fake)).error, "CONFLICT").userMessage;

  it("#135 AC-1（2-5 AC-3）: 相手が存在しない・無効の 404 の文言は同じで、空でない", async () => {
    const missing = expectAppError(
      (await run(fakeRepository({ views: [view()], invitees: [null] }))).error,
      "NOT_FOUND",
    ).userMessage;
    const inactive = expectAppError(
      (
        await run(
          fakeRepository({
            views: [view()],
            invitees: [{ isActive: false, joined: false }],
          }),
        )
      ).error,
      "NOT_FOUND",
    ).userMessage;
    expect(missing).toBe(inactive);
    expect(missing.trim()).not.toBe("");
  });

  it("#135 AC-1（2-5 AC-2）: 参加済みの 409 の文言は「参加済み」を含む（画面がそのまま出す。設計書 S-12）", async () => {
    const text = await message(
      fakeRepository({
        views: [view()],
        invitees: [{ isActive: true, joined: true }],
      }),
    );
    expect(text).toContain("参加済み");
  });

  it("#135 AC-1（2-5 AC-7）: 案件専用の 409 の文言は空でなく、参加済み・部署が無効の文言と別", async () => {
    const text = await message(
      fakeRepository({ views: [view({ purpose: "case" })] }),
    );
    expect(text.trim()).not.toBe("");
    expect(text).not.toContain("参加済み");
    expect(text).not.toBe(DEPARTMENT_INACTIVE_MESSAGE);
  });

  it("#135 決定 Q3: 公開チャンネルに未参加の招待者の 403 の文言は空でなく、権限の拒否の文言と別", async () => {
    const error = expectAppError(
      (
        await run(
          fakeRepository({
            views: [view({ visibility: "public", joinedAt: null })],
          }),
        )
      ).error,
      "FORBIDDEN",
    );
    expect(error.userMessage.trim()).not.toBe("");
    expect(error.userMessage).not.toBe("この操作を行う権限がありません");
  });
});
