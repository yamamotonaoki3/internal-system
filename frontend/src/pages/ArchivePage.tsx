// S-38 アーカイブ（#143-b。全体管理者は全件、部署のオーナーは自部署の範囲。表示の制御であり、認可はサーバーが毎回行う）。
// 小見出し「アーカイブしたチャンネル」。並びはアーカイブした日時の新しい順（サーバーが決める）。絞り込みはない。
// 復元のダイアログと対象はページの状態に持ち、表の外に描画する（一覧の取り直しで行が消えても、完了の表示が出るように）。
// 「アーカイブした案件」は #151、物理削除は #143-c。
import { useState } from "react";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import {
  ArchivedChannelTable,
  ChannelRestoreDialog,
  describeError,
  useArchivedChannels,
  type ArchivedChannel,
} from "../features/channels";

export function ArchivePage() {
  const [target, setTarget] = useState<ArchivedChannel | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const channels = useArchivedChannels();

  /** 完了せずに閉じた（409 などの後を含む）：最新の一覧を取り直す */
  function closeDialog() {
    setTarget(null);
    void channels.refetch();
  }

  function listContent() {
    if (channels.isError)
      return (
        <Alert tone="error" role="alert">
          <p className="mb-2">{describeError(channels.error)}</p>
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
    if (channels.data === undefined) return <p role="status">読み込み中です</p>;
    const items = channels.data.pages.flatMap((page) => page.items);
    if (items.length === 0) return <p>アーカイブしたチャンネルはありません</p>;
    return (
      <>
        <ArchivedChannelTable
          items={items}
          onRestore={(channel) => {
            setNotice(null);
            setTarget(channel);
          }}
        />
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
      <h1 className="mb-4 text-2xl font-bold">アーカイブ</h1>
      {notice !== null && (
        <Alert tone="info" role="status">
          {notice}
        </Alert>
      )}
      <h2 className="mb-2 text-xl font-bold">アーカイブしたチャンネル</h2>
      {listContent()}
      {target !== null && (
        <ChannelRestoreDialog
          channelId={target.id}
          channelName={target.name}
          version={target.version}
          onClose={closeDialog}
          onRestored={() => {
            setNotice(`チャンネル「${target.name}」を復元しました`);
            setTarget(null);
          }}
        />
      )}
    </section>
  );
}
