"use strict";

// 試作専用の補助。下書きの一時保存・入力の長さ・編集中の離脱の確認・スレッド一覧(S-35)・
// 取引先の管理(S-36)・アバターメニューのステータス変更をまとめている。
// 画面の本体は screens.js と app.js にある。このファイルを最初に読み込み、
// クリックと送信の確認を他の処理より先に行う(同じ要素のイベントは登録順に動くため)。

/* ---------- 下書きの一時保存(C-82) ---------- */
// メッセージ入力欄の下書きを、この端末のブラウザだけに保存する。サーバーには保存しない。
const DRAFT_PREFIX = "internal-system-proto-draft:";
const DRAFT_TTL = 7 * 24 * 60 * 60 * 1000;
const draftStatus = { available: true };

function draftStorage() {
  try {
    return window.localStorage;
  } catch (error) {
    // 保存できない環境では、入力欄の下に「保存できません」と表示する(draftNote)。
    draftStatus.available = false;
    return null;
  }
}
const draftKey = (scope) => `${DRAFT_PREFIX}${state.userId}:${scope}`;
const draftKeys = (store) =>
  Array.from({ length: store.length }, (_, index) => store.key(index)).filter(
    (key) => key && key.startsWith(DRAFT_PREFIX),
  );
function parseDraft(store, key) {
  const raw = store.getItem(key);
  if (!raw) return null;
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    // 壊れた下書きは復元できないため捨てる。下書きは補助の保存で、主の処理には影響しない。
    store.removeItem(key);
    return null;
  }
  if (!data || typeof data.text !== "string" || typeof data.at !== "number") {
    store.removeItem(key);
    return null;
  }
  return data;
}
// 期限切れ(最終編集から7日)は、アプリを開いたときや下書きを読み込むときに端末から消す。
function purgeExpiredDrafts() {
  const store = draftStorage();
  if (!store) return;
  draftKeys(store).forEach((key) => {
    const data = parseDraft(store, key);
    if (data && Date.now() - data.at > DRAFT_TTL) store.removeItem(key);
  });
}
function draftFor(scope) {
  const key = draftKey(scope);
  purgeExpiredDrafts();
  const store = draftStorage();
  const data = store ? parseDraft(store, key) : null;
  return { key, text: data?.text || "", at: data?.at || 0 };
}
function saveDraft(key, text) {
  const store = draftStorage();
  if (!store) return;
  if (!text.trim()) store.removeItem(key);
  else store.setItem(key, JSON.stringify({ text, at: Date.now() }));
}
function removeDraft(key) {
  if (!key) return;
  draftStorage()?.removeItem(key);
}
function clearUserDrafts(userId) {
  const store = draftStorage();
  if (!store) return;
  draftKeys(store)
    .filter((key) => key.startsWith(`${DRAFT_PREFIX}${userId}:`))
    .forEach((key) => store.removeItem(key));
}
function ageAllDrafts() {
  const store = draftStorage();
  if (!store) return 0;
  const keys = draftKeys(store);
  keys.forEach((key) => {
    const data = parseDraft(store, key);
    if (data)
      store.setItem(
        key,
        JSON.stringify({ text: data.text, at: data.at - 8 * 24 * 60 * 60 * 1000 }),
      );
  });
  return keys.length;
}
function clearAllDrafts() {
  const store = draftStorage();
  if (!store) return 0;
  const keys = draftKeys(store);
  keys.forEach((key) => store.removeItem(key));
  return keys.length;
}
const formatDraftTime = (at) =>
  new Date(at).toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
function draftNote(draft) {
  if (!draftStatus.available)
    return '<p class="draft-note" role="status">この環境では下書きを一時保存できません。</p>';
  return `<p class="draft-note">${draft.at ? `下書きを復元しました(最終編集 ${e(formatDraftTime(draft.at))})。` : ""}入力中の内容はこの端末に一時保存され、最終編集から7日で消えます。</p>`;
}

