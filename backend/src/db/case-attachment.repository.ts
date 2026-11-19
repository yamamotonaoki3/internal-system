// Repository：案件の添付の一覧（#148 の 148-B-1。EP-5-19）。DB へのアクセスはこの層に閉じ込める。
// 読み取り：中身（ファイル名・投稿者）を読む文に、その時点の閲覧の資格（閲覧者が有効な参加者で、部屋を見てよい）を入れる。
// 確かめてから別の文で読まない（#196）。資格の確認と一覧は1つの batch で読み、資格がなければ中身を捨てる。
// 一覧の範囲は配信（attachment-visibility.sql.ts の attachmentVisible）と同じ規則。どちらかを変えるときは、両方を直す。
//   部屋は roomViewableBy、投稿に結び付いた添付だけ（未投稿は結合で除く）、メッセージが削除されていない（返信の親の削除は見ない）。
// 公開範囲の変更（EP-1-23）：最初の判定の材料（findVisibilityFacts）の条件を、書き込みの条件（visibilityChangeCondition。独立した EXISTS）に
// 全部入れ、UPDATE と監査を同じ batch に入れる（監査が先。両方が同じ「更新前」の時点の条件を見る）。0行なら AttachmentStateChangedError。
import { and, desc, eq, isNull, lt, sql, type SQL } from "drizzle-orm";
import { cases, messageAttachments, messages, users } from "../../db/schema";
import type { PublicationVisibility } from "../../../shared/attachment-rules";
import { decodeCursor, toPage } from "../lib/cursor";
import { attachmentVisible } from "./attachment-visibility.sql";
import { auditLogInsert } from "./audit-log.repository";
import { canManageSql } from "./case-access.sql";
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
  publicationVisibility: PublicationVisibility;
  /** 閲覧者が公開範囲を変えられるか（本人か管理の資格で、案件が進行中） */
  canChangeVisibility: boolean;
};

/** 公開範囲の変更の判定の材料。見えない・存在しない添付は null */
export type AttachmentVisibilityFacts = {
  messageId: string | null;
  uploaderId: string;
  publicationVisibility: PublicationVisibility;
  /** 案件専用チャンネルの添付でなければ null */
  caseId: string | null;
  caseStatus: "active" | "closed" | null;
  actorIsParticipant: boolean;
  actorCanManage: boolean;
};

export type AttachmentVisibilityChange = {
  attachmentId: string;
  actorId: string;
  caseId: string;
  before: PublicationVisibility;
  after: PublicationVisibility;
  traceId: string;
};

/** 公開範囲の書き込みの前提が、判定の後に崩れていた（0行。原因は Service が読み直して分ける） */
export class AttachmentStateChangedError extends Error {
  constructor() {
    super("添付の状態が変わりました");
    this.name = "AttachmentStateChangedError";
  }
}

/**
 * 公開範囲を書き込んでよい条件（findVisibilityFacts と Service の判定を、そのまま SQL にしたもの）。
 * 外側の行に依存しない独立した EXISTS にする（監査の INSERT … SELECT〔FROM なし〕と UPDATE の WHERE の両方に入れるため）。
 * 内側の message_attachments は別名を付けない：attachmentVisible が表の名前つきで列を参照し、SQLite は内側の表として解釈する。
 * 審査中・承認済みの公開申請の条件は、公開申請の機能（要件 5-5）で足す。
 */
