// 入力欄の下書き。マウントしたときに端末から復元し、入力のたびに同期して保存する。
// 利用者がわからない（userId なし）ときは読み書きしない。保存先が使えないとき（DraftStorageUnavailableError）だけ受け止め、
// 以後の書き込みを止めて unavailable で案内を出させる。それ以外の例外は投げ直す。
import { useState } from "react";
import { isBlankDraft } from "../draft-policy";
import {
  DraftStorageUnavailableError,
  openDraftStorage,
  readDraft,
  removeDraft,
  writeDraft,
} from "../draft-storage";

type Loaded = {
  storage: Storage | null;
  initialBody: string;
  unavailable: boolean;
};

function load(userId: string | undefined, scope: string): Loaded {
  if (userId === undefined)
    return { storage: null, initialBody: "", unavailable: false };
  const storage = openDraftStorage();
  if (storage === null)
    return { storage: null, initialBody: "", unavailable: true };
  try {
    const body = readDraft(storage, userId, scope, Date.now());
    return { storage, initialBody: body ?? "", unavailable: false };
  } catch (error) {
    if (error instanceof DraftStorageUnavailableError)
      return { storage: null, initialBody: "", unavailable: true };
    throw error;
  }
}

export function useDraft(userId: string | undefined, scope: string) {
  const [loaded] = useState(() => load(userId, scope));
  // 描画したまま利用者が替わっても、前の利用者の本文を新しい利用者のキーに書かない
  const [mountedUserId] = useState(userId);
  const [unavailable, setUnavailable] = useState(loaded.unavailable);

  function run(
    operation: (storage: Storage, userId: string, now: number) => void,
  ) {
    if (
      loaded.storage === null ||
      userId === undefined ||
      userId !== mountedUserId
    )
      return;
    try {
      operation(loaded.storage, userId, Date.now());
    } catch (error) {
      if (!(error instanceof DraftStorageUnavailableError)) throw error;
      setUnavailable(true);
    }
  }

  return {
    /** 復元した本文（なければ空） */
    initialBody: loaded.initialBody,
    /** 保存できない環境（案内を出す） */
    unavailable,
    // 保存できなくなった後も、消す操作（空の本文・送信後の削除）は止めない。止めるのは書き込みだけ
    save: (body: string) => {
      if (unavailable && !isBlankDraft(body)) return;
      run((storage, id, now) => writeDraft(storage, id, scope, body, now));
    },
    discard: () => run((storage, id) => removeDraft(storage, id, scope)),
  };
}
