// #147（147-B）絞ったミューテーションの生き残りへの対応：Service（case.service.ts）の判定と書き込みの分岐を、隔離 D1 と本物の Repository で確かめる。
// 期待値は計画 147-B の「API と判定の順」「判定と書き込みの条件の突き合わせ」と決定 Q1・Q2・C-133 から決める（実装から写さない）。
// 確かめること：
//   - 削除の対象が参加者でない・存在しないとき、同じ 404「参加者が見つかりません」で、存在を明かさない
//   - 最初の判定で拒否したら、Repository の書き込みを呼ばない（追加・削除・納期。batch を送らない）
//   - 書き込みが CaseStateChangedError 以外のエラーで失敗したら、読み直して別の理由に置き換えず、そのまま呼び出し元へ伝える
//   - 409・422 は logger.audit（failure）に残さない（残すのは業務の 403・404。計画の従うルール logger）
//   - 自動参加の判定は、担当部署の「オーナー」の割り当てだけを数える（一般のロールを担当部署の範囲で持つ人は外せる。C-133）
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MISSING_CASE_ID,
  cleanupCaseTestData,
  joinedAt,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  CASE_PARTICIPANT_MESSAGES,
  caseWriteSnapshot,
  participantIdsOf,
  setCaseStatus,
} from "../../test/case-participant-fixtures";
import {
  CASEREQ_NOW,
  casereqTraceId,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { insertAssignment } from "../../test/role-fixtures";
import { withCases, type CaseRepository } from "../db/case.repository";
import { AppError } from "../lib/app-error";
import { ROLE_IDS } from "../lib/permissions";
import { createCaseService } from "./case.service";

type Service = ReturnType<typeof createCaseService>;
type Run = (s: Service) => Promise<unknown>;

const WRITES = ["addParticipant", "removeParticipant", "changeDueDate"];

let w: CaseWorld;
let room: SeededCase;
let logLines: string[];

const actorOf = (userId: string) => ({ userId, traceId: casereqTraceId() });

type Override = Partial<
  Record<
    "addParticipant" | "removeParticipant" | "changeDueDate",
    () => Promise<void>
  >
>;

/** 本物の Repository を包み、書き込みの関数の呼び出しを数える。override があれば、その書き込みを置き換える */
function withService<T>(
  run: (service: ReturnType<typeof createCaseService>) => Promise<T>,
  writes: string[],
  override: Override = {},
): Promise<T> {
  return withCases(env, (repository, roles) => {
    const wrapped = new Proxy(repository, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        const name = String(property);
        if (typeof value !== "function") return value;
        if (!WRITES.includes(name)) return value.bind(target) as unknown;
        return (...args: unknown[]) => {
          writes.push(name);
          const replaced = override[name as keyof Override];
          return replaced === undefined
            ? (value as (...a: unknown[]) => unknown).apply(target, args)
            : replaced();
        };
      },
    }) as CaseRepository;
    return run(createCaseService(wrapped, roles));
  });
}

async function settle(run: () => Promise<unknown>): Promise<unknown> {
  try {
    return await run();
  } catch (error) {
    return error;
  }
}

const failureLines = () => logLines.filter((line) => line.includes("failure"));

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(CASEREQ_NOW));
  logLines = [];
  const capture = (...args: unknown[]) => {
    logLines.push(args.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  w = await setupCaseWorld();
  room = await seedCase({
    n: 95,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]147BService",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberS2.id, joinedAt: joinedAt(2) },
    ],
  });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupCaseTestData();
});

describe("#147 147-B 削除の対象が参加者でない（存在の非開示）", () => {
  it.each([
    { label: "参加者でない社員", target: () => w.memberD1.id },
    { label: "存在しない社員", target: () => MISSING_CASE_ID },
  ])(
    "#147 5-1 AC-3: $label なら 404「参加者が見つかりません」で、書き込みを呼ばない",
    async ({ target }) => {
      const writes: string[] = [];
      const before = await caseWriteSnapshot();
      const error = await settle(() =>
        withService(
          (s) => s.removeParticipant(actorOf(w.memberS1.id), room.id, target()),
          writes,
        ),
      );
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        code: "NOT_FOUND",
        userMessage: CASE_PARTICIPANT_MESSAGES.participantNotFound,
      });
      expect(writes).toEqual([]);
      expect(await caseWriteSnapshot()).toEqual(before);
    },
  );

  it("#147 存在の非開示: 参加者でない社員と存在しない社員で、同じエラー（code・文言・details）", async () => {
    const run = (target: string) =>
      settle(() =>
        withService(
          (s) => s.removeParticipant(actorOf(w.memberS1.id), room.id, target),
          [],
        ),
      );
    const a = (await run(w.memberD1.id)) as AppError;
    const b = (await run(MISSING_CASE_ID)) as AppError;
    expect([b.code, b.userMessage, b.details]).toEqual([
      a.code,
      a.userMessage,
      a.details,
    ]);
  });
});

