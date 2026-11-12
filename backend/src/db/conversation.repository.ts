// Repository：DM（1対1の会話。#136）。DB へのアクセスはこの層に閉じ込める。
// 作成は、部屋・会話・当事者2人を1つの db.batch で確定する（全部か無しか）。
// 当事者でない人に DM の中身を返す関数は作らない：読み取りはすべて「自分が当事者の会話」から入る（ADR-0012）。
import { and, eq, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  conversationMembers,
  conversations,
  departments,
  rooms,
  users,
} from "../../db/schema";
import { toPage, type CursorPayload } from "../lib/cursor";
import { isUlid } from "../lib/ulid";
import { listConversationRows } from "./conversation-list.sql";
import { withDatabase, type Database } from "./database";

/** 同じ2人の DM がすでにある（direct_key の一意制約に違反した）ときに投げる */
export class DirectConversationExistsError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("同じ2人の DM がすでにあります", options);
    this.name = "DirectConversationExistsError";
  }
}

export type DirectConversationInput = {
  roomId: string;
  directKey: string;
  userIds: [string, string];
};

export type PartnerCandidate = {
  id: string;
  displayName: string;
  isActive: boolean;
};

export type PartnerStatus = {
  kind: string;
  returnAt: string | null;
};

export type ConversationListItem = {
  roomId: string;
  partner: {
    id: string;
    displayName: string;
    isActive: boolean;
    status: PartnerStatus;
  };
  lastMessageAt: string | null;
};

export type ConversationDetailRow = {
  roomId: string;
  partner: {
    id: string;
    displayName: string;
    department: { id: string; name: string } | null;
    isActive: boolean;
    status: PartnerStatus & { message: string | null };
  };
};

// D1 のメッセージ "UNIQUE constraint failed: <表>.<列>"（原因の鎖の中にある）
function isDirectKeyViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (
      /UNIQUE constraint failed: conversations\.direct_key/i.test(
        current.message,
      )
    )
      return true;
    current = current.cause;
  }
  return false;
}

export function createConversationRepository(db: Database) {
  const partnerMember = alias(conversationMembers, "partner_member");
  return {
    async findRoomIdByDirectKey(directKey: string): Promise<string | null> {
      const rows = await db
        .select({ roomId: conversations.roomId })
        .from(conversations)
        .where(eq(conversations.directKey, directKey));
      return rows[0]?.roomId ?? null;
    },

    /** DM の相手の候補（存在と有効かの確認用） */
    async findPartnerCandidate(
      userId: string,
    ): Promise<PartnerCandidate | null> {
      const rows = await db
        .select({
          id: users.id,
          displayName: users.displayName,
          isActive: users.isActive,
        })
        .from(users)
        .where(eq(users.id, userId));
      return rows[0] ?? null;
    },

    /** 同じ2人の DM が同時に作られた場合は、後の1件が DirectConversationExistsError になり、何も残らない。それ以外の DB エラーはそのまま伝える */
    async create(input: DirectConversationInput): Promise<void> {
      try {
        await db.batch([
          db.insert(rooms).values({ id: input.roomId, kind: "direct" }),
          db
            .insert(conversations)
            .values({ roomId: input.roomId, directKey: input.directKey }),
          db.insert(conversationMembers).values(
            input.userIds.map((userId) => ({
              conversationId: input.roomId,
              userId,
            })),
          ),
        ]);
      } catch (error) {
        if (isDirectKeyViolation(error))
          throw new DirectConversationExistsError({ cause: error });
        throw error;
      }
    },

    /** 新しい順（最終活動、同じなら部屋のID）。nextCursor は古い側の続き */
    async listForUser(
      userId: string,
      options: { limit: number; cursor?: CursorPayload },
    ) {
      const rows = await listConversationRows(db, userId, {
        limit: options.limit + 1,
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      });
      const page = toPage(rows, options.limit, (row) => {
        if (!isUlid(row.room_id)) throw new Error("部屋のIDが不正です");
        return { v: row.activity_key, id: row.room_id };
      });
      return {
        items: page.items.map((row): ConversationListItem => ({
          roomId: row.room_id,
          partner: {
            id: row.partner_id,
            displayName: row.partner_display_name,
            isActive: row.partner_is_active === 1,
            status: {
              kind: row.partner_status_kind,
              returnAt: row.partner_status_return_at,
            },
          },
          lastMessageAt: row.last_message_at,
        })),
        nextCursor: page.nextCursor,
      };
    },

    /** 自分が当事者の DM だけを返す（当事者でない・存在しない・チャンネルの部屋は null で区別しない） */
    async findForMember(
      roomId: string,
      userId: string,
    ): Promise<ConversationDetailRow | null> {
      const rows = await db
        .select({
          roomId: conversations.roomId,
          partnerId: users.id,
          partnerDisplayName: users.displayName,
          partnerIsActive: users.isActive,
          departmentId: departments.id,
          departmentName: departments.name,
          statusKind: users.statusKind,
          statusReturnAt: users.statusReturnAt,
          statusMessage: users.statusMessage,
        })
        .from(conversationMembers)
        .innerJoin(
          conversations,
          eq(conversations.roomId, conversationMembers.conversationId),
        )
        .innerJoin(
          partnerMember,
          and(
            eq(partnerMember.conversationId, conversations.roomId),
            ne(partnerMember.userId, userId),
          ),
        )
        .innerJoin(users, eq(users.id, partnerMember.userId))
        .leftJoin(departments, eq(departments.id, users.departmentId))
        .where(
          and(
            eq(conversationMembers.conversationId, roomId),
            eq(conversationMembers.userId, userId),
          ),
        );
      const row = rows[0];
      if (row === undefined) return null;
      return {
        roomId: row.roomId,
        partner: {
          id: row.partnerId,
          displayName: row.partnerDisplayName,
          department:
            row.departmentId === null || row.departmentName === null
              ? null
              : { id: row.departmentId, name: row.departmentName },
          isActive: row.partnerIsActive,
          status: {
            kind: row.statusKind,
            returnAt: row.statusReturnAt,
            message: row.statusMessage,
          },
        },
      };
    },
  };
}

export type ConversationRepository = ReturnType<
  typeof createConversationRepository
>;

/** Repository を使う間だけ DB につなぐ */
export function withConversations<T>(
  env: Env,
  run: (repository: ConversationRepository) => Promise<T>,
): Promise<T> {
  return withDatabase(env, (db) => run(createConversationRepository(db)));
}