/* ---------- 入力の長さの表示と確認(C-90) ---------- */
const charCount = (value) => [...String(value).trim()].length;
let counterSeq = 0;
function updateCounter(el) {
  const counter = document.getElementById(el.dataset.counterId);
  if (!counter) return;
  const count = charCount(el.value);
  const min = Number(el.dataset.min || 0);
  const max = Number(el.dataset.max);
  const range = min ? `${min}〜${max}文字` : `${max}文字まで`;
  const over = count > max;
  counter.textContent = over
    ? `${range}。上限を${count - max}文字超えています(現在${count}文字)`
    : `${range}。現在${count}文字`;
  counter.classList.toggle("over", over);
}
function decorateLimits() {
  document
    .querySelectorAll(
      "#screen [data-max], #thread-panel [data-max], #modal [data-max]",
    )
    .forEach((el) => {
      if (el.dataset.counterId && document.getElementById(el.dataset.counterId))
        return;
      counterSeq += 1;
      const counter = document.createElement("span");
      counter.className = "char-count";
      counter.id = `char-count-${counterSeq}`;
      el.dataset.counterId = counter.id;
      el.insertAdjacentElement("afterend", counter);
      el.setAttribute(
        "aria-describedby",
        `${el.getAttribute("aria-describedby") || ""} ${counter.id}`.trim(),
      );
      updateCounter(el);
    });
}
function validateLimits(form) {
  for (const el of form.querySelectorAll("[data-max]")) {
    const count = charCount(el.value);
    const min = Number(el.dataset.min || 0);
    const max = Number(el.dataset.max);
    const name = el.dataset.name || "入力欄";
    if (count > max)
      return { el, message: `${name}は${max}文字以内で入力してください(現在${count}文字)。` };
    if (min && count < min)
      return { el, message: `${name}は${min}〜${max}文字で入力してください。` };
  }
  return null;
}
new MutationObserver(decorateLimits).observe(document.body, {
  childList: true,
  subtree: true,
});

/* ---------- 編集中の離脱の確認(C-82) ---------- */
const guardState = { bypass: false, pending: null };
const screenEl = document.querySelector("#screen");
const threadEl = document.querySelector("#thread-panel");
const modalEl = document.querySelector("#modal");
const confirmEl = document.querySelector("#confirm-dialog");
const LEAVING_UI = new Set([
  "go",
  "case-tab",
  "case-open",
  "channel",
  "dm",
  "dm-new",
  "notification-open",
  "saved-open",
  "logout",
  "case-manage",
  "join-channel",
  "invite-open",
]);
const LEAVING_ACTION = new Set([
  "nav",
  "open-case",
  "back",
  "new-request",
  "reapply",
]);

