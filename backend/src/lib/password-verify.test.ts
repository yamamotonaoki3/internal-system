// #120 AC-2：ログインの検証と再ハッシュ（ADR-0007。scrypt N=2^16・r=8・p=2、PHC形式）。
// 計画の最終の修正 1：利用者なし・形式不正・現行ハッシュは、どれも「現行の設定の計算1回」にそろえる。
// 旧パラメータのハッシュは、本物の検証（旧パラメータ）で成否を決め、追加のダミー計算はしない（既知の限界）。
// 計算の内容（パラメータ）を記録するため、計算の関数（deps.derive）を差し替える。中身は本物の scrypt に任せる。
import { SCRYPT_TEST_TIMEOUT_MS } from "../../test/auth-fixtures";
import { scrypt } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  hashPassword,
  needsRehash,
  verifyPasswordConstantCost,
} from "./password";

const TEST_PASSWORD = "TestPass123!";
const CURRENT = { logN: 16, r: 8, p: 2 };

type Params = { logN: number; r: number; p: number; keyLength: number };

const realDerive = (password: string, salt: Uint8Array, params: Params) =>
  new Promise<Uint8Array>((resolve, reject) => {
    const n = 2 ** params.logN;
    scrypt(
      password,
      salt,
      params.keyLength,
      {
        N: n,
        r: params.r,
        p: params.p,
        maxmem: 128 * n * params.r * 2 + 2 ** 20,
      },
      (error, key) => (error === null ? resolve(key) : reject(error)),
    );
  });

/** 計算のたびにパラメータを記録する、計算の関数 */
function recordingDerive() {
  const calls: Params[] = [];
  const derive = (password: string, salt: Uint8Array, params: Params) => {
    calls.push(params);
    return realDerive(password, salt, params);
  };
  return { calls, derive };
}

const b64 = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString("base64").replace(/=+$/, "");

/** 合成した旧パラメータのハッシュ（ln=14）。将来のパラメータ変更の後に残るハッシュの代わり */
async function legacyHash(password: string, logN = 14, r = 8, p = 1) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await realDerive(password, salt, { logN, r, p, keyLength: 32 });
  return `$scrypt$ln=${logN},r=${r},p=${p}$${b64(salt)}$${b64(key)}`;
}

describe(
  "needsRehash（再ハッシュが必要か）",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    it("#120 AC-2: 現行のパラメータ（ln=16,r=8,p=2）のハッシュは、再ハッシュしない", async () => {
      expect(needsRehash(await hashPassword(TEST_PASSWORD))).toBe(false);
    });

    it("#120 AC-2: ln・r・p のどれかが現行と違えば、再ハッシュする", () => {
      const salt = "c2FsdHNhbHRzYWx0";
      const key = "aGFzaGhhc2hoYXNoaGFzaA";
      for (const params of [
        "ln=14,r=8,p=2",
        "ln=16,r=4,p=2",
        "ln=16,r=8,p=1",
      ]) {
        expect(needsRehash(`$scrypt$${params}$${salt}$${key}`), params).toBe(
          true,
        );
      }
    });
  },
);

describe(
  "verifyPasswordConstantCost（時間差を作らない検証）",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    it("#120 AC-2: 現行ハッシュの正しいパスワードは true、誤りは false", async () => {
      const stored = await hashPassword(TEST_PASSWORD);
      expect(await verifyPasswordConstantCost(TEST_PASSWORD, stored)).toBe(
        true,
      );
      expect(await verifyPasswordConstantCost("WrongPass123!", stored)).toBe(
        false,
      );
    });

    it("#120 AC-1・0-2 AC-7: 利用者なし（null）・形式不正・別方式のハッシュは false で、例外にしない", async () => {
      for (const stored of [
        null,
        "",
        "not-a-hash",
        "$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA",
        "$scrypt$ln=99,r=8,p=2$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA",
      ]) {
        await expect(
          verifyPasswordConstantCost(TEST_PASSWORD, stored),
          String(stored),
        ).resolves.toBe(false);
      }
    });

    it("#120 0-2 AC-7（最終の修正 1）: 現行ハッシュ・利用者なし・形式不正は、どれも現行のパラメータで1回だけ計算する", async () => {
      const stored = await hashPassword(TEST_PASSWORD);
      const cases: [string, string | null, string][] = [
        ["現行ハッシュ（正しい）", stored, TEST_PASSWORD],
        ["現行ハッシュ（誤り）", stored, "WrongPass123!"],
        ["利用者なし", null, TEST_PASSWORD],
        ["形式不正", "not-a-hash", TEST_PASSWORD],
        [
          "上限を超えるパラメータ",
          "$scrypt$ln=20,r=8,p=2$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA",
          TEST_PASSWORD,
        ],
      ];
      for (const [label, hash, password] of cases) {
        const { calls, derive } = recordingDerive();
        await verifyPasswordConstantCost(password, hash, { derive });
        expect(calls, label).toHaveLength(1);
        expect(calls[0], label).toMatchObject(CURRENT);
      }
    });

    it("#120 AC-2（最終の修正 1(b)）: 旧パラメータのハッシュは、旧パラメータで本物の検証をして成否を決める（追加のダミー計算はしない）", async () => {
      const stored = await legacyHash(TEST_PASSWORD);
      const ok = recordingDerive();
      expect(
        await verifyPasswordConstantCost(TEST_PASSWORD, stored, {
          derive: ok.derive,
        }),
      ).toBe(true);
      expect(ok.calls).toEqual([
        expect.objectContaining({ logN: 14, r: 8, p: 1 }),
      ]);

      const ng = recordingDerive();
      expect(
        await verifyPasswordConstantCost("WrongPass123!", stored, {
          derive: ng.derive,
        }),
      ).toBe(false);
      expect(ng.calls).toHaveLength(1);
      expect(needsRehash(stored)).toBe(true);
    });
  },
);
