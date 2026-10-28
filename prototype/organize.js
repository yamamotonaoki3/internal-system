"use strict";

// 自分専用の整理スペース S-33（2-8、C-67〜C-73）と、各画面からの登録の入口、添付ファイルの表示をまとめる。
// 画面の本体は screens.js と app.js にある。このファイルは extras.js・screens.js の後、app.js の前に読み込む
// （起動時の描画は app.js の最後で行うため、ここの関数はそのときまでに揃っている）。

/* ---------- 投稿・添付のID（登録は元へのリンクだけを持つ。C-67） ---------- */
let midSeq = 0;
let orgSeq = 100;
const midOf = (message) => (message.mid ||= `m-auto-${++midSeq}`);
const orgId = (prefix) => `${prefix}${++orgSeq}`;

const ORG_KIND_LABEL = {
  channel: "チャンネル",
  file: "ファイル",
  message: "メッセージ",
  reply: "返信",
  case: "案件",
  dm: "DM",
};
// 種類ごとのボタンの文言（screens.md S-33 のワイヤーフレームに合わせる）。
const ORG_OPEN_LABEL = {
  channel: "開く",
  case: "案件を開く",
  dm: "会話を開く",
  message: "元の場所へ移動",
  reply: "返信へ移動",
  file: "添付元の投稿を開く",
};

// 参加者限定の添付は、参加者と審査用の一時閲覧者だけが名前と内容を見られる（5-2 AC-3・C-64）。
const canSeeRestrictedAttachment = (item) =>
  isMember(item) || canReviewPublication(item) || canReviewReopenItem(item);

function attachmentList(message, source) {
  const attachments = message.attachments || [];
  if (!attachments.length) return "";
  const item = source === "case" ? getCase(state.selectedId) : null;
  return `<ul class="attachments" aria-label="添付ファイル">${attachments
    .map((att) => {
      const restricted = att.scope === "restricted";
      if (item && restricted && !canSeeRestrictedAttachment(item))
        return '<li class="attachment"><span>参加者限定の添付</span></li>';
      const scope = item
        ? `<span class="badge ${restricted ? "archived" : "public"}">${restricted ? "参加者限定" : "公開可能"}</span>`
        : "";
      return `<li class="attachment" data-aid="${e(att.id)}"><span class="attachment-name">添付: ${e(att.name)}</span>${scope}<button type="button" data-ui="org-add" data-kind="file" data-ref="${e(att.id)}" aria-label="${e(att.name)}を整理スペースに登録">整理スペースに登録</button></li>`;
    })
    .join("")}</ul>`;
}

/* ---------- 登録先の解決（元の削除・閲覧権限の喪失を、表示のたびに調べる。C-70） ---------- */
function savedRooms() {
  const rooms = [];
  prototypeData.channels.forEach((ch) =>
    rooms.push({ source: "channel", ch, messages: ch.messages }),
  );
  Object.entries(prototypeData.dm).forEach(([key, messages]) =>
    rooms.push({ source: "dm", key, messages }),
  );
  state.cases.forEach((item) =>
    rooms.push({ source: "case", item, messages: item.messages }),
  );
  return rooms;
}
const dmPartnerOf = (room) =>
  room.key.split(":").find((id) => id !== state.userId);
function roomVisible(room) {
  if (room.source === "channel") return canReadChannel(room.ch);
  if (room.source === "dm") {
    const ids = room.key.split(":");
    return (
      ids.includes(state.userId) &&
      employees.some((person) => person.id === dmPartnerOf(room) && person.active)
    );
  }
  return canSeeContent(room.item);
}
const roomLabel = (room) =>
  room.source === "channel"
    ? `# ${room.ch.name}`
    : room.source === "dm"
      ? `@ ${nameOf(dmPartnerOf(room))}`
      : `${room.item.no} ${room.item.title}`;
