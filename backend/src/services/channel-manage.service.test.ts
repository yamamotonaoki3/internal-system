// #143-a a-AC-1〜a-AC-4（2-6 AC-4・AC-5・AC-6）: チャンネルの管理の Service（channel-manage.service.ts）の判定の順と、
// 書き込みが0行・前提の確認の失敗の後の読み直し・1回だけのやり直し。Repository と authorizer は偽物（vi.fn）にし、分岐を速く網羅する
// （計画 #143-a「テストケース（a）」の「同時の操作：Service（モックの Repository）」の行）。
// 判定の順（計画「判定の順」。この順を変えない）：
//   名前・説明：1 形（Route）→ 2 行がない・アーカイブ済み → 404 → 3 見えない かつ can(perm.channel.edit) が偽 → 404（authorize を呼ばない）
//              → 4 authorize(perm.channel.edit) → 403 → 5 案件 → 409、name を送り purpose が normal 以外 → 409 → 版の不一致 → 409 → 書き込み
//   アーカイブ：2 行がない → 404 → 3 見えない かつ can(perm.channel.delete) が偽 → 404 → 4 authorize → 403 → 5 再認証 → 403 REAUTH_REQUIRED
//              → 6 アーカイブできない種類 → 409 → 7 すでにアーカイブ済み → 409「この項目はすでに処理されています」→ 版 → 409 → 書き込み
//   復元：アーカイブと同じ順。7 は「アーカイブされていない」→ 409
//   0行（null）・前提の確認の失敗（ChannelManageConflictError）の後：操作者が有効か（無効なら 401）→ 2〜7 と版を同じ順で読み直す（再認証はやり直さない）。
//     アーカイブ・復元で、どれにも当たらなければ（宛先だけが変わった）宛先を読み直して同じ版で1回だけやり直す。2回目も失敗なら 409「ほかの操作と重なりました。もう一度お試しください」。
//     名前・説明の変更と、null（行が消えた）でどれにも当たらない場合は、AppError でない例外（成功にしない）。
//   範囲（scope）：チャンネルの department_id があれば { type: "department", departmentId }、なければ { type: "company" }（計画 1章）。
// 実装が前提とする約束（実装前。報告に明記）：
//   createChannelManageService(repository: ChannelRepository, deps: { authorizer: { can, authorize } })
//     .update(actor: { userId, traceId }, roomId, { version, name?, description? })
//     .archive(actor: { userId, traceId, reauthenticatedAt }, roomId, { version, reason: string | null })
//     .restore(actor: { userId, traceId, reauthenticatedAt }, roomId, { version })
//   Repository の形は db/channel-manage.db.test.ts の冒頭のとおり（findForManage・listNotifyRecipients・isUserActive・update・archive・restore）。
//   ChannelManageConflictError・ChannelNameTakenError は db/channel.repository.ts から公開し、引数なしで作れる（new ChannelManageConflictError()）。
// データは架空。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChannelManageConflictError,
  ChannelNameTakenError,
  type ChannelRepository,
} from "../db/channel.repository";
import { AppError } from "../lib/app-error";
import { isUlid } from "../lib/ulid";
import type { Permission } from "../lib/permissions";
import { createChannelManageService } from "./channel-manage.service";

const ROOM = "01JTESTMANROOM000000000001";
const ACTOR = "01JTESTMANUSER000000000001";
const DEPT = "01JTESTMANDEPT000000000001";
const EVENT = "01JTESTMANEVNT000000000001";
const ARCHIVED_AT = "2026-11-15T00:00:00.000Z";
const NOW = "2026-11-17T00:00:00.000Z";
const RECIPIENTS = ["01JTESTMANUSER000000000002", "01JTESTMANUSER000000000003"];

const MESSAGES = {
  alreadyProcessed: "この項目はすでに処理されています",
  versionMismatch: "ほかの人が先に変更しました。読み込み直してください",
  retryConflict: "ほかの操作と重なりました。もう一度お試しください",
  duplicateName: "同じ名前のチャンネルがあります",
} as const;

