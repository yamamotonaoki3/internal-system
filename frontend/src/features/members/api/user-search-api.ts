// API 層：社員の検索（GET /api/users の検索語つき・ページ送りつき）。表示名と ID だけを返す（候補の選択に使う）。
import { z } from "zod";
import { apiClient } from "../../../services/api-client";

const userPageSchema = z.object({
  items: z.array(z.object({ id: z.string().min(1), displayName: z.string() })),
  nextCursor: z.string().nullable(),
});

export type SearchedUser = { id: string; displayName: string };
export type SearchedUserPage = {
  items: SearchedUser[];
  nextCursor: string | null;
};

/** 社員を表示名で探す（cursor がなければ最初のページ） */
export async function searchUsers(
  q: string,
  cursor?: string,
): Promise<SearchedUserPage> {
  const response = await apiClient.get("/users", { params: { q, cursor } });
  const page = userPageSchema.parse(response.data);
  return {
    items: page.items.map(({ id, displayName }) => ({ id, displayName })),
    nextCursor: page.nextCursor,
  };
}