function findMessage(mid) {
  for (const room of savedRooms())
    for (const message of room.messages) {
      if (message.mid === mid) return { room, message, parent: null };
      for (const reply of message.replies || [])
        if (reply.mid === mid) return { room, message: reply, parent: message };
    }
  return null;
}
function findFile(aid) {
  for (const room of savedRooms())
    for (const message of room.messages) {
      const att = (message.attachments || []).find((value) => value.id === aid);
      if (att && !message.deleted) return { room, message, att };
    }
  return null;
}
const excerpt = (text) => (text.length > 40 ? `${text.slice(0, 40)}…` : text);
// status: ok（開ける）・deleted（元が削除された）・blocked（閲覧権限がない）。
// ok のときだけ元の内容を返す。それ以外は元の内容を一切返さない（C-70）。
function resolveSaved(entry) {
  const deleted = { status: "deleted" };
  const blocked = { status: "blocked" };
  if (entry.kind === "channel") {
    const ch = prototypeData.channels.find((value) => value.id === entry.refId);
    if (!ch) return deleted;
    const room = { source: "channel", ch };
    if (!roomVisible(room)) return blocked;
    return { status: "ok", room, title: `# ${ch.name}`, sub: deptLabel(ch.dept) };
  }
  if (entry.kind === "dm") {
    const partner = employees.find((person) => person.id === entry.refId);
    if (!partner || !partner.active) return deleted;
    const room = {
      source: "dm",
      key: dmKey(state.userId, partner.id),
    };
    return { status: "ok", room, title: `@ ${partner.name}`, sub: deptOf(partner) };
  }
  if (entry.kind === "case") {
    const item = getCase(entry.refId);
    if (!item) return deleted;
    const room = { source: "case", item };
    if (!roomVisible(room)) return blocked;
    return { status: "ok", room, title: `${item.no} ${item.title}`, sub: caseStatusLabel(item) };
  }
  if (entry.kind === "message" || entry.kind === "reply") {
    const found = findMessage(entry.refId);
    if (!found || !!found.parent !== (entry.kind === "reply")) return deleted;
    // 削除された投稿（お知らせの削除・緊急削除。C-57）は、元の内容を返さない。
    if (found.message.deleted) return deleted;
    if (!roomVisible(found.room)) return blocked;
    return {
      status: "ok",
      room: found.room,
      found,
      title: `${roomLabel(found.room)}　${nameOf(found.message.by)}　${found.message.at}`,
      sub: excerpt(found.message.text),
    };
  }
  if (entry.kind === "file") {
    const found = findFile(entry.refId);
    if (!found) return deleted;
    if (!roomVisible(found.room)) return blocked;
    if (
      found.room.source === "case" &&
      found.att.scope === "restricted" &&
      !canSeeRestrictedAttachment(found.room.item)
    )
      return blocked;
    return {
      status: "ok",
      room: found.room,
      found,
      att: found.att,
      title: found.att.name,
      sub: `（${roomLabel(found.room)}）`,
    };
  }
  return deleted;
}

/* ---------- 登録・移動・解除 ---------- */
const mySaved = () => (prototypeData.saved[state.userId] ||= []);
const myFolders = () => (prototypeData.myFolders[state.userId] ||= []);
const folderName = (id) =>
  myFolders().find((folder) => folder.id === id)?.name || "フォルダなし";

// 入口は各画面の「整理スペースに登録」。同じ対象（種類＋ID）は1件だけで、再登録は案内だけ。
// 既存の登録先フォルダは変えない（C-72）。登録先は「フォルダなし」で、あとからフォルダを変えられる（C-69）。
function addSaved(kind, refId) {
  if (!Object.hasOwn(ORG_KIND_LABEL, kind) || !refId) return refuse();
  if (mySaved().some((entry) => entry.kind === kind && entry.refId === refId))
    return notify("登録済みです");
  const entry = { id: orgId("sv"), kind, refId, folderId: null };
  // 登録できるのは本人が見られるものだけ。登録によって閲覧範囲は広がらない（2-8 AC-5）。
  if (resolveSaved(entry).status !== "ok")
    return refuse("閲覧できないものは登録できません。");
  mySaved().push(entry);
  return notify("登録しました");
}