type ManageRow = {
  roomId: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  departmentId: string | null;
  purpose:
    "normal" | "department" | "announcement" | "company_general" | "case";
  deletedAt: string | null;
  version: number;
  isMember: boolean;
  openArchiveEventId: string | null;
};

/** 既定：部署の公開の通常のチャンネル、未アーカイブ、版 3、操作者は参加者でない */
const row = (overrides: Partial<ManageRow> = {}): ManageRow => ({
  roomId: ROOM,
  name: "[UNIT_TEST]管理",
  description: "",
  visibility: "public",
  departmentId: DEPT,
  purpose: "normal",
  deletedAt: null,
  version: 3,
  isMember: false,
  openArchiveEventId: null,
  ...overrides,
});
const archivedRow = (overrides: Partial<ManageRow> = {}) =>
  row({ deletedAt: ARCHIVED_AT, openArchiveEventId: EVENT, ...overrides });

type WriteOutcome = "ok" | "null" | "conflict" | Error;

type Fake = {
  findForManage: ReturnType<typeof vi.fn>;
  listNotifyRecipients: ReturnType<typeof vi.fn>;
  isUserActive: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  archive: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
};

function sequence<T>(values: T[]) {
  let i = 0;
  return vi.fn(async () => {
    const value = values[Math.min(i, values.length - 1)];
    i += 1;
    return value;
  });
}

/** 書き込みの結果を呼ばれた順に返す（最後の値を以後も返す） */
function writer(outcomes: WriteOutcome[], success: unknown) {
  let i = 0;
  return vi.fn(async () => {
    const outcome = outcomes[Math.min(i, outcomes.length - 1)];
    i += 1;
    if (outcome === "ok") return success;
    if (outcome === "null") return null;
    if (outcome === "conflict") throw new ChannelManageConflictError();
    throw outcome;
  });
}

function fakeRepository(options: {
  rows: (ManageRow | null)[];
  writes?: WriteOutcome[];
  actorActive?: boolean;
  recipients?: string[][];
}): Fake {
  const writes = options.writes ?? ["ok"];
  return {
    findForManage: sequence(options.rows),
    listNotifyRecipients: sequence(options.recipients ?? [RECIPIENTS]),
    isUserActive: vi.fn(async () => options.actorActive ?? true),
    update: writer(writes, {
      id: ROOM,
      name: "新しい名前",
      description: "",
      version: 4,
      updatedAt: NOW,
    }),
    archive: writer(writes, { id: ROOM, version: 4, deletedAt: NOW }),
    restore: writer(writes, { id: ROOM, version: 4, restoredAt: NOW }),
  };
}

type Call = {
  kind: "can" | "authorize";
  permission: Permission;
  scope: unknown;
};

/** 偽の authorizer。manager が真なら can も authorize も通す。偽なら can は false、authorize は FORBIDDEN */
function fakeAuthorizer(manager: boolean | boolean[]) {
  const calls: Call[] = [];
  const answers = Array.isArray(manager) ? manager : [manager];
  let canCount = 0;
  let authorizeCount = 0;
  const at = (n: number) => answers[Math.min(n, answers.length - 1)] ?? false;
  return {
    calls,
    async can(_p: { userId: string }, permission: Permission, scope?: unknown) {
      calls.push({ kind: "can", permission, scope });
      const answer = at(canCount);
      canCount += 1;
      return answer;
    },
    async authorize(
      _p: { userId: string },
      permission: Permission,
      scope?: unknown,
    ) {
      calls.push({ kind: "authorize", permission, scope });
      const answer = at(authorizeCount);
      authorizeCount += 1;
      if (!answer)
        throw new AppError("FORBIDDEN", "この操作を行う権限がありません");
    },
  };
}

const recent = () => new Date().toISOString();

async function attempt<T>(run: () => Promise<T>) {
  try {
    return { result: await run(), error: undefined };
  } catch (error) {
    return { result: undefined, error };
  }
}

