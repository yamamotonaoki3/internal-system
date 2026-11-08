import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { clientSearchSchema } from "../../../../shared/client-rules";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { TextField } from "../../components/TextField";
import type { ApiError } from "../../services/api-client";
import {
  createClient,
  deactivateClient,
  fetchAdminClients,
  renameClient,
  type Client,
  type ClientListOptions,
} from "./client-api";
import { ClientForm } from "./ClientForm";
import { clientKeys } from "./query-keys";

type Editor = { kind: "create" } | { kind: "rename"; client: Client } | null;

export function ClientsManager() {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [status, setStatus] = useState<ClientListOptions["status"]>("all");
  const [cursor, setCursor] = useState<string>();
  const [editor, setEditor] = useState<Editor>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const clients = useQuery({
    queryKey: clientKeys.admin(search, status ?? "all", cursor),
    queryFn: () =>
      fetchAdminClients({ q: search || undefined, status, cursor }),
    retry: false,
  });

  const update = useMutation({
    mutationFn: async (
      action:
        | { kind: "create"; code: string; name: string }
        | { kind: "rename"; client: Client; name: string }
        | { kind: "deactivate"; client: Client },
    ) => {
      if (action.kind === "create")
        return createClient({ code: action.code, name: action.name });
      if (action.kind === "rename")
        return renameClient(action.client.id, {
          name: action.name,
          version: action.client.version,
        });
      return deactivateClient(action.client.id, action.client.version);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: clientKeys.all });
    },
  });

  const save = async (values: { code: string; name: string }) => {
    if (!editor) return;
    if (editor.kind === "create") {
      await update.mutateAsync({ kind: "create", ...values });
    } else {
      await update.mutateAsync({
        kind: "rename",
        client: editor.client,
        name: values.name,
      });
    }
    setEditor(null);
  };

  const deactivate = async (client: Client) => {
    setActionError(null);
    try {
      await update.mutateAsync({ kind: "deactivate", client });
    } catch (error) {
      const apiError = error as ApiError;
      setActionError(
        apiError.status === 409
          ? "ほかの操作で情報が更新されました。一覧を確認してください。"
          : apiError.status === 403
            ? "取引先を管理する権限がありません。"
            : "無効にできませんでした。時間をおいて、もう一度お試しください。",
      );
    }
  };

  return (
    <section className="mx-auto max-w-5xl rounded-lg bg-surface p-4 md:p-6">
      <h1 className="mb-4 text-2xl font-bold">取引先管理</h1>
      <div className="mb-4">
        <Button
          onClick={() => {
            setActionError(null);
            setEditor({ kind: "create" });
          }}
          disabled={update.isPending}
        >
          取引先を登録
        </Button>
      </div>
      {editor && (
        <section
          className="mb-6 rounded-md border border-border-strong p-4"
          aria-label={
            editor.kind === "create" ? "取引先の登録" : "取引先名の変更"
          }
        >
          <h2 className="mb-3 text-lg font-bold">
            {editor.kind === "create" ? "取引先の登録" : "取引先名の変更"}
          </h2>
          <ClientForm
            key={editor.kind === "create" ? "create" : editor.client.id}
            client={editor.kind === "rename" ? editor.client : undefined}
            onSave={save}
            onCancel={() => setEditor(null)}
          />
        </section>
      )}
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = clientSearchSchema.safeParse(searchInput);
          if (!parsed.success) {
            setSearchError("検索語は100文字以内で入力してください");
            return;
          }
          setSearchError(null);
          setCursor(undefined);
          setSearch(parsed.data);
        }}
        className="mb-4 flex flex-wrap items-end gap-2"
      >
        <TextField
          type="search"
          label="取引先を検索"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          error={searchError ?? undefined}
        />
        <Button type="submit" variant="secondary">
          検索
        </Button>
      </form>
      <label className="mb-4 block text-sm font-bold">
        状態
        <select
          className="ml-2 min-h-11 rounded-md border border-border-strong bg-surface px-3"
          value={status}
          onChange={(event) => {
            setCursor(undefined);
            setStatus(event.target.value as ClientListOptions["status"]);
          }}
        >
          <option value="all">すべて</option>
          <option value="active">有効</option>
          <option value="inactive">無効</option>
        </select>
      </label>
      {actionError && (
        <Alert tone="error" role="alert">
          {actionError}
        </Alert>
      )}
      {clients.isPending ? (
        <p role="status">読み込み中です</p>
      ) : clients.isError ? (
        <Alert tone="error" role="alert">
          取引先を取得できませんでした。再試行してください。
        </Alert>
      ) : clients.data.items.length === 0 ? (
        <p>該当する取引先がありません</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr>
                <th scope="col" className="p-2">
                  コード
                </th>
                <th scope="col" className="p-2">
                  取引先名
                </th>
                <th scope="col" className="p-2">
                  状態
                </th>
                <th scope="col" className="p-2">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {clients.data.items.map((client) => (
                <tr key={client.id} className="border-t border-border-strong">
                  <td className="p-2">{client.code}</td>
                  <td className="p-2">{client.name}</td>
                  <td className="p-2">{client.active ? "有効" : "無効"}</td>
                  <td className="p-2">
                    {client.active && (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setActionError(null);
                          setEditor({ kind: "rename", client });
                        }}
                        disabled={update.isPending}
                      >
                        名前を変更
                      </Button>
                    )}
                    {client.active && client.code !== "INT" && (
                      <Button
                        variant="danger"
                        onClick={() => void deactivate(client)}
                        disabled={update.isPending}
                      >
                        無効にする
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {clients.data?.nextCursor && (
        <Button
          variant="secondary"
          onClick={() => setCursor(clients.data.nextCursor ?? undefined)}
        >
          次のページ
        </Button>
      )}
    </section>
  );
}