function visible(selector) {
  return Array.from(document.querySelectorAll(selector)).find(
    (el) => el.offsetParent !== null,
  );
}
function focusOrg(selector) {
  const el = visible(selector);
  if (el) return el.focus();
  const heading = screen.querySelector("h1");
  if (heading) {
    heading.setAttribute("tabindex", "-1");
    heading.focus();
  }
}

// 移動先で該当の位置を目立たせる。色だけでなく文字の印も付ける（C-71）。
function applyFlash() {
  const flash = ui.flash;
  ui.flash = null;
  if (!flash) return;
  const root = flash.inThread ? document.querySelector("#thread-panel") : screen;
  const el = root?.querySelector(`[data-mid="${CSS.escape(flash.mid)}"]`);
  if (!el) return notify("該当の位置が見つかりません。");
  const att = flash.aid
    ? el.querySelector(`[data-aid="${CSS.escape(flash.aid)}"]`)
    : null;
  const mark = att || el;
  mark.classList.add("is-target");
  const badge = document.createElement("span");
  badge.className = "target-badge";
  badge.textContent =
    flash.label ||
    (att ? "整理スペースから開いたファイル" : "整理スペースから開いた位置");
  if (att) att.append(badge);
  else (el.querySelector(".chat-meta") || el).append(badge);
  mark.setAttribute("tabindex", "-1");
  mark.scrollIntoView({ block: "center" });
  mark.focus({ preventScroll: true });
}
function goToRoom(room) {
  if (room.source === "channel") {
    ui.channelId = room.ch.id;
    proceedTo("S05");
  } else if (room.source === "dm") {
    ui.dmUserId = dmPartnerOf(room);
    proceedTo("S06");
  } else openCase(room.item.id);
}
function openSaved(entry) {
  const result = resolveSaved(entry);
  if (result.status !== "ok") {
    render();
    return notify(
      result.status === "deleted"
        ? "元の情報は削除されています。"
        : "元の情報を閲覧できません。",
    );
  }
  goToRoom(result.room);
  if (entry.kind === "message" || entry.kind === "file") {
    ui.flash = { mid: midOf(result.found.message), aid: result.att?.id };
    return applyFlash();
  }
  if (entry.kind === "reply") {
    const { room, found } = result;
    showThread({
      source: room.source,
      message: found.parent,
      viewerId: state.userId,
      caseId: room.item?.id || null,
      channelId: room.ch?.id || null,
      partnerId: room.source === "dm" ? dmPartnerOf(room) : null,
      label: roomLabel(room),
    });
    ui.flash = { mid: midOf(found.message), inThread: true };
    return applyFlash();
  }
}