function service(fake: Fake, authorizer: ReturnType<typeof fakeAuthorizer>) {
  return createChannelManageService(
    fake as unknown as ChannelRepository,
    {
      authorizer,
    } as never,
  );
}

const doUpdate = (
  fake: Fake,
  authorizer: ReturnType<typeof fakeAuthorizer>,
  input: { version?: number; name?: string; description?: string } = {
    description: "[UNIT_TEST]説明",
  },
) =>
  attempt(() =>
    service(fake, authorizer).update(
      { userId: ACTOR, traceId: "unit-auth-chman" },
      ROOM,
      { version: input.version ?? 3, ...input },
    ),
  );

const doArchive = (
  fake: Fake,
  authorizer: ReturnType<typeof fakeAuthorizer>,
  options: { reauthenticatedAt?: string | null; version?: number } = {},
) =>
  attempt(() =>
    service(fake, authorizer).archive(
      {
        userId: ACTOR,
        traceId: "unit-auth-chman",
        reauthenticatedAt:
          options.reauthenticatedAt === undefined
            ? recent()
            : options.reauthenticatedAt,
      },
      ROOM,
      { version: options.version ?? 3, reason: null },
    ),
  );

const doRestore = (
  fake: Fake,
  authorizer: ReturnType<typeof fakeAuthorizer>,
  options: { reauthenticatedAt?: string | null; version?: number } = {},
) =>
  attempt(() =>
    service(fake, authorizer).restore(
      {
        userId: ACTOR,
        traceId: "unit-auth-chman",
        reauthenticatedAt:
          options.reauthenticatedAt === undefined
            ? recent()
            : options.reauthenticatedAt,
      },
      ROOM,
      { version: options.version ?? 3 },
    ),
  );

