// Repository：案件の添付の一覧（#148 の 148-B-1。EP-5-19）。DB へのアクセスはこの層に閉じ込める。
// 読み取り：中身（ファイル名・投稿者）を読む文に、その時点の閲覧の資格（閲覧者が有効な参加者で、部屋を見てよい）を入れる。
// 確かめてから別の文で読まない（#196）。資格の確認と一覧は1つの batch で読み、資格がなければ中身を捨てる。
// 一覧の範囲は配信（attachment-visibility.sql.ts の attachmentVisible）と同じ規則。どちらかを変えるときは、両方を直す。
//   部屋は roomViewableBy、投稿に結び付いた添付だけ（未投稿は結合で除く）、メッセージが削除されていない（返信の親の削除は見ない）。
import { and, desc, eq, isNull, lt, sql, type SQL } from "drizzle-orm";
import { cases, messageAttachments, messages, users } from "../../db/schema";
import { decodeCursor, toPage } from "../lib/cursor";
import { activeChannelMember } from "./channel-member.sql";
import { withDatabase, type Database } from "./database";
import {
  createRoleAssignmentRepository,
  type RoleAssignmentRepository,
} from "./role-assignment.repository";
import { roomViewableBy } from "./room-visibility.sql";

export type CaseAttachmentItem = {
  id: string;
  name: string;
  kind: string;
  contentType: string;
  size: number;
  /** 添付の時刻（アップロードの時刻） */
  uploadedAt: string;
  messageId: string;
  /** 元のメッセージが返信なら親の ID、トップレベルなら null */
  threadParentId: string | null;
  /** 表示名は、利用者のいまの表示名 */
  uploader: { id: string; displayName: string; isActive: boolean };
};

export type CaseAttachmentPage = {
  items: CaseAttachmentItem[];
  nextCursor: string | null;
};

/** 閲覧者が、案件（別名 vc）の有効な参加者で、その部屋を見てよいこと（中身の読み取りの資格） */
function visibleTo(caseId: string, viewerId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM cases vc WHERE vc.id = ${caseId}
    AND ${activeChannelMember(sql`vc.channel_id`, viewerId)}
    AND ${roomViewableBy(sql`vc.channel_id`, viewerId)})`;
}

export function createCaseAttachmentRepository(db: Database) {
  return {
    /** 判定の材料（Service の 404・403）。案件がなければ null */
    async findAttachmentListFacts(input: {
      caseId: string;
      actorId: string;
    }): Promise<{ isParticipant: boolean } | null> {
      const [row] = await db
        .select({
          isParticipant:
            sql<number>`CASE WHEN ${activeChannelMember(sql`${cases.channelId}`, input.actorId)} THEN 1 ELSE 0 END`.as(
              "is_participant",
            ),
        })
        .from(cases)
        .where(eq(cases.id, input.caseId))
        .limit(1);
      if (row === undefined) return null;
      return { isParticipant: row.isParticipant === 1 };
    },

    /** 一覧：添付の ID の降順（新しい順）。1つの batch で、案件と資格・項目を読む。資格がなければ中身を捨てる */
    async listCaseAttachments(input: {
      caseId: string;
      viewerId: string;
      limit: number;
      cursor: string | null;
    }): Promise<CaseAttachmentPage | "not_found" | "not_visible"> {
      const visible = visibleTo(input.caseId, input.viewerId);
      const before =
        input.cursor === null
          ? undefined
          : lt(messageAttachments.id, decodeCursor(input.cursor).id);
      const [caseRows, rows] = await db.batch([
        db
          .select({
            visible: sql<number>`CASE WHEN ${visible} THEN 1 ELSE 0 END`,
          })
          .from(cases)
          .where(eq(cases.id, input.caseId))
          .limit(1),
        // 部屋のメッセージ（messages_room_id_id_idx）から添付（message_attachments_message_id_idx）を辿る。
        // CROSS JOIN は SQLite で結合の順を固定する。添付の主キーを逆順に全件走査する計画を選ばせないため
        // 3つの表に同じ名前の列（id など）があるので、選択項目に別名を付けて、列の名前を重ねない
        db
          .select({
            id: sql<string>`${messageAttachments.id}`.as("attachment_id"),
            name: messageAttachments.originalName,
            kind: messageAttachments.kind,
            contentType: messageAttachments.contentType,
            size: messageAttachments.sizeBytes,
            uploadedAt: messageAttachments.createdAt,
            messageId: sql<string>`${messages.id}`.as("message_id"),
            threadParentId: messages.parentMessageId,
            uploaderId: sql<string>`${users.id}`.as("uploader_id"),
            uploaderName: sql<string>`${users.displayName}`.as("uploader_name"),
            uploaderActive: sql<number>`${users.isActive}`.as(
              "uploader_active",
            ),
          })
          .from(messages)
          .crossJoin(messageAttachments)
          .innerJoin(users, eq(users.id, messageAttachments.uploaderId))
          .where(
            and(
              eq(
                messages.roomId,
                sql`(SELECT k.channel_id FROM cases k WHERE k.id = ${input.caseId})`,
              ),
              isNull(messages.deletedAt),
              eq(messageAttachments.messageId, messages.id),
              eq(messageAttachments.roomId, messages.roomId),
              visible,
              before,
            ),
          )
          .orderBy(desc(messageAttachments.id))
          .limit(input.limit + 1),
      ]);
      const [found] = caseRows;
      if (found === undefined) return "not_found";
      if (found.visible !== 1) return "not_visible";
      const page = toPage(rows, input.limit, (row) => ({
        v: row.id,
        id: row.id,
      }));
      return {
        items: page.items.map((row) => ({
          id: row.id,
          name: row.name,
          kind: row.kind,
          contentType: row.contentType,
          size: row.size,
          uploadedAt: row.uploadedAt,
          messageId: row.messageId,
          threadParentId: row.threadParentId,
          uploader: {
            id: row.uploaderId,
            displayName: row.uploaderName,
            isActive: row.uploaderActive === 1,
          },
        })),
        nextCursor: page.nextCursor,
      };
    },
  };
}

export type CaseAttachmentRepository = ReturnType<
  typeof createCaseAttachmentRepository
>;

export function withCaseAttachments<T>(
  env: Env,
  run: (
    repository: CaseAttachmentRepository,
    roles: RoleAssignmentRepository,
  ) => Promise<T>,
): Promise<T> {
  return withDatabase(env, (db) =>
    run(createCaseAttachmentRepository(db), createRoleAssignmentRepository(db)),
  );
}