/* ---------- S-33 の描画 ---------- */
function savedRow(entry) {
  const result = resolveSaved(entry);
  const kind = ORG_KIND_LABEL[entry.kind];
  const ok = result.status === "ok";
  const target = ok ? result.title : `${kind}（${result.status === "deleted" ? "削除済み" : "閲覧できません"}）`;
  const main = ok
    ? `<span class="org-kind">[${e(kind)}]</span> <strong>${e(result.title)}</strong> <span class="subtle">${e(result.sub)}</span>`
    : `<span class="org-kind">[${e(kind)}]</span> <strong class="org-state">${result.status === "deleted" ? "削除済み" : "閲覧できません"}</strong> <span class="subtle">元の内容は表示しません。登録は残っています。</span>`;
  const open = ok
    ? `<button type="button" class="button small primary" data-ui="org-open" data-id="${e(entry.id)}" aria-label="${e(ORG_OPEN_LABEL[entry.kind])}：${e(target)}">${ORG_OPEN_LABEL[entry.kind]}</button>`
    : "";
  const move = `<button type="button" class="button small" data-ui="org-move" data-id="${e(entry.id)}" aria-label="${e(target)}のフォルダを変える">フォルダを変える</button>`;
  const remove = `<button type="button" class="button small" data-ui="org-remove" data-id="${e(entry.id)}" aria-label="${e(target)}の登録解除">登録解除</button>`;
  return `<div class="org-row" role="listitem" data-saved="${e(entry.id)}"><div class="org-main">${main}</div><div class="org-actions org-inline">${open}${move}${remove}</div><div class="org-actions org-mobile">${open}<details class="org-more"><summary aria-label="その他の操作：${e(target)}">…</summary><div class="org-more-items">${move}${remove}</div></details></div></div>`;
}
function folderGroup(folder, entries) {
  const key = folder ? folder.id : "none";
  const name = folder ? folder.name : "フォルダなし";
  const collapsed = (ui.orgCollapsed ||= new Set()).has(key);
  const tools = folder
    ? `<span class="inline-actions"><button type="button" class="button small" data-ui="org-folder-rename" data-id="${e(folder.id)}" aria-label="フォルダ「${e(name)}」の名前を変更">名前を変更</button><button type="button" class="button small" data-ui="org-folder-delete" data-id="${e(folder.id)}" aria-label="フォルダ「${e(name)}」を削除">フォルダを削除</button></span>`
    : "";
  return `<section class="org-group" aria-labelledby="org-h-${e(key)}"><div class="org-group-head"><h2 id="org-h-${e(key)}"><button type="button" class="org-toggle" data-ui="org-toggle" data-folder="${e(key)}" aria-expanded="${!collapsed}">${collapsed ? "▶" : "▼"} ${e(name)}<span class="subtle">（${entries.length}件・${collapsed ? "閉じています" : "開いています"}）</span></button></h2>${tools}</div>${collapsed ? "" : entries.length ? `<div class="org-list" role="list" aria-label="${e(name)}の登録">${entries.map(savedRow).join("")}</div>` : '<p class="subtle org-none">このフォルダには登録がありません。</p>'}</section>`;
}
function personalSpaceScreen(forceEmpty = false) {
  const list = forceEmpty ? [] : mySaved();
  const folders = myFolders();
  const groups = [
    ...folders.map((folder) =>
      folderGroup(folder, list.filter((entry) => entry.folderId === folder.id)),
    ),
    folderGroup(null, list.filter((entry) => !entry.folderId)),
  ].join("");
  const empty = list.length
    ? ""
    : '<p class="org-empty" role="status">まだ登録したものがありません。検索結果などの「整理スペースに登録」から登録できます</p>';
  return screenFrame(
    "S33",
    "自分専用の整理スペース",
    "チャンネル・ファイル・メッセージ・案件・DMを手動で登録し、自分用フォルダで整理します。自分だけに見え、ほかの人や元の情報には影響しません。登録は元へのリンクで、閲覧権限は広がりません。",
    `${empty}${list.length || folders.length ? shellCard("登録したもの", groups, "") : ""}`,
    protoButton("＋ フォルダを作成", "org-folder-new", "", true),
  );
}

