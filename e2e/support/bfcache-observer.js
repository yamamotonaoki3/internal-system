// #342（342-A。計画 plan342a2 の 8 節）：通常のブラウザでの、実際の bfcache の保存・復元の観測の補助（M1〜M3 で使う）。本番の成果物には組み込まない。
// 使い方：対象の画面を開き、アプリが起動した後に、開発者ツールのコンソールへ、このファイルの中身を貼って実行する。
//   アプリの起動の後に実行するので、このリスナーは、守り（main.tsx が登録する）より後に動き、守りが包みを隠した後の状態を見る。
//   記録は sessionStorage に置く（同じタブなら、文書が替わっても残る）。window.__bfcache342Observer.dump() で JSON を取り出し、clear() で消す。
// 記録するもの：pageshow・pagehide の persisted・isTrusted、この補助が文書ごとに作る目印と performance.timeOrigin（往復の前後で同じ文書かを見る）、
//   リスナーが見た包み（#root の直下で main を含む要素）の hidden・inert、包みの hidden・inert が変わった時刻、ナビゲーションの種類と notRestoredReasons の理由の名前。
// 記録しないもの：本文・入力値・URL の中身・Cookie・認証情報。
// 合成したイベント（isTrusted が false）と、同じ URL・ナビゲーションの種類・「戻る」の成功だけでは、実際の復元の証拠にしない（計画 8 節）。
(() => {
  const KEY = "bfcache342:observations";
  if (window.__bfcache342Observer !== undefined) return;

  const documentMarker = Math.random().toString(36).slice(2);

  const read = () => JSON.parse(window.sessionStorage.getItem(KEY) ?? "[]");
  const write = (entries) =>
    window.sessionStorage.setItem(KEY, JSON.stringify(entries));
  const append = (entry) =>
    write([...read(), { ...entry, marker: documentMarker, at: Date.now() }]);

  const findWrapper = () =>
    [...document.querySelectorAll("#root > *")].find(
      (element) => element.querySelector("main") !== null,
    ) ?? null;

  const wrapperState = () => {
    const wrapper = findWrapper();
    if (wrapper === null) return { found: false, hidden: null, inert: null };
    return {
      found: true,
      hidden: wrapper.hidden,
      inert: wrapper.hasAttribute("inert"),
    };
  };

  // notRestoredReasons（Chromium）から、理由の名前だけを集める（URL・src・id は記録しない）
  const reasonNames = (node) => {
    if (node === null || node === undefined) return [];
    const own = (node.reasons ?? []).map((item) => item.reason);
    const children = (node.children ?? []).flatMap(reasonNames);
    return [...own, ...children];
  };

  const navigation = () => {
    const entry = performance.getEntriesByType("navigation")[0];
    return {
      navigationType: entry?.type ?? null,
      notRestoredReasons:
        entry === undefined || !("notRestoredReasons" in entry)
          ? null
          : reasonNames(entry.notRestoredReasons),
    };
  };

  const onTransition = (event) =>
    append({
      type: event.type,
      persisted: event.persisted === true,
      isTrusted: event.isTrusted,
      timeOrigin: performance.timeOrigin,
      wrapper: wrapperState(),
      ...navigation(),
    });

  append({
    type: "install",
    timeOrigin: performance.timeOrigin,
    wrapper: wrapperState(),
    ...navigation(),
  });
  window.addEventListener("pagehide", onTransition);
  window.addEventListener("pageshow", onTransition);

  const wrapper = findWrapper();
  if (wrapper !== null)
    new MutationObserver(() =>
      append({ type: "wrapper", wrapper: wrapperState() }),
    ).observe(wrapper, {
      attributes: true,
      attributeFilter: ["hidden", "inert"],
    });

  window.__bfcache342Observer = {
    marker: documentMarker,
    entries: () => read(),
    dump: () => JSON.stringify(read(), null, 2),
    clear: () => window.sessionStorage.removeItem(KEY),
  };
})();
