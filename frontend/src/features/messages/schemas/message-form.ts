// メッセージの入力チェック。本文の規則（長さ・空白だけの拒否）は shared/message-rules.ts の定義を使う（サーバー側でも検査する）。
import { z } from "zod";
import { messageBodySchema } from "../../../../../shared/message-rules";

export const messageFormSchema = z.object({ body: messageBodySchema });

export type MessageFormValues = z.output<typeof messageFormSchema>;