function expectAppError(error: unknown, code: string) {
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

const authorizeCalls = (a: ReturnType<typeof fakeAuthorizer>) =>
  a.calls.filter((c) => c.kind === "authorize");

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("#143 a-AC-1〜a-AC-4 権限の範囲（scope）と種類", () => {
  it("#143 a-AC-1（計画 1章）: 部署のチャンネルは部署の範囲、会社直属は会社の範囲で、名前・説明は perm.channel.edit、アーカイブは perm.channel.delete を確かめる", async () => {
    const a1 = fakeAuthorizer(true);
    await doUpdate(fakeRepository({ rows: [row()] }), a1);
    expect(authorizeCalls(a1)).toEqual([
      {
        kind: "authorize",
        permission: "perm.channel.edit",
        scope: { type: "department", departmentId: DEPT },
      },
    ]);
    const a2 = fakeAuthorizer(true);
    await doArchive(
      fakeRepository({ rows: [row({ departmentId: null })] }),
      a2,
    );
    expect(authorizeCalls(a2)).toEqual([
      {
        kind: "authorize",
        permission: "perm.channel.delete",
        scope: { type: "company" },
      },
    ]);
    const a3 = fakeAuthorizer(true);
    await doRestore(fakeRepository({ rows: [archivedRow()] }), a3);
    expect(authorizeCalls(a3)).toEqual([
      {
        kind: "authorize",
        permission: "perm.channel.delete",
        scope: { type: "department", departmentId: DEPT },
      },
    ]);
  });
});

describe("#143 a-AC-1・a-AC-4 名前・説明の変更の判定の順", () => {
  // 整形（2-2 AC-13・C-121）は Route の schema（channelRequestNameSchema）が行い、Service は整形済みの名前を受け取る
  it("#143 a-AC-1: 成功すると Repository の結果を返し、書き込みに名前と送られた版を渡す。再認証は求めない", async () => {
    const fake = fakeRepository({ rows: [row()] });
    const { result, error } = await doUpdate(fake, fakeAuthorizer(true), {
      name: "ABC新名前",
      version: 3,
    });
    expect(error).toBeUndefined();
    expect(result).toMatchObject({ id: ROOM, version: 4 });
    expect(fake.update).toHaveBeenCalledTimes(1);
    expect(fake.update).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: ROOM,
        actorId: ACTOR,
        version: 3,
        name: "ABC新名前",
      }),
    );
  });

  it.each([
    ["存在しない", null],
    ["アーカイブ済み", archivedRow()],
  ])(
    "#143 a-AC-1（EP-2-36）: %sチャンネルは、管理できる人にも 404。権限を確かめず、書き込まない",
    async (_label, target) => {
      const fake = fakeRepository({ rows: [target] });
      const authorizer = fakeAuthorizer(true);
      const { error } = await doUpdate(fake, authorizer);
      expectAppError(error, "NOT_FOUND");
      expect(authorizeCalls(authorizer)).toEqual([]);
      expect(fake.update).not.toHaveBeenCalled();
    },
  );

  it("#143 a-AC-4（security）: 参加していない非公開を管理できない人には 404。authorize を呼ばない（拒否の監査に残さない）", async () => {
    const fake = fakeRepository({
      rows: [row({ visibility: "private", isMember: false })],
    });
    const authorizer = fakeAuthorizer(false);
    const { error } = await doUpdate(fake, authorizer);
    expectAppError(error, "NOT_FOUND");
    expect(authorizeCalls(authorizer)).toEqual([]);
    expect(fake.update).not.toHaveBeenCalled();
  });

  it.each([
    ["公開チャンネル（未参加）", row()],
    ["公開チャンネル（参加中）", row({ isMember: true })],
    ["参加中の非公開", row({ visibility: "private", isMember: true })],
  ])(
    "#143 a-AC-4（2-6 AC-4）: 見える%sを管理できない人は 403 FORBIDDEN（authorize の拒否）。書き込まない",
    async (_label, target) => {
      const fake = fakeRepository({ rows: [target] });
      const { error } = await doUpdate(fake, fakeAuthorizer(false));
      expectAppError(error, "FORBIDDEN");
      expect(fake.update).not.toHaveBeenCalled();
    },
  );

  it("#143 a-AC-4（2-6 AC-5⑥）: 参加していない非公開でも、管理できる人は変更できる", async () => {
    const fake = fakeRepository({
      rows: [row({ visibility: "private", isMember: false })],
    });
    const { error } = await doUpdate(fake, fakeAuthorizer(true));
    expect(error).toBeUndefined();
    expect(fake.update).toHaveBeenCalledTimes(1);
  });

  it("#143 a-AC-4（D-2）: 案件専用チャンネルは、説明だけでも 409（権限の後）", async () => {
    const fake = fakeRepository({ rows: [row({ purpose: "case" })] });
    const authorizer = fakeAuthorizer(true);
    const { error } = await doUpdate(fake, authorizer);
    expectAppError(error, "CONFLICT");
    expect(authorizeCalls(authorizer)).toHaveLength(1);
    expect(fake.update).not.toHaveBeenCalled();
  });

  it.each(["department", "announcement", "company_general"] as const)(
    "#143 a-AC-1（2-6 AC-5②・D-2）: %s は名前を送ると 409、説明だけなら書き込む",
    async (purpose) => {
      const renamed = fakeRepository({ rows: [row({ purpose })] });
      const { error } = await doUpdate(renamed, fakeAuthorizer(true), {
        name: "改名",
      });
      expectAppError(error, "CONFLICT");
      expect(renamed.update).not.toHaveBeenCalled();

      const described = fakeRepository({ rows: [row({ purpose })] });
      const ok = await doUpdate(described, fakeAuthorizer(true), {
        description: "[UNIT_TEST]説明",
      });
      expect(ok.error).toBeUndefined();
      expect(described.update).toHaveBeenCalledTimes(1);
    },
  );

  it("#143 版（重大2）: 読み込んだ版と送られた版が違えば 409（文言は計画のとおり）で、書き込まない", async () => {
    const fake = fakeRepository({ rows: [row({ version: 5 })] });
    const { error } = await doUpdate(fake, fakeAuthorizer(true), {
      version: 4,
      description: "x",
    });
    expect(expectAppError(error, "CONFLICT").userMessage).toBe(
      MESSAGES.versionMismatch,
    );
    expect(fake.update).not.toHaveBeenCalled();
  });

  it("#143 a-AC-1（2-2 AC-13）: 名前の一意索引の違反（ChannelNameTakenError）は 409「同じ名前のチャンネルがあります」", async () => {
    const fake = fakeRepository({
      rows: [row()],
      writes: [new ChannelNameTakenError()],
    });
    const { error } = await doUpdate(fake, fakeAuthorizer(true), {
      name: "重複",
    });
    expect(expectAppError(error, "CONFLICT").userMessage).toBe(
      MESSAGES.duplicateName,
    );
  });

  it("#143 a-AC-1（error-api）: 未知のエラーは握りつぶさず、そのまま投げる", async () => {
    const boom = new Error("unit test failure");
    const fake = fakeRepository({ rows: [row()], writes: [boom] });
    const { error } = await doUpdate(fake, fakeAuthorizer(true));
    expect(error).toBe(boom);
  });
});