function formIsDirty(form) {
  return Array.from(form.elements).some((el) => {
    if (el.disabled || ["hidden", "button", "submit", "file"].includes(el.type))
      return false;
    if (el.dataset?.draftKey) return el.value.trim() !== "";
    if (el.type === "checkbox" || el.type === "radio")
      return el.checked !== el.defaultChecked;
    if (el.tagName === "SELECT") {
      // selected 属性がない選択欄は、先頭の項目が初期値になる。
      const initial = Array.from(el.options).findIndex((o) => o.defaultSelected);
      return el.selectedIndex !== Math.max(initial, 0);
    }
    return el.value !== el.defaultValue;
  });
}
function dirtyForms(containers) {
  return containers
    .filter(Boolean)
    .flatMap((container) =>
      Array.from(container.querySelectorAll("form:not([data-no-guard])")),
    )
    .filter(formIsDirty);
}
const allContainers = () => [screenEl, threadEl, modalEl.open ? modalEl : null];
function formsLostBy(target) {
  const ui_ = target.dataset.ui;
  const action = target.dataset.action;
  if (action === "close-modal") return dirtyForms([modalEl]);
  // TODOの編集を閉じるときは、同じ画面のメッセージ入力欄の下書きを巻き込まない。
  if (action?.startsWith("todo-") || action === "detail-tab" || action === "state") {
    if (action === "todo-delete") return [];
    return dirtyForms([screenEl]).filter(
      (form) => form.getAttribute("id") === "todo-form",
    );
  }
  if (ui_ === "thread-close" || ui_ === "thread-open" || ui_ === "thread-pick")
    return dirtyForms([threadEl]);
  if ((ui_ && LEAVING_UI.has(ui_)) || (action && LEAVING_ACTION.has(action)))
    return dirtyForms(allContainers());
  return [];
}
function askDiscard(forms, onDiscard) {
  guardState.pending = { forms, onDiscard };
  confirmEl.showModal();
  confirmEl.querySelector('[data-guard="stay"]').focus();
}
confirmEl.addEventListener("click", (event) => {
  const choice = event.target.closest("[data-guard]")?.dataset.guard;
  if (!choice) return;
  const pending = guardState.pending;
  guardState.pending = null;
  confirmEl.close();
  if (choice !== "discard" || !pending) return;
  // 破棄したときは、その下書きも消す。
  pending.forms.forEach((form) =>
    form
      .querySelectorAll("[data-draft-key]")
      .forEach((el) => removeDraft(el.dataset.draftKey)),
  );
  guardState.bypass = true;
  try {
    pending.onDiscard();
  } finally {
    guardState.bypass = false;
  }
});
confirmEl.addEventListener("cancel", () => {
  guardState.pending = null;
});
modalEl.addEventListener("cancel", (event) => {
  if (guardState.bypass) return;
  const forms = dirtyForms([modalEl]);
  if (!forms.length) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  askDiscard(forms, () => closeModal());
});
window.addEventListener("beforeunload", (event) => {
  if (!dirtyForms(allContainers()).length) return;
  event.preventDefault();
  event.returnValue = "";
});
document.addEventListener("focusin", (event) => {
  if (event.target.tagName === "SELECT")
    event.target.dataset.prev = event.target.value;
});
document.addEventListener(
  "change",
  (event) => {
    const target = event.target;
    if (guardState.bypass || target.tagName !== "SELECT") return;
    const leaving = target.id === "screen-catalog" || target.id === "viewer";
    if (!leaving) return;
    const forms = dirtyForms(allContainers());
    if (!forms.length) return;
    event.stopImmediatePropagation();
    const next = target.value;
    target.value = target.dataset.prev ?? target.value;
    askDiscard(forms, () => {
      target.value = next;
      target.dispatchEvent(new Event("change", { bubbles: true }));
    });
  },
  true,
);

/* ---------- アバターメニュー: ステータスの変更(C-79) ---------- */
const STATUS_CHOICES = ["在席", "外出", "欠席", "休暇", "会議中"];
function openAvatarMenu() {
  const dialog = document.querySelector("#avatar-dialog");
  const current = currentUser().status || "在席";
  // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。入れる文字列は、固定のマークアップと e()（escapeHtml）を通した値だけで、利用者の入力をそのまま入れない
  dialog.innerHTML = `<div class="drawer-header"><strong>自分のメニュー</strong><button type="button" data-ui="avatar-close" aria-label="自分のメニューを閉じる">×</button></div><div class="avatar-links"><p class="avatar-status-label" id="avatar-status-label">ステータス: ${e(current)}</p><div class="status-buttons" role="group" aria-labelledby="avatar-status-label">${STATUS_CHOICES.map((value) => `<button type="button" class="button small ${value === current ? "primary" : ""}" data-ui="set-status" data-value="${e(value)}" aria-pressed="${value === current}">${e(value)}</button>`).join("")}</div>${[
    ["S19", "プロフィール"],
    ["S04", "パスワード変更"],
    ["S33", "整理スペース"],
  ]
    .map(([id, label]) => protoButton(label, "go", `data-page="${id}"`))
    .join("")}${protoButton("ログアウト", "logout")}</div>`;
  if (!dialog.open) dialog.showModal();
  dialog.querySelector("[aria-pressed=true]")?.focus();
}

