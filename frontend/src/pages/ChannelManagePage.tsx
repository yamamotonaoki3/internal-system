// S-39 チャンネル管理（#143-b。全体管理者は全件、部署のオーナーは自部署の範囲。表示の制御であり、認可はサーバーが毎回行う）。
// 名前の部分一致と状態（すべて・使用中・アーカイブ中）で絞り込み、「検索」で確定する。並びは名前の順（サーバーが決める）。
// アーカイブ・復元のダイアログと対象はページの状態に持ち、表の外に描画する（一覧の取り直しで行が消えても、完了の表示が出るように）。
// 物理削除は置かない（#143-c）。
import { useState, type FormEvent } from "react";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { SelectField } from "../components/SelectField";
import { TextField } from "../components/TextField";
import {
  AdminChannelTable,
  ChannelArchiveDialog,
  ChannelRestoreDialog,
  describeError,
  isApiError,
  useAdminChannels,
  type AdminChannel,
  type AdminChannelFilter,
  type AdminChannelState,
  type ChannelManageAction,
} from "../features/channels";

const STATE_OPTIONS: { value: AdminChannelState; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "active", label: "使用中" },
  { value: "archived", label: "アーカイブ中" },
];

const Q_ERROR = "名前は1〜55文字で入力してください";

type Target = { action: ChannelManageAction; channel: AdminChannel };

export function ChannelManagePage() {
  const [draftQ, setDraftQ] = useState("");
  const [draftState, setDraftState] = useState<AdminChannelState>("all");
  // 「検索」を押した時点の条件
  const [filter, setFilter] = useState<AdminChannelFilter>({ state: "all" });
  const [target, setTarget] = useState<Target | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const channels = useAdminChannels(filter);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = draftQ.trim();
    setFilter({ state: draftState, ...(q === "" ? {} : { q }) });
  }

  function select(channel: AdminChannel, action: ChannelManageAction) {
    setNotice(null);
    setTarget({ action, channel });
  }

  /** 完了せずに閉じた（409 などの後を含む）：最新の一覧を取り直す */
  function closeDialog() {
    setTarget(null);
    void channels.refetch();
  }

  function done(message: string) {
    setNotice(message);
    setTarget(null);
  }

  const error = channels.error;
  const qInvalid =
    isApiError(error) &&
    error.status === 422 &&
    (error.fields?.includes("q") ?? false);

  function listContent() {
    if (channels.isError && !qInvalid)
      return (
        <Alert tone="error" role="alert">
          <p className="mb-2">{describeError(error)}</p>
          <Button
            variant="secondary"
            onClick={() =>
              void (channels.isFetchNextPageError
                ? channels.fetchNextPage()
                : channels.refetch())
            }
          >
            再読み込み
          </Button>
        </Alert>
      );
    if (channels.data === undefined)
      return channels.isError ? null : <p role="status">読み込み中です</p>;
    const items = channels.data.pages.flatMap((page) => page.items);
    if (items.length === 0) return <p>該当するチャンネルはありません</p>;
    return (
      <>
        <AdminChannelTable items={items} onSelect={select} />
        {channels.hasNextPage && (
          <Button
            variant="secondary"
            disabled={channels.isFetchingNextPage}
            onClick={() => void channels.fetchNextPage()}
          >
            さらに読み込む
          </Button>
        )}
      </>
    );
  }

  return (
    <section className="mx-auto max-w-5xl rounded-lg bg-surface p-4 md:p-6">
      <h1 className="mb-4 text-2xl font-bold">チャンネル管理</h1>
      {notice !== null && (
        <Alert tone="info" role="status">
          {notice}
        </Alert>
      )}
      <form onSubmit={submit} noValidate className="mb-4">
        <TextField
          label="名前で検索"
          autoComplete="off"
          value={draftQ}
          onChange={(event) => setDraftQ(event.target.value)}
          error={qInvalid ? Q_ERROR : undefined}
        />
        <SelectField
          label="状態"
          value={draftState}
          onChange={(event) =>
            setDraftState(event.target.value as AdminChannelState)
          }
        >
          {STATE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
        <Button type="submit">検索</Button>
      </form>
      {listContent()}
      {target?.action === "archive" && (
        <ChannelArchiveDialog
          channelId={target.channel.id}
          channelName={target.channel.name}
          version={target.channel.version}
          onClose={closeDialog}
          onArchived={() =>
            done(`チャンネル「${target.channel.name}」をアーカイブしました`)
          }
        />
      )}
      {target?.action === "restore" && (
        <ChannelRestoreDialog
          channelId={target.channel.id}
          channelName={target.channel.name}
          version={target.channel.version}
          onClose={closeDialog}
          onRestored={() =>
            done(`チャンネル「${target.channel.name}」を復元しました`)
          }
        />
      )}
    </section>
  );
}
