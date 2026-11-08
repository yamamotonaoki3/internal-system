export const clientKeys = {
  all: ["clients"] as const,
  admin: (q: string, status: string, cursor?: string) =>
    ["clients", "admin", q, status, cursor] as const,
  candidates: ["clients", "candidates"] as const,
};