/* ---------- スレッド一覧 S-35(C-91) ---------- */
function collectThreads() {
  const me = state.userId;
  const found = [];
  const consider = (source, context, label, message) => {
    const replies = message.replies || [];
    if (!replies.length) return;
    const reasons = [];
    if (replies.some((reply) => reply.by === me)) reasons.push("あなたが返信");
    if (message.by === me) reasons.push("あなたのメッセージへの返信");
    if ((message.mentions || []).includes(me)) reasons.push("あなたへのメンション");
    if (!reasons.length) return;
    found.push({
      source,
      ...context,
      label,
      message,
      reasons,
      last: replies.reduce((a, b) => ((b.ts || 0) >= (a.ts || 0) ? b : a)),
      unread: replies.filter((reply) => reply.unreadFor?.includes(me)).length,
    });
  };
  // 閲覧できない部屋(参加していないチャンネル、見えない案件など)のスレッドは出さない。
  prototypeData.channels
    .filter(isChannelMember)
    .forEach((channel) =>
      channel.messages.forEach((message) =>
        consider("channel", { channelId: channel.id }, `# ${channel.name}`, message),
      ),
    );
  state.cases
    .filter((item) => canSeeContent(item))
    .forEach((item) =>
      item.messages.forEach((message) =>
        consider("case", { caseId: item.id }, `${item.no} ${item.title}`, message),
      ),
    );
  Object.entries(prototypeData.dm).forEach(([key, messages]) => {
    const ids = key.split(":");
    if (!ids.includes(me)) return;
    const partnerId = ids.find((id) => id !== me);
    messages.forEach((message) =>
      consider("dm", { partnerId }, `@ ${nameOf(partnerId)}`, message),
    );
  });
  return found.sort((a, b) => (b.last.ts || 0) - (a.last.ts || 0));
}
function markThreadRead(message) {
  (message.replies || []).forEach((reply) => {
    if (reply.unreadFor)
      reply.unreadFor = reply.unreadFor.filter((id) => id !== state.userId);
  });
}
const unreadThreadTotal = () =>
  collectThreads().reduce((sum, thread) => sum + thread.unread, 0);
function threadsScreen() {
  const threads = collectThreads();
  ui.threadList = threads;
  return screenFrame(
    "S35",
    "スレッド一覧",
    "自分が返信した・自分のメッセージに返信があった・自分がメンションされたスレッドを、最後の返信が新しい順に並べます。閲覧できるものだけが出ます。",
    shellCard(
      "スレッド",
      threads.length
        ? threads
            .map(
              (thread, index) =>
                `<div class="directory-row thread-row"><div><strong>${e(thread.label)}</strong>${thread.unread ? `<span class="unread-mark-inline">● 未読の返信 ${thread.unread}件</span>` : ""}<p>${e(thread.message.text.slice(0, 60))}</p><p class="subtle">最後の返信: ${e(nameOf(thread.last.by))}・${e(thread.last.at || "")} ／ 返信 ${thread.message.replies.length}件 ／ ${e(thread.reasons.join("、"))}</p></div>${protoButton("スレッドを開く", "thread-pick", `data-key="${index}" aria-label="${e(thread.label)}のスレッドを開く"`)}</div>`,
            )
            .join("")
        : "<p>スレッドはまだありません。</p>",
    ),
  );
}
function pickThread(element) {
  const entry = (ui.threadList || [])[Number(element.dataset.key)];
  if (!entry) return refuse("スレッドが見つかりません。");
  const thread = {
    source: entry.source,
    message: entry.message,
    viewerId: state.userId,
    caseId: entry.caseId || null,
    channelId: entry.channelId || null,
    partnerId: entry.partnerId || null,
    label: entry.label,
  };
  if (!threadCanRead(thread)) return refuse("このスレッドは閲覧できません。");
  const key = element.dataset.key;
  showThread(thread);
  render();
  ui.threadReturn = screenEl.querySelector(`[data-ui="thread-pick"][data-key="${key}"]`);
  threadEl.querySelector("button")?.focus();
}

/* ---------- 取引先の管理 S-36(C-89・C-91・C-92) ---------- */
const normalizeName = (value) => value.trim().toLowerCase();
const clientCaseCount = (code) =>
  state.cases.filter((item) => item.clientCode === code).length;