describe("#143 a-AC-2・a-AC-4 アーカイブの判定の順", () => {
  it("#143 a-AC-2: 成功すると、宛先を読み、ULID の記録の ID・送られた版・宛先を書き込みに渡し、結果を返す", async () => {
    const fake = fakeRepository({ rows: [row({ isMember: true })] });
    const { result, error } = await doArchive(fake, fakeAuthorizer(true));
    expect(error).toBeUndefined();
    expect(result).toEqual({ id: ROOM, version: 4, deletedAt: NOW });
    expect(fake.listNotifyRecipients).toHaveBeenCalledWith(ROOM, ACTOR);
    expect(fake.archive).toHaveBeenCalledTimes(1);
    const input = fake.archive.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input).toMatchObject({
      roomId: ROOM,
      actorId: ACTOR,
      version: 3,
      reason: null,
      recipientIds: RECIPIENTS,
    });
    expect(isUlid(input.eventId)).toBe(true);
  });

  it("#143 a-AC-4: 存在しないチャンネルは、再認証がなくても 404", async () => {
    const fake = fakeRepository({ rows: [null] });
    const { error } = await doArchive(fake, fakeAuthorizer(true), {
      reauthenticatedAt: null,
    });
    expectAppError(error, "NOT_FOUND");
    expect(fake.archive).not.toHaveBeenCalled();
  });

  it.each([
    ["参加していない非公開", row({ visibility: "private" })],
    ["アーカイブ済み（誰にも見えない）", archivedRow()],
  ])(
    "#143 a-AC-4（security）: %sを管理できない人には、再認証がなくても 404。authorize を呼ばない",
    async (_label, target) => {
      const fake = fakeRepository({ rows: [target] });
      const authorizer = fakeAuthorizer(false);
      const { error } = await doArchive(fake, authorizer, {
        reauthenticatedAt: null,
      });
      expectAppError(error, "NOT_FOUND");
      expect(authorizeCalls(authorizer)).toEqual([]);
      expect(fake.archive).not.toHaveBeenCalled();
    },
  );

  it("#143 a-AC-4（計画「判定の順」）: 見える公開チャンネルを管理できない人は、再認証がなくても 403 FORBIDDEN が先（REAUTH_REQUIRED にしない）", async () => {
    const fake = fakeRepository({ rows: [row({ isMember: true })] });
    const { error } = await doArchive(fake, fakeAuthorizer(false), {
      reauthenticatedAt: null,
    });
    expectAppError(error, "FORBIDDEN");
    expect(fake.archive).not.toHaveBeenCalled();
  });

  it("#143 a-AC-2（2-6 AC-6）: 管理できる人でも、再認証がなければ 403 REAUTH_REQUIRED。種類・状態の 409 より先", async () => {
    for (const target of [
      row(),
      row({ purpose: "department" }),
      archivedRow(),
    ]) {
      const fake = fakeRepository({ rows: [target] });
      const { error } = await doArchive(fake, fakeAuthorizer(true), {
        reauthenticatedAt: null,
      });
      expectAppError(error, "REAUTH_REQUIRED");
      expect(fake.archive).not.toHaveBeenCalled();
    }
  });

  it.each(["department", "announcement", "company_general", "case"] as const)(
    "#143 a-AC-2・a-AC-4（2-6 AC-5②・AC-7、D-2）: %s はアーカイブできず 409",
    async (purpose) => {
      const fake = fakeRepository({ rows: [row({ purpose })] });
      const { error } = await doArchive(fake, fakeAuthorizer(true));
      expectAppError(error, "CONFLICT");
      expect(fake.archive).not.toHaveBeenCalled();
    },
  );

  it("#143 a-AC-2: すでにアーカイブ済みなら、管理できる人に 409「この項目はすでに処理されています」", async () => {
    const fake = fakeRepository({ rows: [archivedRow()] });
    const { error } = await doArchive(fake, fakeAuthorizer(true));
    expect(expectAppError(error, "CONFLICT").userMessage).toBe(
      MESSAGES.alreadyProcessed,
    );
    expect(fake.archive).not.toHaveBeenCalled();
  });

  it("#143 版（重大2）: 版が違えば 409（状態・種類の 409 の後、書き込みの前）", async () => {
    const fake = fakeRepository({ rows: [row({ version: 7 })] });
    const { error } = await doArchive(fake, fakeAuthorizer(true), {
      version: 6,
    });
    expect(expectAppError(error, "CONFLICT").userMessage).toBe(
      MESSAGES.versionMismatch,
    );
    expect(fake.archive).not.toHaveBeenCalled();
  });
});

