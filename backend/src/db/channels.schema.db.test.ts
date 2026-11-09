// #196 AC-3・AC-5（計画 4章・計画レビュー 4）: rooms・channels・channel_members の制約を、マイグレーション済みの D1 に直接書いて確かめる。
// purpose の値は data-model.md の決定どおり normal・department・announcement・case・company_general。'case' は値の予約だけ（表や機能は作らない）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TEST_TAG,
  cleanupDepartmentTestData,
  insertChannel,
  insertDepartmentWithChannels,
  insertMember,
  type ChannelPurpose,
  type SeededDepartment,
} from "../../test/department-fixtures";
import { insertUser } from "../../test/role-fixtures";

let dept: SeededDepartment;
let sequence = 0;
const uniqueName = (label: string) => {
  sequence += 1;
  return `${TEST_TAG}${label}${sequence}`;
};

beforeEach(async () => {
  dept = await insertDepartmentWithChannels("制約");
});
afterEach(async () => {
  await cleanupDepartmentTestData();
});

async function channelCount() {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM channels").first<{
    n: number;
  }>();
  return row?.n;
}

describe("#196 channels の制約（D1）", () => {
  it.each<ChannelPurpose>(["normal", "case"])(
    "#196 AC-5（計画レビュー 4）: purpose '%s' は部署の有無・公開範囲によらず保存できる",
    async (purpose) => {
      await insertChannel({
        name: uniqueName(purpose),
        purpose,
        departmentId: dept.id,
        visibility: "private",
      });
      await insertChannel({
        name: uniqueName(purpose),
        purpose,
        departmentId: null,
      });
    },
  );

  it("#196 AC-5（計画レビュー 4）: purpose に決めていない値は拒否する", async () => {
    const before = await channelCount();
    await expect(
      insertChannel({
        name: uniqueName("bad"),
        purpose: "unknown" as ChannelPurpose,
        departmentId: null,
      }),
    ).rejects.toThrow();
    expect(await channelCount()).toBe(before);
  });

  it("#196 AC-5（S-2）: company_general は会社直属（department_id が NULL）だけ", async () => {
    await insertChannel({
      name: uniqueName("全社"),
      purpose: "company_general",
      departmentId: null,
    });
    await expect(
      insertChannel({
        name: uniqueName("全社"),
        purpose: "company_general",
        departmentId: dept.id,
      }),
    ).rejects.toThrow();
  });

  it.each<ChannelPurpose>(["department", "announcement"])(
    "#196 AC-3（7-1 AC-1）: purpose '%s' は部署が必須で、公開だけ",
    async (purpose) => {
      const other = await insertDepartmentWithChannels(`制約${purpose}`);
      // 既存の自動チャンネルとの部分一意に当たらないよう、自動チャンネルを持たない部署で確かめる
      await env.DB.prepare(
        "DELETE FROM channels WHERE department_id = ? AND purpose = ?",
      )
        .bind(other.id, purpose)
        .run();
      await expect(
        insertChannel({
          name: uniqueName(purpose),
          purpose,
          departmentId: null,
        }),
      ).rejects.toThrow();
      await expect(
        insertChannel({
          name: uniqueName(purpose),
          purpose,
          departmentId: other.id,
          visibility: "private",
        }),
      ).rejects.toThrow();
      await insertChannel({
        name: uniqueName(purpose),
        purpose,
        departmentId: other.id,
      });
    },
  );

  it.each<ChannelPurpose>(["department", "announcement"])(
    "#196 AC-3（7-1 AC-1）: 1つの部署に purpose '%s' のチャンネルは1つだけ（部分一意）",
    async (purpose) => {
      await expect(
        insertChannel({
          name: uniqueName(purpose),
          purpose,
          departmentId: dept.id,
        }),
      ).rejects.toThrow();
    },
  );

  it("#196 AC-3: 通常のチャンネルは、1つの部署に複数作れる（部分一意は自動チャンネルだけ）", async () => {
    await insertChannel({
      name: uniqueName("通常"),
      purpose: "normal",
      departmentId: dept.id,
    });
    await insertChannel({
      name: uniqueName("通常"),
      purpose: "normal",
      departmentId: dept.id,
    });
  });

  it("#196 AC-3（7-1 2026-11-08承認・V-25）: 比較キーはアーカイブ済みを含めて会社内で一意", async () => {
    const name = uniqueName("一意");
    await insertChannel({
      name,
      purpose: "normal",
      departmentId: null,
      archived: true,
    });
    await expect(
      insertChannel({
        name: name.toUpperCase(),
        purpose: "normal",
        departmentId: dept.id,
      }),
    ).rejects.toThrow(/UNIQUE/i);
  });

  it("#196 AC-5: rooms の kind は channel・conversation だけ", async () => {
    await expect(
      env.DB.prepare(
        "INSERT INTO rooms (id, kind, created_at) VALUES ('01JUNITROOMKIND00000000000', 'other', '2026-11-09T00:00:00.000Z')",
      ).run(),
    ).rejects.toThrow();
  });

  it("#196 AC-3: channel_members は同じ人を同じチャンネルに2回入れられず、存在しないチャンネル・社員は外部キーで拒否する", async () => {
    const user = await insertUser("testuser_dept_schema", dept.id);
    await insertMember(dept.dedicatedChannelId, user);
    await expect(insertMember(dept.dedicatedChannelId, user)).rejects.toThrow();
    await expect(
      insertMember("01JUNITNOROOM0000000000000", user),
    ).rejects.toThrow();
    await expect(
      insertMember(dept.dedicatedChannelId, "01JUNITNOUSER0000000000000"),
    ).rejects.toThrow();
  });

  it("#196 AC-1: 既存の部署に足した列（説明・版）の既定値は空文字と1", async () => {
    const id = "01JUNITDEPTDEFAULT00000000";
    await env.DB.prepare(
      "INSERT INTO departments (id, name, name_normalized, is_active, created_at) VALUES (?, ?, ?, 1, '2026-11-09T00:00:00.000Z')",
    )
      .bind(id, `${TEST_TAG}既定値`, `${TEST_TAG}既定値`.toLowerCase())
      .run();
    const row = await env.DB.prepare(
      "SELECT description, version FROM departments WHERE id = ?",
    )
      .bind(id)
      .first<{ description: string; version: number }>();
    expect(row).toEqual({ description: "", version: 1 });
  });
});
