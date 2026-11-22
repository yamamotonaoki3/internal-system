// 資格の喪失の「確かめのきっかけ」の合図を、同じ保存の区画のほかのタブへ届ける（#341・利用者の決定 Q1）。
// ログアウト・利用者の切り替え（#298）には使わない。伝える中身は、版・利用者の ID・案件の ID だけで、保存先に何も残さない。
// 受けた値は外部からの入力として検証し、形の違う値・知らない版は捨てる（エラーではない入力の選別）。
// チャンネルは文書ごとに1つ、最初の送受信のときに作る。BroadcastChannel が無い・作るときに SecurityError なら、送受信しない。
import { z } from "zod";

const ACCESS_LOSS_CHANNEL_NAME = "internal-system:access-loss:v1";

const hintSchema = z.object({
  v: z.literal(1),
  userId: z.string(),
  caseId: z.string(),
});

export type CaseAccessLossHint = { userId: string; caseId: string };

/** 作れなかった（機能が無い・SecurityError）ことを覚え、作り直しを試さない */
let channel: BroadcastChannel | null | undefined;

function isSecurityError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "SecurityError";
}

/** チャンネルを返す。使えない環境なら null。想定外の例外は投げる */
function openChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  const Channel: unknown = globalThis.BroadcastChannel;
  if (typeof Channel !== "function") {
    channel = null;
    return channel;
  }
  try {
    channel = new BroadcastChannel(ACCESS_LOSS_CHANNEL_NAME);
  } catch (error) {
    if (!isSecurityError(error)) throw error;
    channel = null;
  }
  return channel;
}

/**
 * 資格の喪失が確定したことを、ほかのタブへ知らせる。投げない：続く下書きの消去を止めないため、
 * 想定外の例外は、ブラウザの標準の報告（reportError）に渡す（利用者の決定 Q5）
 */
export function announceCaseAccessLoss(hint: CaseAccessLossHint): void {
  try {
    const opened = openChannel();
    if (opened === null) return;
    opened.postMessage({ v: 1, userId: hint.userId, caseId: hint.caseId });
  } catch (error) {
    reportError(error);
  }
}

/** ほかのタブの合図を受ける。返り値は解除の関数。チャンネルを作るときの想定外の例外は投げる */
export function subscribeCaseAccessLoss(
  listener: (hint: CaseAccessLossHint) => void,
): () => void {
  const opened = openChannel();
  if (opened === null) return () => undefined;
  const onMessage = (event: MessageEvent<unknown>) => {
    const parsed = hintSchema.safeParse(event.data);
    if (!parsed.success) return;
    listener({ userId: parsed.data.userId, caseId: parsed.data.caseId });
  };
  opened.addEventListener("message", onMessage);
  return () => opened.removeEventListener("message", onMessage);
}