describe("#143 同時の操作：書き込みの後の読み直し（アーカイブ）", () => {
  it("#143 同時の操作: 0行で操作者が無効になっていれば 401 UNAUTHENTICATED（チャンネルの状態を伝えない）", async () => {
    const fake = fakeRepository({
      rows: [row(), archivedRow()],
      writes: ["null"],
      actorActive: false,
    });
    const { error } = await doArchive(fake, fakeAuthorizer(true));
    expectAppError(error, "UNAUTHENTICATED");
  });

  it("#143 同時の操作: 前提の確認の失敗の後、操作者が無効なら 401", async () => {
    const fake = fakeRepository({
      rows: [row(), row()],
      writes: ["conflict"],
      actorActive: false,
    });
    const { error } = await doArchive(fake, fakeAuthorizer(true));
    expectAppError(error, "UNAUTHENTICATED");
  });

  it("#143 同時の操作: 読み直しで行が消えていれば 404", async () => {
    const fake = fakeRepository({ rows: [row(), null], writes: ["null"] });
    const { error } = await doArchive(fake, fakeAuthorizer(true));
    expectAppError(error, "NOT_FOUND");
  });

  it("#143 同時の操作: 読み直しで管理できなくなり、見えない（非公開・未参加）なら 404", async () => {
    const fake = fakeRepository({
      rows: [row({ visibility: "private" }), row({ visibility: "private" })],
      writes: ["conflict"],
    });
    const { error } = await doArchive(fake, fakeAuthorizer([true, false]));
    expectAppError(error, "NOT_FOUND");
  });

  it("#143 同時の操作: 読み直しで管理できなくなり、見える（公開）なら 403", async () => {
    const fake = fakeRepository({
      rows: [row(), row()],
      writes: ["conflict"],
    });
    const { error } = await doArchive(fake, fakeAuthorizer([true, false]));
    expectAppError(error, "FORBIDDEN");
  });

  it("#143 同時の操作（二重のアーカイブ）: 読み直しでアーカイブ済みなら 409「この項目はすでに処理されています」。再認証はやり直さない", async () => {
    const reauthenticatedAt = recent();
    const fake = fakeRepository({
      rows: [row(), archivedRow()],
      writes: ["conflict"],
    });
    const { error } = await doArchive(fake, fakeAuthorizer(true), {
      reauthenticatedAt,
    });
    expect(expectAppError(error, "CONFLICT").userMessage).toBe(
      MESSAGES.alreadyProcessed,
    );
    expect(fake.archive).toHaveBeenCalledTimes(1);
  });

  it("#143 版（重大2）: 読み直しで版が変わっていれば 409（版の文言）で、やり直さない", async () => {
    const fake = fakeRepository({
      rows: [row({ version: 3 }), row({ version: 4 })],
      writes: ["conflict"],
    });
    const { error } = await doArchive(fake, fakeAuthorizer(true));
    expect(expectAppError(error, "CONFLICT").userMessage).toBe(
      MESSAGES.versionMismatch,
    );
    expect(fake.archive).toHaveBeenCalledTimes(1);
  });

  it("#143 同時の操作（宛先の変化）: 状態も版も同じなら、宛先を読み直して同じ版で1回だけやり直し、成功を返す", async () => {
    const later = [...RECIPIENTS, "01JTESTMANUSER000000000004"];
    const fake = fakeRepository({
      rows: [row(), row(), row()],
      writes: ["conflict", "ok"],
      recipients: [RECIPIENTS, later],
    });
    const { result, error } = await doArchive(fake, fakeAuthorizer(true));
    expect(error).toBeUndefined();
    expect(result).toEqual({ id: ROOM, version: 4, deletedAt: NOW });
    expect(fake.archive).toHaveBeenCalledTimes(2);
    expect(fake.listNotifyRecipients).toHaveBeenCalledTimes(2);
    const second = fake.archive.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(second).toMatchObject({ version: 3, recipientIds: later });
  });

  it("#143 同時の操作（宛先の変化）: やり直しも宛先の違いで失敗したら 409「ほかの操作と重なりました。もう一度お試しください」（3回目はしない）", async () => {
    const fake = fakeRepository({
      rows: [row()],
      writes: ["conflict"],
    });
    const { error } = await doArchive(fake, fakeAuthorizer(true));
    expect(expectAppError(error, "CONFLICT").userMessage).toBe(
      MESSAGES.retryConflict,
    );
    expect(fake.archive).toHaveBeenCalledTimes(2);
  });

  it("#143 同時の操作（error-api）: 0行（null）で読み直してもどれにも当たらなければ、AppError でない例外（成功にしない）", async () => {
    const fake = fakeRepository({ rows: [row()], writes: ["null"] });
    const { result, error } = await doArchive(fake, fakeAuthorizer(true));
    expect(result).toBeUndefined();
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AppError);
  });

  it("#143 a-AC-2（error-api）: 未知の DB エラーはそのまま投げ、やり直さない", async () => {
    const boom = new Error("unit test failure");
    const fake = fakeRepository({ rows: [row()], writes: [boom] });
    const { error } = await doArchive(fake, fakeAuthorizer(true));
    expect(error).toBe(boom);
    expect(fake.archive).toHaveBeenCalledTimes(1);
  });
});

