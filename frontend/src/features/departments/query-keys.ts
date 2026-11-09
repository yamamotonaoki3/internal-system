export const departmentKeys = {
  all: ["departments"] as const,
  list: (cursor?: string) => ["departments", "list", cursor] as const,
  ownerCandidates: ["departments", "owner-candidates"] as const,
};