describe("#147 147-B 最初の判定で拒否したら、書き込みを呼ばない", () => {
  it.each<{
    label: string;
    arrange: () => Promise<void>;
    run: Run;
    code: string;
  }>([
    {
      label: "終了中の案件への追加（409 closed）",
      arrange: () => setCaseStatus(room.id, "closed"),
      run: (s: Service) =>
        s.addParticipant(actorOf(w.memberS1.id), room.id, {
          userId: w.memberD1.id,
        }),
      code: "CONFLICT",
    },
    {
      label: "無効な社員の追加（422）",
      arrange: async () => {},
      run: (s: Service) =>
        s.addParticipant(actorOf(w.memberS1.id), room.id, {
          userId: w.inactive.id,
        }),
      code: "VALIDATION_ERROR",
    },
    {
      label: "すでに参加者の追加（409 already_participant）",
      arrange: async () => {},
      run: (s: Service) =>
        s.addParticipant(actorOf(w.memberS1.id), room.id, {
          userId: w.memberS2.id,
        }),
      code: "CONFLICT",
    },
    {
      label: "終了中の案件からの削除（409 closed）",
      arrange: () => setCaseStatus(room.id, "closed"),
      run: (s: Service) =>
        s.removeParticipant(actorOf(w.memberS1.id), room.id, w.memberS2.id),
      code: "CONFLICT",
    },
    {
      label: "終了中の案件の納期の変更（409 closed）",
      arrange: () => setCaseStatus(room.id, "closed"),
      run: (s: Service) =>
        s.changeDueDate(actorOf(w.memberS1.id), room.id, {
          dueDate: "2026-12-01",
        }),
      code: "CONFLICT",
    },
    {
      label: "今日より前の納期（422）",
      arrange: async () => {},
      run: (s: Service) =>
        s.changeDueDate(actorOf(w.memberS1.id), room.id, {
          dueDate: "2026-11-16",
        }),
      code: "VALIDATION_ERROR",
    },
  ])(
    "#147 147-B: $label は書き込みを呼ばず、logger.audit（failure）にも残さない",
    async ({ arrange, run, code }) => {
      await arrange();
      const writes: string[] = [];
      const error = await settle(() => withService(run, writes));
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(code);
      expect(writes).toEqual([]);
      expect(failureLines()).toEqual([]);
    },
  );

  it("#147 5-1 AC-17: 納期を null（未定）にするのは、今日より前の判定に当たらず、書き込まれる", async () => {
    await env.DB.prepare("UPDATE cases SET due_date = ? WHERE id = ?")
      .bind("2026-12-01", room.id)
      .run();
    const writes: string[] = [];
    const result = await withService(
      (s) =>
        s.changeDueDate(actorOf(w.memberS1.id), room.id, { dueDate: null }),
      writes,
    );
    expect(result).toEqual({ caseId: room.id, dueDate: null });
    expect(writes).toEqual(["changeDueDate"]);
  });
});

describe("#147 147-B CaseStateChangedError 以外のエラーは、読み直さずにそのまま伝える", () => {
  it.each<{ label: string; method: keyof Override; run: Run }>([
    {
      label: "追加",
      method: "addParticipant",
      run: (s: Service) =>
        s.addParticipant(actorOf(w.memberS1.id), room.id, {
          userId: w.memberD1.id,
        }),
    },
    {
      label: "削除",
      method: "removeParticipant",
      run: (s: Service) =>
        s.removeParticipant(actorOf(w.memberS1.id), room.id, w.memberS2.id),
    },
    {
      label: "納期の変更",
      method: "changeDueDate",
      run: (s: Service) =>
        s.changeDueDate(actorOf(w.memberS1.id), room.id, {
          dueDate: "2026-12-01",
        }),
    },
  ])(
    "#147 147-B: $label の書き込みが未知のエラーで失敗したら（その間に案件が終了していても）、409 に置き換えず、同じエラーを投げる",
    async ({ method, run }) => {
      const unknown = new Error("[UNIT_TEST] 未知の DB エラー");
      const error = await settle(() =>
        withService(run, [], {
          [method]: async () => {
            // 読み直すと 409 closed になる状態にしてから失敗する
            await setCaseStatus(room.id, "closed");
            throw unknown;
          },
        }),
      );
      expect(error).toBe(unknown);
    },
  );
});

describe("#147 147-B C-133: 自動参加の判定は担当部署のオーナーの割り当てだけ", () => {
  it("#147 C-133: 担当部署の範囲で一般のロール（オーナーでない）を持つ参加者は、自動参加の人でなく、外せる（204 相当）", async () => {
    await insertAssignment(
      w.memberS2.id,
      ROLE_IDS.member,
      "department",
      w.deptS.id,
    );
    const detail = await withService(
      (s) => s.detail(actorOf(w.memberS1.id), room.id),
      [],
    );
    const target = detail.participants.find((p) => p.userId === w.memberS2.id);
    expect(target).toMatchObject({ autoRole: null, removable: true });
    await withService(
      (s) =>
        s.removeParticipant(actorOf(w.memberS1.id), room.id, w.memberS2.id),
      [],
    );
    expect(await participantIdsOf(room.roomId)).toEqual([w.memberS1.id]);
  });

  it("#147 C-133: 担当部署でない部署のオーナーの割り当てを持つ参加者は、自動参加の人でなく、外せる", async () => {
    await insertAssignment(w.memberS2.id, ROLE_IDS.member, "company", null);
    await env.DB.prepare(
      "INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES (?, ?, ?)",
    )
      .bind(room.roomId, w.ownerD.id, joinedAt(3))
      .run();
    const detail = await withService(
      (s) => s.detail(actorOf(w.memberS1.id), room.id),
      [],
    );
    for (const id of [w.ownerD.id, w.memberS2.id])
      expect(detail.participants.find((p) => p.userId === id)).toMatchObject({
        autoRole: null,
        removable: true,
      });
    await withService(
      (s) => s.removeParticipant(actorOf(w.memberS1.id), room.id, w.ownerD.id),
      [],
    );
    expect(await participantIdsOf(room.roomId)).not.toContain(w.ownerD.id);
  });
});