function clientsScreen() {
  const rows = state.clients
    .map((client) => {
      const reserved = client.code === "INT";
      const operations = client.active
        ? protoButton("名前を変更", "client-edit", `data-code="${e(client.code)}" aria-label="${e(client.name)}の名前を変更"`) +
          (reserved
            ? ""
            : protoButton("無効にする", "client-disable", `data-code="${e(client.code)}" aria-label="${e(client.name)}を無効にする"`))
        : "";
      return `<tr><td data-label="コード">${e(client.code)}</td><td data-label="取引先名">${e(client.name)}${reserved ? "(初期データ)" : ""}</td><td data-label="状態">${client.active ? "有効" : "無効"}</td><td data-label="案件数">${clientCaseCount(client.code)}件</td><td data-label="操作"><span class="inline-actions">${operations}</span></td></tr>`;
    })
    .join("");
  return screenFrame(
    "S36",
    "取引先の管理",
    "案件に結びつける取引先を管理します。登録・名前の変更・無効化は全体管理者だけが行い、再認証は求めません。",
    shellCard(
      "取引先の一覧",
      state.clients.length
        ? `<table class="client-table"><caption class="visually-hidden">取引先の一覧</caption><thead><tr><th scope="col">コード</th><th scope="col">取引先名</th><th scope="col">状態</th><th scope="col">案件数</th><th scope="col">操作</th></tr></thead><tbody>${rows}</tbody></table>`
        : "<p>取引先はありません。</p>",
      protoButton("＋ 取引先を登録", "client-add", "", true),
    ) +
      hint(
        "未決定: 無効にした取引先の案件の表示、一覧の並び・絞り込み、案件番号の検索方式、連番が9999を超えたときの扱い。ここでは確定した動きとして作っていません。",
      ),
  );
}
function openClientForm(code) {
  if (!adminOnly()) return refuse();
  const client = code ? clientByCode(code) : null;
  if (code && !client) return refuse("取引先が見つかりません。");
  const locked =
    client && (client.code === "INT" || clientCaseCount(client.code) > 0);
  const codeField = `<div class="form-field"><label for="client-code">取引先コード(英大文字3文字)</label><input id="client-code" name="client-code" value="${e(client?.code || "")}" autocomplete="off" ${locked ? "disabled" : 'required data-min="3" data-max="3" data-name="取引先コード"'}></div>${locked ? `<p class="form-hint">${client.code === "INT" ? "予約コード INT(社内)は変更できません。" : "この取引先の案件があるため、コードは変更できません。"}</p>` : ""}`;
  showModal(
    client ? "取引先の名前を変更" : "取引先を登録",
    `${codeField}${field("取引先名", "client-name", "text", client?.name || "", true, [1, 50])}<input type="hidden" name="target" value="${e(client?.code || "")}">`,
    "client-save",
    client ? "変更する" : "登録する",
  );
}
function saveClient(data) {
  if (!adminOnly()) return refuse();
  const target = String(data.get("target") || "");
  const client = target ? clientByCode(target) : null;
  if (target && !client) return refuse("取引先が見つかりません。");
  const name = String(data.get("client-name") || "").trim();
  if (!name) return modalError("取引先名を入力してください。");
  if (
    state.clients.some(
      (other) => other !== client && normalizeName(other.name) === normalizeName(name),
    )
  )
    return modalError(
      "同じ名前の取引先がすでにあります(前後の空白と大文字・小文字の違いは区別しません)。",
    );
  const locked =
    client && (client.code === "INT" || clientCaseCount(client.code) > 0);
  const newCode = locked ? client.code : String(data.get("client-code") || "").trim();
  if (!locked) {
    if (!/^[A-Z]{3}$/.test(newCode))
      return modalError("取引先コードは英大文字3文字で入力してください。");
    if (state.clients.some((other) => other !== client && other.code === newCode))
      return modalError("同じコードの取引先がすでにあります。");
  }
  if (client) {
    client.name = name;
    client.code = newCode;
  } else state.clients.push({ code: newCode, name, active: true });
  closeModal();
  render();
  return notify(client ? "取引先名を変更しました。" : "取引先を登録しました。");
}
function openClientDisable(code) {
  if (!adminOnly()) return refuse();
  const client = clientByCode(code);
  if (!client || !client.active) return refuse("取引先が見つかりません。");
  if (client.code === "INT")
    return refuse("予約コード INT(社内)の取引先は無効にできません。");
  showModal(
    "取引先を無効にする",
    `<p>${e(client.name)}(${e(client.code)})を無効にします。新しい案件の申請では選べなくなります。</p><input type="hidden" name="target" value="${e(client.code)}">`,
    "client-disable",
    "無効にする",
    true,
  );
}
function disableClient(data) {
  const client = clientByCode(String(data.get("target") || ""));
  if (!adminOnly() || !client || !client.active) return refuse();
  if (client.code === "INT")
    return refuse("予約コード INT(社内)の取引先は無効にできません。");
  client.active = false;
  closeModal();
  render();
  return notify("取引先を無効にしました。");
}

