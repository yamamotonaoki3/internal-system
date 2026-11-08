import { z } from "zod";
import { apiClient } from "../../services/api-client";

const clientSchema = z.object({
  id: z.string().min(1),
  code: z.string(),
  name: z.string(),
  active: z.boolean(),
  version: z.number().int(),
});
const adminPageSchema = z.object({
  items: z.array(clientSchema),
  nextCursor: z.string().nullable(),
});
const candidatePageSchema = z.object({
  items: z.array(clientSchema.pick({ id: true, code: true, name: true })),
  nextCursor: z.string().nullable(),
});

export type Client = z.infer<typeof clientSchema>;
export type ClientAdminPage = z.infer<typeof adminPageSchema>;
export type ClientCandidatePage = z.infer<typeof candidatePageSchema>;
export type ClientListOptions = {
  q?: string;
  status?: "all" | "active" | "inactive";
  cursor?: string;
};

export async function fetchAdminClients(
  options: ClientListOptions = {},
): Promise<ClientAdminPage> {
  const response = await apiClient.get("/admin/clients", { params: options });
  return adminPageSchema.parse(response.data);
}

export async function createClient(input: {
  code: string;
  name: string;
}): Promise<Client> {
  const response = await apiClient.post("/admin/clients", input);
  return clientSchema.parse(response.data);
}

export async function renameClient(
  id: string,
  input: { name: string; version: number },
): Promise<Client> {
  const response = await apiClient.patch(
    `/admin/clients/${encodeURIComponent(id)}`,
    input,
  );
  return clientSchema.parse(response.data);
}

export async function deactivateClient(
  id: string,
  version: number,
): Promise<Client> {
  const response = await apiClient.patch(
    `/admin/clients/${encodeURIComponent(id)}/status`,
    {
      active: false,
      version,
    },
  );
  return clientSchema.parse(response.data);
}

export async function fetchClientCandidates(
  options: { cursor?: string } = {},
): Promise<ClientCandidatePage> {
  const response = await apiClient.get("/clients/candidates", {
    params: options,
  });
  return candidatePageSchema.parse(response.data);
}
