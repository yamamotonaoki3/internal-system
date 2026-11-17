// #140 AC-1（1-6 AC-3）: 投稿の Service（message.service.ts の post）で、添付の結び付けが失敗した後の原因の分け方と、ほかのエラーの伝え方を確かめる。
// 本物の Repository（隔離 D1）を包み、書き込みと読み直しだけを差し替える（ミューテーションの絞った再診断への対応）。
// 期待（計画「方式」4・「判定の順」）：
//   - 結び付けの失敗（AttachmentBindError）の後の読み直しで、全部が本人・同じ部屋・同じ文脈・未使用のとき：
//     合計がちょうど200,000,000バイトなら合計の理由にしない（CONFLICT「添付の状態が変わりました。もう一度お試しください」）、
//     1バイト多ければ VALIDATION_ERROR・fields ["attachmentIds"]。
//   - AttachmentBindError 以外のエラーは、同じオブジェクトのまま伝える（原因の分け直しをしない）。
// データは架空（testuser_attbind_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TEST_TAG,
  cleanupAttachmentScenario,
  createThreadWorld,
  type ThreadWorld,
} from "../../test/attachment-fixtures";
import { fakeAuthorizer } from "../../test/dm-fixtures";
import { modifyTraceId } from "../../test/message-modify-fixtures";
import { AttachmentBindError } from "../db/attachment.repository";
import { withMessages, type MessageRepository } from "../db/message.repository";
import { createMessageService } from "./message.service";

let world: ThreadWorld;

const ID_A = "01JTESTATT0000000000000A01";
const ID_B = "01JTESTATT0000000000000A02";

type Failure = {
  code?: string;
  userMessage?: string;
  details?: { fields?: unknown };
};

async function postWith(
  overrides: Partial<MessageRepository>,
): Promise<unknown> {
  return withMessages(env, async (repository) => {
    const wrapped = { ...repository, ...overrides } as MessageRepository;
    const service = createMessageService(wrapped, {
      authorizer: fakeAuthorizer([]) as never,
    });
    try {
      await service.post(
        { userId: world.alice.userId, traceId: modifyTraceId() },
        world.channel,
        `${TEST_TAG}結び付け`,
        [],
        [ID_A, ID_B],
      );
      return null;
    } catch (error) {
      return error;
    }
  });
}

const rowsOf = (sizes: readonly [number, number]) =>
  [ID_A, ID_B].map((id, i) => ({
    id,
    uploaderId: world.alice.userId,
    roomId: world.channel,
    threadParentId: null,
    messageId: null,
    sizeBytes: sizes[i] as number,
  }));

const bindFailure = (sizes: readonly [number, number]) =>
  ({
    insertIfOrdered: async () => {
      throw new AttachmentBindError();
    },
    findAttachmentsForBinding: async () => rowsOf(sizes),
  }) as unknown as Partial<MessageRepository>;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  world = await createThreadWorld("attbind");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupAttachmentScenario();
});

describe("#140 AC-1（1-6 AC-3）結び付けの失敗の後の合計の境界", () => {
  it("#140 AC-1（1-6 AC-3）: 読み直しの合計がちょうど200,000,000バイトなら合計の理由にせず、CONFLICT「添付の状態が変わりました…」", async () => {
    const error = (await postWith(
      bindFailure([100_000_000, 100_000_000]),
    )) as Failure;
    expect(error.code).toBe("CONFLICT");
    expect(error.userMessage).toBe(
      "添付の状態が変わりました。もう一度お試しください",
    );
  });

  it('#140 AC-1（1-6 AC-3）: 読み直しの合計が1バイト多ければ VALIDATION_ERROR・fields ["attachmentIds"]', async () => {
    const error = (await postWith(
      bindFailure([100_000_000, 100_000_001]),
    )) as Failure;
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.details?.fields).toEqual(["attachmentIds"]);
  });
});

describe("#140 AC-1 結び付け以外のエラーの伝え方", () => {
  it("#140 AC-1: AttachmentBindError 以外のエラーは、読み直しをせず、同じオブジェクトのまま伝える", async () => {
    const original = new Error("[UNIT_TEST] 想定外の DB の失敗");
    let reread = 0;
    const error = await postWith({
      insertIfOrdered: async () => {
        throw original;
      },
      findAttachmentsForBinding: async () => {
        reread += 1;
        return rowsOf([1, 1]);
      },
    } as unknown as Partial<MessageRepository>);
    expect(error).toBe(original);
    expect(reread).toBe(0);
  });
});
