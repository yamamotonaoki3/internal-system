// S-10 の入力チェック。名前・説明の規則は shared/channel-name-rules.ts の定義（サーバー側でも同じ規則で検査する）。
import { z } from "zod";
import {
  channelRequestDescriptionSchema,
  channelRequestNameSchema,
} from "../../../../../shared/channel-name-rules";

export const channelRequestFormSchema = z.object({
  scope: z.enum(["department", "company"]),
  visibility: z.enum(["public", "private"]),
  // 全角英数字などは半角に整えた名前になる（parse の結果）
  name: channelRequestNameSchema,
  description: channelRequestDescriptionSchema,
});

export type ChannelRequestFormInput = z.input<typeof channelRequestFormSchema>;
export type ChannelRequestFormValues = z.output<
  typeof channelRequestFormSchema
>;

export const channelRequestFieldNames = [
  "scope",
  "visibility",
  "name",
  "description",
] as const;
