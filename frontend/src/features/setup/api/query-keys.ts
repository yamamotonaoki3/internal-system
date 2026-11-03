// S-34 のサーバーの状態のキー。取り直し（invalidate）や書き込みで同じものを使う。
export const setupKeys = {
  status: ["setup", "status"] as const,
};
