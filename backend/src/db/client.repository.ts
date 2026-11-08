import { and, asc, eq, or, sql, type SQL } from "drizzle-orm";
import { clients } from "../../db/schema";
import { clientNameKey } from "../../../shared/client-rules";
import { afterCursor, toPage, type CursorPayload } from "../lib/cursor";
import { isUlid } from "../lib/ulid";
import { auditLogInsert } from "./audit-log.repository";
import { withDatabase, type Database } from "./database";
import {
  createRoleAssignmentRepository,
  type RoleAssignmentRepository,
} from "./role-assignment.repository";

export type ClientAdmin = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  version: number;
};
export type ClientPublic = Omit<ClientAdmin, "version">;
export type ClientCandidate = Pick<ClientAdmin, "id" | "code" | "name">;
export type ClientStatus = "all" | "active" | "inactive";
export type ClientListOptions = {
  q: string;
  status?: ClientStatus;
  limit: number;
  cursor?: CursorPayload;
};
export type ClientWrite = { actorId: string; traceId: string };

export class DuplicateClientError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("取引先の名前またはコードが重複しています", options);
    this.name = "DuplicateClientError";
  }
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (/UNIQUE constraint failed/i.test(current.message)) return true;
    if ((current as { code?: unknown }).code === "23505") return true;
    current = current.cause;
  }
  return false;
}

function cursorFor(row: { id: string; code: string }): CursorPayload {
  if (!isUlid(row.id)) throw new Error("取引先IDが不正です");
  return { v: row.code, id: row.id };
}

const adminColumns = {
  id: clients.id,
  code: clients.code,
  name: clients.name,
  active: clients.isActive,
  version: clients.version,
};

function listWhere(options: ClientListOptions): SQL | undefined {
  const conditions: SQL[] = [];
  if (options.status && options.status !== "all")
    conditions.push(eq(clients.isActive, options.status === "active"));
  if (options.q !== "") {
    const key = clientNameKey(options.q);
    const match = or(
      sql`instr(${clients.nameNormalized}, ${key}) > 0`,
      sql`instr(lower(${clients.code}), ${key}) > 0`,
    );
    if (match) conditions.push(match);
  }
  if (options.cursor)
    conditions.push(
      afterCursor(
        { sort: clients.code, id: clients.id },
        options.cursor,
        "asc",
      ),
    );
  return conditions.length === 0 ? undefined : and(...conditions);
}

export function createClientRepository(db: Database) {
  return {
    async listAdmin(options: ClientListOptions) {
      const rows = await db
        .select(adminColumns)
        .from(clients)
        .where(listWhere(options))
        .orderBy(asc(clients.code), asc(clients.id))
        .limit(options.limit + 1);
      return toPage(rows, options.limit, cursorFor);
    },
    async listPublic(options: ClientListOptions) {
      const rows = await db
        .select({
          id: clients.id,
          code: clients.code,
          name: clients.name,
          active: clients.isActive,
        })
        .from(clients)
        .where(listWhere(options))
        .orderBy(asc(clients.code), asc(clients.id))
        .limit(options.limit + 1);
      return toPage(rows, options.limit, cursorFor);
    },
    async listCandidates(options: ClientListOptions) {
      const rows = await db
        .select({
          id: clients.id,
          code: clients.code,
          name: clients.name,
        })
        .from(clients)
        .where(listWhere({ ...options, status: "active" }))
        .orderBy(asc(clients.code), asc(clients.id))
        .limit(options.limit + 1);
      return toPage(rows, options.limit, cursorFor);
    },
    async findById(id: string): Promise<ClientAdmin | null> {
      const rows = await db
        .select(adminColumns)
        .from(clients)
        .where(eq(clients.id, id))
        .limit(1);
      return rows[0] ?? null;
    },
    async create(
      input: { id: string; code: string; name: string; nameNormalized: string },
      write: ClientWrite,
    ): Promise<ClientAdmin> {
      try {
        const [rows] = await db.batch([
          db.insert(clients).values(input).returning(adminColumns),
          auditLogInsert(db, {
            actorId: write.actorId,
            action: "client.create",
            targetType: "client",
            targetId: input.id,
            result: "success",
            traceId: write.traceId,
          }),
        ]);
        const created = rows[0];
        if (!created) throw new Error("取引先の登録結果がありません");
        return created;
      } catch (error) {
        if (isUniqueViolation(error))
          throw new DuplicateClientError({ cause: error });
        throw error;
      }
    },
    async rename(
      id: string,
      version: number,
      name: string,
      nameNormalized: string,
      write: ClientWrite,
    ): Promise<ClientAdmin | null> {
      try {
        const [rows] = await db.batch([
          db
            .update(clients)
            .set({
              name,
              nameNormalized,
              version: sql`${clients.version} + 1`,
              updatedAt: sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
            })
            .where(
              and(
                eq(clients.id, id),
                eq(clients.version, version),
                eq(clients.isActive, true),
              ),
            )
            .returning(adminColumns),
          auditLogInsert(
            db,
            {
              actorId: write.actorId,
              action: "client.rename",
              targetType: "client",
              targetId: id,
              result: "success",
              traceId: write.traceId,
              detail: { previousVersion: version, nextVersion: version + 1 },
            },
            { onlyWhen: sql`changes() = 1` },
          ),
        ]);
        return rows[0] ?? null;
      } catch (error) {
        if (isUniqueViolation(error))
          throw new DuplicateClientError({ cause: error });
        throw error;
      }
    },
    async deactivate(
      id: string,
      version: number,
      write: ClientWrite,
    ): Promise<ClientAdmin | null> {
      const [rows] = await db.batch([
        db
          .update(clients)
          .set({
            isActive: false,
            version: sql`${clients.version} + 1`,
            updatedAt: sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
          })
          .where(
            and(
              eq(clients.id, id),
              eq(clients.version, version),
              eq(clients.isActive, true),
              sql`${clients.code} <> 'INT'`,
            ),
          )
          .returning(adminColumns),
        auditLogInsert(
          db,
          {
            actorId: write.actorId,
            action: "client.deactivate",
            targetType: "client",
            targetId: id,
            result: "success",
            traceId: write.traceId,
            detail: { previousVersion: version, nextVersion: version + 1 },
          },
          { onlyWhen: sql`changes() = 1` },
        ),
      ]);
      return rows[0] ?? null;
    },
  };
}

export type ClientRepository = ReturnType<typeof createClientRepository>;
export function withClients<T>(
  env: Env,
  run: (
    repository: ClientRepository,
    roles: RoleAssignmentRepository,
  ) => Promise<T>,
): Promise<T> {
  return withDatabase(env, (db) =>
    run(createClientRepository(db), createRoleAssignmentRepository(db)),
  );
}