describe("#143 a-AC-3 復元の判定の順", () => {
  it("#143 a-AC-3（C-132）: アーカイブ済みを管理できる人が復元すると、開いている記録の ID と宛先を書き込みに渡し、結果を返す", async () => {
    const fake = fakeRepository({ rows: [archivedRow()] });
    const { result, error } = await doRestore(fake, fakeAuthorizer(true));
    expect(error).toBeUndefined();
    expect(result).toEqual({ id: ROOM, version: 4, restoredAt: NOW });
    expect(fake.restore).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: ROOM,
        actorId: ACTOR,
        version: 3,
        eventId: EVENT,
        recipientIds: RECIPIENTS,
      }),
    );
  });

  it("#143 a-AC-4（security）: アーカイブ済みを管理できない人（参加者でも）には、再認証がなくても 404", async () => {
    const fake = fakeRepository({ rows: [archivedRow({ isMember: true })] });
    const authorizer = fakeAuthorizer(false);
    const { error } = await doRestore(fake, authorizer, {
      reauthenticatedAt: null,
    });
    expectAppError(error, "NOT_FOUND");
    expect(authorizeCalls(authorizer)).toEqual([]);
  });

  it("#143 a-AC-3（2-6 AC-6）: 管理できる人でも、再認証がなければ 403 REAUTH_REQUIRED", async () => {
    const fake = fakeRepository({ rows: [archivedRow()] });
    const { error } = await doRestore(fake, fakeAuthorizer(true), {
      reauthenticatedAt: null,
    });
    expectAppError(error, "REAUTH_REQUIRED");
    expect(fake.restore).not.toHaveBeenCalled();
  });

  it("#143 a-AC-3（EP-2-38）: アーカイブされていなければ 409。見える公開を管理できない人は 403", async () => {
    const manager = fakeRepository({ rows: [row()] });
    expectAppError(
      (await doRestore(manager, fakeAuthorizer(true))).error,
      "CONFLICT",
    );
    expect(manager.restore).not.toHaveBeenCalled();
    const other = fakeRepository({ rows: [row({ isMember: true })] });
    expectAppError(
      (await doRestore(other, fakeAuthorizer(false))).error,
      "FORBIDDEN",
    );
  });

  it("#143 a-AC-4（D-2）: アーカイブ済みの案件専用チャンネルは、管理できる人にも 409（このAPIでは復元しない）", async () => {
    const fake = fakeRepository({ rows: [archivedRow({ purpose: "case" })] });
    const { error } = await doRestore(fake, fakeAuthorizer(true));
    expectAppError(error, "CONFLICT");
    expect(fake.restore).not.toHaveBeenCalled();
  });

  it("#143 同時の操作（アーカイブと復元）: 読み直しで復元済みなら 409", async () => {
    const fake = fakeRepository({
      rows: [archivedRow(), row({ version: 3 })],
      writes: ["conflict"],
    });
    const { error } = await doRestore(fake, fakeAuthorizer(true));
    expectAppError(error, "CONFLICT");
    expect(fake.restore).toHaveBeenCalledTimes(1);
  });

  it("#143 同時の操作（宛先の変化）: 状態も版も同じなら、1回だけやり直す", async () => {
    const fake = fakeRepository({
      rows: [archivedRow()],
      writes: ["conflict", "ok"],
    });
    const { error } = await doRestore(fake, fakeAuthorizer(true));
    expect(error).toBeUndefined();
    expect(fake.restore).toHaveBeenCalledTimes(2);
  });
});