function visibilityChangeCondition(input: {
  attachmentId: string;
  actorId: string;
  before: PublicationVisibility;
}): SQL {
  return sql`EXISTS (SELECT 1 FROM message_attachments
    JOIN cases ck ON ck.channel_id = message_attachments.room_id
    WHERE message_attachments.id = ${input.attachmentId}
      AND message_attachments.message_id IS NOT NULL
      AND ${attachmentVisible(input.actorId)}
      AND ${activeChannelMember(sql`ck.channel_id`, input.actorId)}
      AND ck.status = 'active'
      AND (message_attachments.uploader_id = ${input.actorId} OR ${canManageSql(input.actorId, sql`ck.id`)})
      AND message_attachments.publication_visibility = ${input.before})`;
}

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
            publicationVisibility:
              sql<string>`${messageAttachments.publicationVisibility}`.as(
                "publication_visibility",
              ),
            // 変更の書き込みの条件のうち、参加の資格（WHERE の visible が求める）以外を、同じ文の中で決める
            canChangeVisibility:
              sql<number>`CASE WHEN EXISTS (SELECT 1 FROM cases vk WHERE vk.id = ${input.caseId} AND vk.status = 'active')
              AND (${sql`${messageAttachments.uploaderId}`} = ${input.viewerId} OR ${canManageSql(input.viewerId, sql`${input.caseId}`)})
              THEN 1 ELSE 0 END`.as("can_change_visibility"),
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
          publicationVisibility:
            row.publicationVisibility as PublicationVisibility,
          canChangeVisibility: row.canChangeVisibility === 1,
        })),
        nextCursor: page.nextCursor,
      };
    },

    /** 公開範囲の変更の判定の材料。見えない（attachmentVisible）・存在しない添付は null */
    async findVisibilityFacts(input: {
      attachmentId: string;
      actorId: string;
    }): Promise<AttachmentVisibilityFacts | null> {
      // 外側の列は入れ子の SQL で渡し（表の名前つきで書き出される）、内側の cases には別名を付ける
      const roomId = sql`${messageAttachments.roomId}`;
      const [row] = await db
        .select({
          messageId: messageAttachments.messageId,
          uploaderId: messageAttachments.uploaderId,
          publicationVisibility: messageAttachments.publicationVisibility,
          caseId: sql<
            string | null
          >`(SELECT ck.id FROM cases ck WHERE ck.channel_id = ${roomId})`.as(
            "case_id",
          ),
          caseStatus: sql<
            string | null
          >`(SELECT ck.status FROM cases ck WHERE ck.channel_id = ${roomId})`.as(
            "case_status",
          ),
          actorIsParticipant:
            sql<number>`CASE WHEN ${activeChannelMember(roomId, input.actorId)} THEN 1 ELSE 0 END`.as(
              "actor_is_participant",
            ),
          actorCanManage:
            sql<number>`CASE WHEN EXISTS (SELECT 1 FROM cases ck WHERE ck.channel_id = ${roomId}
              AND ${canManageSql(input.actorId, sql`ck.id`)}) THEN 1 ELSE 0 END`.as(
              "actor_can_manage",
            ),
        })
        .from(messageAttachments)
        .where(
          and(
            eq(messageAttachments.id, input.attachmentId),
            attachmentVisible(input.actorId),
          ),
        )
        .limit(1);
      if (row === undefined) return null;
      return {
        messageId: row.messageId,
        uploaderId: row.uploaderId,
        publicationVisibility:
          row.publicationVisibility as PublicationVisibility,
        caseId: row.caseId,
        caseStatus: row.caseStatus as "active" | "closed" | null,
        actorIsParticipant: row.actorIsParticipant === 1,
        actorCanManage: row.actorCanManage === 1,
      };
    },

    /** 公開範囲の変更と監査（同じ batch）。条件を満たさず0行なら AttachmentStateChangedError */
    async changeVisibility(input: AttachmentVisibilityChange): Promise<void> {
      const condition = visibilityChangeCondition(input);
      const [, updated] = await db.batch([
        auditLogInsert(
          db,
          {
            actorId: input.actorId,
            action: "case.attachment.visibility.change",
            targetType: "attachment",
            targetId: input.attachmentId,
            result: "success",
            traceId: input.traceId,
            detail: {
              caseId: input.caseId,
              before: input.before,
              after: input.after,
            },
          },
          { onlyWhen: condition },
        ),
        db
          .update(messageAttachments)
          .set({ publicationVisibility: input.after })
          .where(and(eq(messageAttachments.id, input.attachmentId), condition))
          .returning({ id: messageAttachments.id }),
      ]);
      if (updated.length === 0) throw new AttachmentStateChangedError();
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