/* ---------- フォルダの操作（名前は前後の空白を除いて1〜50文字、大文字小文字を区別しない重複は不可。C-73） ---------- */
function folderForm(folder) {
  showModal(
    folder ? "フォルダの名前を変更" : "フォルダを作成",
    `${field("フォルダ名", "org-folder-name", "text", folder?.name || "", true, [1, 50])}<input type="hidden" name="target" value="${e(folder?.id || "")}">`,
    "org-folder-save",
    folder ? "変更する" : "作成する",
  );
}
function saveFolder(data) {
  const target = String(data.get("target") || "");
  const folder = target ? myFolders().find((value) => value.id === target) : null;
  if (target && !folder) return refuse();
  const name = String(data.get("org-folder-name") || "").trim();
  const length = [...name].length;
  if (length < 1 || length > 50)
    return modalError("フォルダ名は前後の空白を除いて1〜50文字で入力してください。");
  if (
    myFolders().some(
      (other) => other !== folder && other.name.toLowerCase() === name.toLowerCase(),
    )
  )
    return modalError(
      "同じ名前のフォルダがすでにあります（大文字・小文字は区別しません）。",
    );
  let id = target;
  if (folder) folder.name = name;
  else {
    id = orgId("f");
    myFolders().push({ id, name });
  }
  closeModal();
  render();
  notify(folder ? "フォルダの名前を変更しました。" : "フォルダを作成しました。");
  return focusOrg(`[data-ui="org-toggle"][data-folder="${CSS.escape(id)}"]`);
}
function folderDeleteForm(id) {
  const folder = myFolders().find((value) => value.id === id);
  if (!folder) return refuse();
  const count = mySaved().filter((entry) => entry.folderId === id).length;
  showModal(
    "フォルダを削除",
    `<p>フォルダ「${e(folder.name)}」を削除します。中の登録（${count}件）は削除せず、「フォルダなし」に移します。</p><input type="hidden" name="target" value="${e(id)}">`,
    "org-folder-delete",
    "削除する",
    true,
  );
}
function deleteFolder(data) {
  const id = String(data.get("target") || "");
  if (!myFolders().some((value) => value.id === id)) return refuse();
  mySaved().forEach((entry) => {
    if (entry.folderId === id) entry.folderId = null;
  });
  prototypeData.myFolders[state.userId] = myFolders().filter(
    (value) => value.id !== id,
  );
  closeModal();
  render();
  notify("フォルダを削除しました。中の登録は「フォルダなし」に移しました。");
  return focusOrg('[data-ui="org-toggle"][data-folder="none"]');
}
function moveForm(id) {
  const entry = mySaved().find((value) => value.id === id);
  if (!entry) return refuse();
  showModal(
    "登録先のフォルダを変える",
    `${selectField(
      "登録先",
      "org-move-folder",
      [["", "フォルダなし"], ...myFolders().map((folder) => [folder.id, folder.name])],
      entry.folderId || "",
    )}<input type="hidden" name="target" value="${e(id)}">`,
    "org-move-save",
    "移動する",
  );
}
function saveMove(data) {
  const entry = mySaved().find((value) => value.id === String(data.get("target")));
  const folderId = String(data.get("org-move-folder") || "");
  if (!entry || (folderId && !myFolders().some((value) => value.id === folderId)))
    return refuse();
  entry.folderId = folderId || null;
  closeModal();
  render();
  notify("移動しました");
  return focusOrg(`[data-saved="${CSS.escape(entry.id)}"] [data-ui="org-move"]`);
}

/* ---------- クリック・送信の受け口（extras.js の表に足す） ---------- */
Object.assign(EXTRA_UI, {
  "org-add": (element) => addSaved(element.dataset.kind, element.dataset.ref),
  "org-open": (element) => {
    const entry = mySaved().find((value) => value.id === element.dataset.id);
    if (entry) openSaved(entry);
  },
  "org-toggle": (element) => {
    const set = (ui.orgCollapsed ||= new Set());
    const key = element.dataset.folder;
    if (set.has(key)) set.delete(key);
    else set.add(key);
    render();
    focusOrg(`[data-ui="org-toggle"][data-folder="${CSS.escape(key)}"]`);
  },
  "org-folder-new": () => folderForm(null),
  "org-folder-rename": (element) =>
    folderForm(myFolders().find((value) => value.id === element.dataset.id)),
  "org-folder-delete": (element) => folderDeleteForm(element.dataset.id),
  "org-move": (element) => moveForm(element.dataset.id),
  "org-remove": (element) => {
    const entry = mySaved().find((value) => value.id === element.dataset.id);
    if (!entry) return;
    const key = entry.folderId || "none";
    prototypeData.saved[state.userId] = mySaved().filter((value) => value !== entry);
    render();
    notify("登録を解除しました。元の情報には影響しません。");
    focusOrg(`[data-ui="org-toggle"][data-folder="${CSS.escape(key)}"]`);
  },
  // 案件の資料・検索結果から、元の投稿の位置へ移る。
  "case-file-open": (element) => {
    state.todoEdit = null;
    state.detailTab = "messages";
    render();
    ui.flash = { mid: element.dataset.mid, aid: element.dataset.aid };
    applyFlash();
  },
  "case-msg-open": (element) => {
    openCase(element.dataset.id);
    ui.flash = { mid: element.dataset.mid };
    applyFlash();
  },
});
Object.assign(EXTRA_MODAL, {
  "org-folder-save": saveFolder,
  "org-folder-delete": deleteFolder,
  "org-move-save": saveMove,
});
["org-open", "case-msg-open"].forEach((name) => LEAVING_UI.add(name));