describe("#143 同時の操作：書き込みの後の読み直し（名前・説明）", () => {
  it("#143 同時の操作: 前提の確認の失敗の後、読み直しでアーカイブ済みなら 404（EP-2-36）", async () => {
    const fake = fakeRepository({
      rows: [row(), archivedRow()],
      writes: ["conflict"],
    });
    const { error } = await doUpdate(fake, fakeAuthorizer(true));
    expectAppError(error, "NOT_FOUND");
  });

  it("#143 同時の操作: 前提の確認の失敗の後、版が変わっていれば 409（版の文言）", async () => {
    const fake = fakeRepository({
      rows: [row({ version: 3 }), row({ version: 4 })],
      writes: ["conflict"],
    });
    const { error } = await doUpdate(fake, fakeAuthorizer(true));
    expect(expectAppError(error, "CONFLICT").userMessage).toBe(
      MESSAGES.versionMismatch,
    );
  });

  it("#143 同時の操作: 前提の確認の失敗の後、操作者が無効なら 401", async () => {
    const fake = fakeRepository({
      rows: [row(), row()],
      writes: ["conflict"],
      actorActive: false,
    });
    const { error } = await doUpdate(fake, fakeAuthorizer(true));
    expectAppError(error, "UNAUTHENTICATED");
  });

  it("#143 同時の操作（error-api）: 名前・説明はやり直さず、どれにも当たらなければ AppError でない例外", async () => {
    const fake = fakeRepository({ rows: [row()], writes: ["conflict"] });
    const { error } = await doUpdate(fake, fakeAuthorizer(true));
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AppError);
    expect(fake.update).toHaveBeenCalledTimes(1);
  });
});