/* ---------- サイドバーの開閉の保存(案。C-106【案】に伴う追加) ---------- */
// 閉じているセクション名の配列を、この端末のブラウザだけに保存する。サーバーには保存しない。
// 保存を社員ごとにするか端末ごとにするか、期限、サーバー保存の要否は未決定。ここでは社員ごと（画面確認で社員を替えて確かめるため）。
const SIDEBAR_PREFIX = "internal-system-proto-sidebar:";
const SIDE_SECTIONS = ["company", "own", "other", "dm", "case", "org"];
// 一度でも読み書きに失敗したら、再読み込みするまで false のままにして、知らせ続ける（成功した操作で消さない）。
const sidebarStatus = { available: true };
const sidebarKey = (userId) => `${SIDEBAR_PREFIX}${userId}`;

function sidebarStorage() {
  try {
    return window.localStorage;
  } catch (error) {
    // 保存できない環境では、開けるか閉じるかはメモリの状態だけで動かし、サイドバーの下に知らせる。
    sidebarStatus.available = false;
    return null;
  }
}
function loadSidebarState(userId) {
  const store = sidebarStorage();
  if (!store) return [];
  let raw = null;
  try {
    raw = store.getItem(sidebarKey(userId));
  } catch (error) {
    sidebarStatus.available = false;
    return [];
  }
  if (raw === null) return [];
  let list = null;
  try {
    list = JSON.parse(raw);
  } catch (error) {
    // 壊れた値は復元できないため捨てる（開閉の状態は補助の保存で、主の処理には影響しない）。
    discardSidebarState(userId);
    return [];
  }
  if (!Array.isArray(list) || !list.every((item) => SIDE_SECTIONS.includes(item))) {
    discardSidebarState(userId);
    return [];
  }
  return list;
}
function discardSidebarState(userId) {
  try {
    sidebarStorage()?.removeItem(sidebarKey(userId));
  } catch (error) {
    sidebarStatus.available = false;
  }
}
function saveSidebarState(userId, collapsed) {
  const store = sidebarStorage();
  if (!store) return;
  try {
    store.setItem(sidebarKey(userId), JSON.stringify([...collapsed]));
  } catch (error) {
    sidebarStatus.available = false;
  }
}
// 社員を替えたときは、その社員の保存した状態を読み直す。保存がなければ、すべて開く。
function sideCollapsed() {
  if (ui.sideLoadedFor !== state.userId) {
    ui.sideLoadedFor = state.userId;
    ui.sideCollapsed = new Set(loadSidebarState(state.userId));
  }
  return ui.sideCollapsed;
}
function setSideCollapsed(sections) {
  sideCollapsed();
  ui.sideCollapsed = new Set(sections);
  saveSidebarState(state.userId, ui.sideCollapsed);
  renderSidebars();
}
function toggleSideSection(element) {
  const section = element.dataset.section;
  if (!SIDE_SECTIONS.includes(section)) return refuse();
  const next = new Set(sideCollapsed());
  if (next.has(section)) next.delete(section);
  else next.add(section);
  // 操作元のコンテナー（パソコンの左かドロワー）の中だけでフォーカスを戻す。ドロワーの操作で背面へ移らないようにする。
  const container = element.closest("#sidebar-content, #drawer-content");
  setSideCollapsed(next);
  container
    ?.querySelector(`[data-ui="side-toggle"][data-section="${section}"]`)
    ?.focus();
}
function clearSideState() {
  discardSidebarState(state.userId);
  ui.sideLoadedFor = state.userId;
  ui.sideCollapsed = new Set();
  renderSidebars();
  notify("保存した開閉の状態を消しました。すべて開きます。");
}

