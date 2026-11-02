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

// 保存できない環境では、入力欄の下に「保存できません」と表示し(draftNote)、失敗した事実を警告に残す。
// strict のとき（後始末など、失敗を呼び出し元へ伝えたいとき）は、例外をそのまま投げる。
function draftStorage(strict = false) {
  try {
    return window.localStorage;
  } catch (error) {
    draftStatus.available = false;
    console.warn("下書きの保存先（localStorage）を取得できません", error);
    if (strict) throw error;
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
// 後始末用。保存先の取得・削除の失敗を例外のまま呼び出し元（runCleanup）へ伝える。
function removeDraftStrict(key) {
  if (!key) return;
  draftStorage(true).removeItem(key);
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
// data-normalize のある欄（保存時に自動整形する欄）は整形後の文字数、それ以外は従来どおり。カウンターと送信時の検査の両方で使う。
const fieldCount = (el) =>
  el.hasAttribute("data-normalize") ? [...normalizeInput(el.value)].length : charCount(el.value);
let counterSeq = 0;
function updateCounter(el) {
  const counter = document.getElementById(el.dataset.counterId);
  if (!counter) return;
  const count = fieldCount(el);
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
    // data-normalize のある欄（件名・取引先名・チャンネル名・部署名・TODOの題名・拠点名）だけ、保存値と同じ整形後の文字数で数える（C-121【案】）。
    const normalized = el.hasAttribute("data-normalize");
    const count = fieldCount(el);
    const min = Number(el.dataset.min || 0);
    const max = Number(el.dataset.max);
    const name = el.dataset.name || "入力欄";
    if (normalized && min && count === 0) return { el, message: `${name}を入力してください。` };
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
// ステータスの切り替えは S-19 などを描き直すため、未保存の入力があれば破棄の確認を出す(C-136)。
["header-status-set", "header-status-return", "set-status"].forEach((name) => LEAVING_UI.add(name));
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
const STATUS_DOT_CLASS = { 在席: "present", 外出: "away", 欠席: "absent", 休暇: "leave", 会議中: "meeting" };
const RETURN_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
// ステータスと戻り予定の保存は、この関数だけが行う（ヘッダー・アバターメニュー・プロフィール S-19 の共通）。
// 検証してから 1 回だけ書く。在席のときは戻り予定を持たない。
function setMyStatus(status, returnAt) {
  // 外部の値は 1 回だけ読み、文字列でなければ変換せずに拒否する(オブジェクト・getter・Proxy 対策)。
  if (typeof status !== "string") return refuse("ステータスが正しくありません。");
  if (returnAt !== undefined && returnAt !== null && typeof returnAt !== "string")
    return refuse("戻り予定が正しくありません。");
  const time = (returnAt ?? "").trim();
  if (!STATUS_CHOICES.includes(status)) return refuse("ステータスが正しくありません。");
  if (time && !RETURN_TIME_PATTERN.test(time)) return refuse("戻り予定は「時:分」の形式で入力してください。");
  // 保存先を直接書き換えない。現在の社員の値から通常オブジェクトの複製を作り、検証した値を差し替えて、配列の要素を 1 回の代入で置き換える。
  // 途中で失敗しても部分更新は残らない。複製は新しい通常オブジェクトなので、元が Proxy でも accessor でも、以後はその影響を受けない。
  // id も直接読まず、データプロパティのときだけ比較する(accessor の id は一致扱いにしない)。
  const index = employees.findIndex((person) => {
    const idDescriptor = Object.getOwnPropertyDescriptor(person, "id");
    return !!idDescriptor && "value" in idDescriptor && idDescriptor.value === state.userId;
  });
  if (index < 0) return refuse();
  const source = employees[index];
  if (Object.getPrototypeOf(source) !== Object.prototype) return refuse("ステータスを保存できません。");
  const descriptors = Object.getOwnPropertyDescriptors(source);
  const copy = Object.create(Object.prototype);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable) continue;
    if (!("value" in descriptor)) return refuse("ステータスを保存できません。");
    // 代入せず定義する(自身の __proto__ や継承の setter を動かさない)。
    Object.defineProperty(copy, key, { value: descriptor.value, writable: true, enumerable: true, configurable: true });
  }
  if (copy.id !== state.userId) return refuse("ステータスを保存できません。");
  Object.defineProperty(copy, "status", { value: status, writable: true, enumerable: true, configurable: true });
  Object.defineProperty(copy, "returnAt", { value: status === "在席" ? "" : time, writable: true, enumerable: true, configurable: true });
  employees[index] = copy;
  return true;
}
// 他の画面の表示用（社員一覧・DM・プロフィールカード）。在席以外で戻り予定があれば添える。
const statusText = (person) =>
  `${person.status || "在席"}${person.returnAt && person.status && person.status !== "在席" ? `（戻り ${person.returnAt}）` : ""}`;
// ステータスを変えたあと、見えている画面を描き直す。ヘッダーのボタンも更新する。
function afterMyStatusChange() {
  renderHeaderStatus();
  if (["S06", "S19", "S20", "S27"].includes(state.page)) render();
}
// ヘッダーのステータスボタン(C-136)。既存の「⋯」メニューの作法(role=menu・Esc・矢印・フォーカスを戻す)に合わせる。
function renderHeaderStatus() {
  const box = document.querySelector("#header-status");
  if (!box) return;
  const user = currentUser();
  if (!user) return;
  const current = user.status || "在席";
  const returnAt = user.returnAt || "";
  const tail = returnAt && current !== "在席" ? `（戻り ${returnAt}）` : "";
  const items = STATUS_CHOICES.map(
    (value) =>
      `<button type="button" role="menuitem" data-ui="header-status-set" data-value="${e(value)}"${value === current ? ' aria-current="true"' : ""}><span class="status-dot ${STATUS_DOT_CLASS[value]}" aria-hidden="true"></span>${e(value)}${value === current ? "（現在）" : ""}</button>`,
  ).join("");
  // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。入れる文字列は、固定のマークアップと e()（escapeHtml）を通した値だけで、利用者の入力をそのまま入れない
  box.innerHTML = `<button type="button" class="button small status-toggle" data-ui="menu-toggle" aria-haspopup="menu" aria-expanded="false" aria-label="ステータス: ${e(current)}${e(tail)}。変更する"><span class="status-dot ${STATUS_DOT_CLASS[current]}" aria-hidden="true"></span><span class="status-text">${e(current)}</span></button><div class="kebab-menu status-menu" role="menu" aria-label="ステータスの変更" hidden>${items}<div class="status-return" role="none"><label for="header-status-time">戻り予定（任意）</label><input id="header-status-time" type="time" value="${e(returnAt)}"></div><button type="button" role="menuitem" data-ui="header-status-return">戻り予定だけ更新</button></div>`;
}
function headerStatusTime(element) {
  return element.closest(".kebab-menu")?.querySelector("input[type=time]")?.value ?? "";
}
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
    .filter((channel) => isChannelMember(channel) && !chArchived(channel))
    .forEach((channel) =>
      channel.messages.forEach((message) =>
        consider("channel", { channelId: channel.id }, `# ${channel.name}`, message),
      ),
    );
  state.cases
    .filter((item) => !caseArchived(item) && canSeeContent(item))
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
                `<div class="directory-row thread-row"><div><strong>${e(thread.label)}</strong>${thread.unread ? `<span class="unread-mark-inline">● 未読の返信 ${thread.unread}件</span>` : ""}<p>${thread.message.deleted ? "削除されました" : e(thread.message.text.slice(0, 60))}</p><p class="subtle">最後の返信: ${e(nameOf(thread.last.by))}・${e(thread.last.at || "")} ／ 返信 ${thread.message.replies.length}件 ／ ${e(thread.reasons.join("、"))}</p></div>${protoButton("スレッドを開く", "thread-pick", `data-key="${index}" aria-label="${e(thread.label)}のスレッドを開く"`)}</div>`,
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
// 取引先の一覧の絞り込み（C-125）。検索は取引先名とコードの部分一致（案。方式は未決定）、状態は すべて・有効・無効。
// 並び順はコード順（文字列の単純な比較）。無効にした取引先を有効に戻す操作は作らない。
const CLIENT_STATE_OPTIONS = [
  ["all", "すべて"],
  ["active", "有効"],
  ["inactive", "無効"],
];
function visibleClients() {
  const term = compareKey(ui.clientQuery);
  return state.clients
    .filter((client) => ui.clientState === "all" || (ui.clientState === "active") === client.active)
    .filter((client) => !term || compareKey(client.name).includes(term) || compareKey(client.code).includes(term))
    .slice()
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}
// 一覧の表と件数。検索・絞り込みのたびに、この部分だけを描き直す（入力欄は描き直さない。日本語の入力の途中でも崩れない）。
function clientResultsHtml() {
  const shown = visibleClients();
  const rows = shown
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
  return `${shown.length ? `<table class="client-table"><caption class="visually-hidden">取引先の一覧</caption><thead><tr><th scope="col">コード</th><th scope="col">取引先名</th><th scope="col">状態</th><th scope="col">案件数</th><th scope="col">操作</th></tr></thead><tbody>${rows}</tbody></table>` : '<p id="client-empty">該当する取引先はありません。</p>'}<p class="form-hint" role="status">${shown.length}件を表示（コード順）</p>`;
}
function refreshClientResults() {
  const box = document.querySelector("#client-results");
  if (!box) return;
  // nosemgrep: insecure-innerhtml, insecure-document-method 取引先の一覧の描画。入れる文字列は、固定のマークアップと e()（escapeHtml）を通した値だけで組み立てており、取引先名などの入力をそのまま入れない
  box.innerHTML = clientResultsHtml();
}
function clientsScreen() {
  return screenFrame(
    "S36",
    "取引先の管理",
    "案件に結びつける取引先を管理します。登録・名前の変更・無効化は全体管理者だけが行い、再認証は求めません。",
    shellCard(
      "取引先の一覧",
      state.clients.length
        ? `<div class="directory-toolbar"><div class="form-field"><label for="client-search">取引先名・コードで検索（部分一致。方式は案）</label><input id="client-search" type="search" autocomplete="off" value="${e(ui.clientQuery)}"></div>${selectField("状態", "client-state", CLIENT_STATE_OPTIONS, ui.clientState)}</div><div id="client-results">${clientResultsHtml()}</div>`
        : "<p>取引先はありません。</p>",
      protoButton("＋ 取引先を登録", "client-add", "", true),
    ) +
      hint(
        "無効にした後は、既存の案件に取引先名を出して「（無効）」の印を付けます（C-117）。新しい案件の申請では選べません。一覧はコード順で、検索と状態の絞り込みができます（C-125）。無効にした取引先は、有効に戻せません（再び使うときは、新しいコードで登録し直します）。未決定: 1ページの件数・ページ送り・検索の方式（部分一致は案）。",
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
    `${codeField}${field("取引先名", "client-name", "text", client?.name || "", true, [1, 50], true)}<p class="subtle">保存時に表記を自動で整えます（全角英数字を半角に、連続する空白を1つに、ハイフン類を「-」に。細部は案）。</p><input type="hidden" name="target" value="${e(client?.code || "")}">`,
    "client-save",
    client ? "変更する" : "登録する",
  );
}
function saveClient(data) {
  if (!adminOnly()) return refuse();
  const target = String(data.get("target") || "");
  const client = target ? clientByCode(target) : null;
  if (target && !client) return refuse("取引先が見つかりません。");
  // 取引先名は保存時に自動整形する（C-121【案】）。長さと重複は整形後の値で、既存の名前も同じ整形をして比べる（無効の取引先を含む）。
  const rawName = String(data.get("client-name") || "");
  const name = normalizeInput(rawName);
  if (!name) return modalError("取引先名を入力してください。");
  if ([...name].length > 50) return modalError("取引先名は1〜50文字で入力してください（整形後の文字数）。");
  if (
    state.clients.some(
      (other) => other !== client && compareKey(other.name) === compareKey(name),
    )
  )
    return modalError(
      "同じ名前の取引先がすでにあります(整形後の値で、大文字・小文字の違いは区別しません)。",
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
  return notify(`${client ? "取引先名を変更しました。" : "取引先を登録しました。"}${rawName.trim() !== name ? "表記を整えて保存しました（案）。" : ""}`);
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
// 管理メニューのまとまり（manage-*。案）も、同じ仕組みで開閉する。
const SIDE_SECTIONS = [
  "company",
  "own",
  "other",
  "dm",
  "case",
  "org",
  "manage-approve",
  "manage-account",
  "manage-dept",
  "manage-master",
];
// 一度でも読み書きに失敗したら、再読み込みするまで false のままにして、知らせ続ける（成功した操作で消さない）。
const sidebarStatus = { available: true };
const sidebarKey = (userId) => `${SIDEBAR_PREFIX}${userId}`;

function sidebarStorage() {
  try {
    return window.localStorage;
  } catch (error) {
    // 保存できない環境では、開けるか閉じるかはメモリの状態だけで動かし、サイドバーの下に知らせる。
    sidebarStatus.available = false;
    console.warn("サイドバーの開閉の保存先（localStorage）を取得できません", error);
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
    console.warn("サイドバーの開閉の状態を読み込めません", error);
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
    console.warn("サイドバーの開閉の状態を消せません", error);
  }
}
function saveSidebarState(userId, collapsed) {
  const store = sidebarStorage();
  if (!store) return;
  try {
    store.setItem(sidebarKey(userId), JSON.stringify([...collapsed]));
  } catch (error) {
    sidebarStatus.available = false;
    console.warn("サイドバーの開閉の状態を保存できません", error);
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
    if (!setMyStatus(element.dataset.value, currentUser().returnAt)) return;
    openAvatarMenu();
    afterMyStatusChange();
    notify(`ステータスを「${currentUser().status}」にしました。`);
  },
  "header-status-set": (element) => {
    // メニューを閉じたあとに描き直すため、入力の時刻は先に読む(単一読み取り)。
    const time = headerStatusTime(element);
    if (!setMyStatus(element.dataset.value, time)) return;
    afterMyStatusChange();
    document.querySelector("#header-status .status-toggle")?.focus();
    notify(`ステータスを「${currentUser().status}」にしました。`);
  },
  "header-status-return": (element) => {
    const time = headerStatusTime(element);
    const status = currentUser().status || "在席";
    if (status === "在席") return refuse("在席のときは戻り予定を設定できません。先に在席以外を選んでください。");
    if (!setMyStatus(status, time)) return;
    afterMyStatusChange();
    document.querySelector("#header-status .status-toggle")?.focus();
    notify(time ? `戻り予定を ${time} にしました。` : "戻り予定を消しました。");
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
  if (el.id === "chadm-search") {
    ui.chAdmQuery = el.value;
    refreshChannelAdmin();
  }
  if (el.id === "caadm-search") {
    ui.caAdmQuery = el.value;
    refreshCaseAdmin();
  }
  if (el.id === "client-search") {
    ui.clientQuery = el.value;
    refreshClientResults();
  }
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

document.addEventListener("change", (event) => {
  if (event.target.id === "chadm-state" && ADMIN_STATE_FILTERS.channel.some(([value]) => value === event.target.value)) {
    ui.chAdmState = event.target.value;
    refreshChannelAdmin();
    return;
  }
  if (event.target.id === "caadm-state" && ADMIN_STATE_FILTERS.case.some(([value]) => value === event.target.value)) {
    ui.caAdmState = event.target.value;
    refreshCaseAdmin();
    return;
  }
  if (event.target.id !== "client-state") return;
  if (!CLIENT_STATE_OPTIONS.some(([value]) => value === event.target.value)) return;
  ui.clientState = event.target.value;
  refreshClientResults();
});

purgeExpiredDrafts();
