// メッセージの入力チェック。本文の規則（長さ・空白だけの拒否）は shared/message-rules.ts の定義を使う（サーバー側でも検査する）。
// 添付があれば本文は空でもよい（#270・C-137(3)）。添付の有無で schema を選ぶ（正はサーバーの検査）。
import { z } from "zod";
import {
  messageBodyMaybeBlankSchema,
  messageBodySchema,
} from "../../../../../shared/message-rules";

const withBody = z.object({ body: messageBodySchema });
const maybeBlank = z.object({ body: messageBodyMaybeBlankSchema });

export function messageFormSchemaFor({
  hasAttachments,
}: {
  hasAttachments: boolean;
}) {
  return hasAttachments ? maybeBlank : withBody;
}

export type MessageFormValues = z.output<typeof withBody>;
