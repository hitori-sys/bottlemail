// 確認画面（スマホで1件ずつタップして承認・却下する）
import { formatId, maxAfloat, sinkExpired } from "../util.js";

export async function adminPage(env, origin) {
  await sinkExpired(env);
  const max = maxAfloat(env);
  const pending = await env.DB.prepare(
    `SELECT b.id, b.text, b.image IS NOT NULL AS has_image, b.created_at, c.name AS collaborator
     FROM bottles b LEFT JOIN collaborators c ON c.id = b.collaborator_id
     WHERE b.status = 'pending' ORDER BY b.id LIMIT 50`
  ).all();
  const approved = await env.DB.prepare(
    `SELECT b.id, b.text, b.image IS NOT NULL AS has_image, b.slot, b.pinned, b.reviewed_at, c.name AS collaborator
     FROM bottles b LEFT JOIN collaborators c ON c.id = b.collaborator_id
     WHERE b.status = 'approved' ORDER BY b.reviewed_at DESC, b.id DESC LIMIT 300`
  ).all();
  const collaborators = await env.DB.prepare(
    `SELECT c.id, c.name, c.token, c.active, COUNT(b.id) AS posts
     FROM collaborators c LEFT JOIN bottles b ON b.collaborator_id = c.id
     GROUP BY c.id ORDER BY c.id`
  ).all();
  // 「沈まない」以外を新しい順に数えて、あと何通の承認で沈むかを出す（上限 max 通）
  let rank = 0;
  for (const r of approved.results) if (!r.pinned) r.rank = ++rank;
  const counts = await env.DB.prepare("SELECT status, COUNT(*) AS n FROM bottles GROUP BY status").all();
  const count = Object.fromEntries(counts.results.map((r) => [r.status, r.n]));

  const card = (r, buttons) => `
    <article class="card" id="b${r.id}">
      <div class="meta">No.${formatId(r.id)}${r.slot != null ? ` ・ 画像枠 ${r.slot}` : ""} ・ ${fmtDate(r.created_at || r.reviewed_at)}${r.collaborator ? ` ・ 協力者 ${escapeHtml(r.collaborator)}` : ""}${r.pinned ? " ・ 沈まない" : r.rank ? ` ・ あと ${max - r.rank + 1} 通で沈む` : ""}</div>
      ${r.has_image ? `<img src="/admin/image/${r.id}" loading="lazy" alt="">` : ""}
      <p class="text">${escapeHtml(r.text)}</p>
      <div class="actions">${buttons}</div>
    </article>`;

  const pendingHtml = pending.results.length
    ? pending.results.map((r) => card(r,
        `<button class="ok" data-id="${r.id}" data-action="approve">承認</button>
         <button class="ng" data-id="${r.id}" data-action="reject">却下</button>`)).join("")
    : '<p class="empty">確認待ちはありません。</p>';

  const approvedHtml = approved.results.length
    ? approved.results.map((r) => card(r,
        `<button class="ng" data-id="${r.id}" data-action="remove" data-confirm="1">取り下げる</button>`)).join("")
    : '<p class="empty">公開中のボトルはありません。</p>';

  const collabHtml = collaborators.results.map((c) => {
    const url = `${origin}/c/${c.token}`;
    return `
    <article class="card collab${c.active ? "" : " stopped"}">
      <div class="meta">${escapeHtml(c.name)} ・ 投稿 ${c.posts} 通${c.active ? "" : " ・ 停止中"}</div>
      <input class="url" readonly value="${escapeHtml(url)}">
      <div class="actions">
        <button class="sub" data-copy="${escapeHtml(url)}">URL をコピー</button>
        ${c.active
          ? `<button class="ng" data-collab="${c.id}" data-action="stop">停止</button>`
          : `<button class="ok" data-collab="${c.id}" data-action="resume">再開</button>`}
        <button class="ng" data-collab="${c.id}" data-action="delete" data-confirm="この協力者を削除しますか？（URL は使えなくなります。流した手紙は残ります）">削除</button>
      </div>
    </article>`;
  }).join("") || '<p class="empty">協力者はまだいません。</p>';

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>ボトルメール確認</title>
<style>
  :root { --bg: #f4f1ea; --card: #fff; --ink: #2d2a26; --muted: #7b746a; --ok: #2f8f5b; --ng: #b3422f; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: "Yu Gothic", "Noto Sans JP", sans-serif; }
  main { max-width: 640px; margin: 0 auto; padding: 16px 16px 64px; }
  h1 { font-size: 1.3rem; margin: 8px 0; }
  h2 { font-size: 1.1rem; margin: 28px 0 10px; }
  .summary { color: var(--muted); font-size: .9rem; }
  .card { background: var(--card); border-radius: 12px; padding: 14px; margin-bottom: 12px; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
  .meta { font-size: .8rem; color: var(--muted); margin-bottom: 8px; }
  .card img { max-width: 100%; max-height: 360px; border-radius: 8px; display: block; margin-bottom: 8px; }
  .text { white-space: pre-wrap; word-break: break-word; line-height: 1.7; margin: 0 0 12px; }
  .actions { display: flex; gap: 8px; }
  .actions button { flex: 1; padding: 12px; font-size: 1rem; font-weight: bold; border: none; border-radius: 8px; color: #fff; cursor: pointer; font-family: inherit; }
  .ok { background: var(--ok); } .ng { background: var(--ng); }
  .actions button:disabled { opacity: .5; }
  .done { opacity: .45; }
  .empty { color: var(--muted); }
  .sub { background: #2f8fb3; }
  .stopped { opacity: .6; }
  .url { width: 100%; padding: 8px; font-size: .85rem; border: 1px solid #ddd; border-radius: 6px; margin-bottom: 10px; font-family: monospace; }
  .addCollab { display: flex; gap: 8px; margin-bottom: 12px; }
  .addCollab input { flex: 1; padding: 10px; font-size: 1rem; border: 1px solid #ccc; border-radius: 8px; font-family: inherit; }
  .addCollab button { padding: 10px 16px; font-size: 1rem; font-weight: bold; border: none; border-radius: 8px; color: #fff; background: #2f8fb3; cursor: pointer; font-family: inherit; }
  a.new { display: inline-block; padding: 10px 14px; background: #2f8fb3; color: #fff; border-radius: 8px; text-decoration: none; font-weight: bold; }
</style>
</head>
<body>
<main>
  <h1>ボトルメール確認</h1>
  <p><a class="new" href="/admin/new">＋ 管理者としてボトルを流す</a></p>
  <div class="summary">確認待ち ${count.pending || 0} ・ 公開中 ${count.approved || 0} ・ 却下 ${count.rejected || 0} ・ 取り下げ ${count.removed || 0} ・ 沈んだ ${count.sunk || 0}</div>
  <p class="summary">承認したボトルは、次の配信（最長30分後）でワールドに届くようになり、公開中が ${max} 通を超えると、承認した順に古いものから海の底に沈みます（配信から外れ、画像も削除されます。「沈まない」は数えません）。</p>

  <h2>確認待ち</h2>
  ${pendingHtml}

  <h2>公開中（新しい順）</h2>
  ${approvedHtml}

  <h2>協力者</h2>
  <p class="summary">協力者ごとの投稿 URL です。連投制限・ボット確認なしで流せます（公開はここで承認してから）。URL を知っていれば誰でも使えるので、渡す相手だけに伝えてください。漏れたら「停止」か「削除」してください。</p>
  <form class="addCollab" id="addCollab">
    <input id="collabName" maxlength="40" placeholder="協力者の名前（自分用のメモ）">
    <button type="submit">URL を作る</button>
  </form>
  ${collabHtml}
</main>
<script>
async function postJson(url, obj) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-BottleMail-Admin": "1" },
    body: JSON.stringify(obj),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "失敗しました");
  return body;
}

document.getElementById("addCollab").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await postJson("/admin/collaborators", { action: "add", name: document.getElementById("collabName").value });
    location.reload();
  } catch (err) { alert(err.message); }
});

document.addEventListener("click", async (e) => {
  const copy = e.target.closest("button[data-copy]");
  if (copy) {
    try { await navigator.clipboard.writeText(copy.dataset.copy); copy.textContent = "コピーしました"; }
    catch { copy.closest(".card").querySelector(".url").select(); }
    return;
  }
  const cb = e.target.closest("button[data-collab]");
  if (cb) {
    if (cb.dataset.confirm && !confirm(cb.dataset.confirm)) return;
    try {
      await postJson("/admin/collaborators", { action: cb.dataset.action, id: Number(cb.dataset.collab) });
      location.reload();
    } catch (err) { alert(err.message); }
    return;
  }
  const b = e.target.closest("button[data-action]");
  if (!b) return;
  if (b.dataset.confirm && !confirm("このボトルを取り下げますか？（画像も削除されます）")) return;
  const card = b.closest(".card");
  card.querySelectorAll("button").forEach((x) => (x.disabled = true));
  const res = await fetch("/admin/review", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-BottleMail-Admin": "1" },
    body: JSON.stringify({ id: Number(b.dataset.id), action: b.dataset.action }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert(body.error || "失敗しました");
    card.querySelectorAll("button").forEach((x) => (x.disabled = false));
    return;
  }
  card.classList.add("done");
  card.querySelector(".actions").textContent =
    { approve: "承認しました", reject: "却下しました", remove: "取り下げました" }[b.dataset.action];
});
</script>
</body>
</html>`;
}

function fmtDate(ms) {
  if (!ms) return "";
  const d = new Date(ms + 9 * 3600_000); // 日本時間
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