/* ---------- クリック・送信・入力の受け口(最初に登録する) ---------- */
const EXTRA_UI = {
  "dm-new": () => {
    ui.dmUserId = null;
    proceedTo("S06");
  },
  "set-status": (element) => {
    currentUser().status = element.dataset.value;
    openAvatarMenu();
    if (["S06", "S20", "S27"].includes(state.page)) render();
    notify(`ステータスを「${currentUser().status}」にしました。`);
  },
  "thread-pick": pickThread,
  "client-add": () => openClientForm(null),
  "client-edit": (element) => openClientForm(element.dataset.code),
  "client-disable": (element) => openClientDisable(element.dataset.code),
  "side-toggle": toggleSideSection,
  "side-open-all": () => setSideCollapsed([]),
  "side-close-all": () => setSideCollapsed(SIDE_SECTIONS),
  "side-clear": clearSideState,
  "draft-age": () =>
    notify(
      `${ageAllDrafts()}件の下書きの最終編集を8日前にしました。ページを再読み込みすると期限切れとして消えます。`,
    ),
  "draft-clear": () => notify(`${clearAllDrafts()}件の下書きを消しました。`),
};
const EXTRA_MODAL = {
  "client-save": saveClient,
  "client-disable": disableClient,
};

document.addEventListener(
  "click",
  (event) => {
    const target = event.target.closest("[data-ui],[data-action]");
    if (!target || target.disabled) return;
    if (!guardState.bypass) {
      const forms = formsLostBy(target);
      if (forms.length) {
        event.preventDefault();
        event.stopImmediatePropagation();
        askDiscard(forms, () => target.click());
        return;
      }
    }
    const handler = target.dataset.ui && EXTRA_UI[target.dataset.ui];
    if (!handler) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    handler(target);
  },
  true,
);
document.addEventListener(
  "submit",
  (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    // name="id" の入力欄があると form.id が要素に置き換わるため、属性で読む。
    const formId = form.getAttribute("id");
    const problem = validateLimits(form);
    if (problem) {
      event.preventDefault();
      event.stopImmediatePropagation();
      problem.el.setAttribute("aria-invalid", "true");
      if (formId === "modal-form") modalError(problem.message);
      else notify(problem.message);
      problem.el.focus();
      return;
    }
    if (formId === "global-search" && !guardState.bypass) {
      const forms = dirtyForms(allContainers());
      if (forms.length) {
        event.preventDefault();
        event.stopImmediatePropagation();
        askDiscard(forms, () => form.requestSubmit());
      }
      return;
    }
    const handler = formId === "modal-form" && EXTRA_MODAL[form.dataset.submit];
    if (!handler) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    handler(new FormData(form));
  },
  true,
);
document.addEventListener("input", (event) => {
  const el = event.target;
  if (el.dataset?.counterId) updateCounter(el);
  if (el.getAttribute?.("aria-invalid")) el.removeAttribute("aria-invalid");
  if (el.dataset?.draftKey) saveDraft(el.dataset.draftKey, el.value);
  if (el.id === "dm-search") {
    const term = el.value.trim().toLowerCase();
    let shown = 0;
    document.querySelectorAll(".person-card[data-name]").forEach((card) => {
      const match = card.dataset.name.toLowerCase().includes(term);
      card.hidden = !match;
      if (match) shown += 1;
    });
    document.querySelector("#dm-search-empty").hidden = shown > 0;
  }
});

purgeExpiredDrafts();
