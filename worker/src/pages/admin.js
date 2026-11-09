// 確認画面（スマホで1件ずつタップして承認・却下する）
import { formatId, expireDays, sinkExpired } from "../util.js";

export async function adminPage(env) {
  await sinkExpired(env);
  const days = expireDays(env);
  const pending = await env.DB.prepare(
    "SELECT id, text, image IS NOT NULL AS has_image, created_at FROM bottles WHERE status = 'pending' ORDER BY id LIMIT 50"
  ).all();
  const approved = await env.DB.prepare(
    "SELECT id, text, image IS NOT NULL AS has_image, slot, reviewed_at FROM bottles WHERE status = 'approved' ORDER BY reviewed_at DESC LIMIT 100"
  ).all();
  const counts = await env.DB.prepare("SELECT status, COUNT(*) AS n FROM bottles GROUP BY status").all();
  const count = Object.fromEntries(counts.results.map((r) => [r.status, r.n]));

  const card = (r, buttons) => `
    <article class="card" id="b${r.id}">
      <div class="meta">No.${formatId(r.id)}${r.slot != null ? ` ・ 画像枠 ${r.slot}` : ""} ・ ${fmtDate(r.created_at || r.reviewed_at)}${r.reviewed_at ? ` ・ ${remaining(r.reviewed_at, days)}` : ""}</div>
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
</style>
</head>
<body>
<main>
  <h1>ボトルメール確認</h1>
  <div class="summary">確認待ち ${count.pending || 0} ・ 公開中 ${count.approved || 0} ・ 却下 ${count.rejected || 0} ・ 取り下げ ${count.removed || 0} ・ 沈んだ ${count.sunk || 0}</div>
  <p class="summary">承認したボトルは、次の配信（最長30分後）でワールドに届くようになり、承認から ${days} 日で海の底に沈みます（配信から外れ、画像も削除されます）。</p>

  <h2>確認待ち</h2>
  ${pendingHtml}

  <h2>公開中（新しい順）</h2>
  ${approvedHtml}
</main>
<script>
document.addEventListener("click", async (e) => {
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

function remaining(reviewedAt, days) {
  const left = reviewedAt + days * 86400_000 - Date.now();
  if (left <= 0) return "まもなく沈む";
  const h = Math.floor(left / 3600_000);
  return h >= 24 ? `あと ${Math.floor(h / 24)} 日で沈む` : `あと ${h} 時間で沈む`;
}

function fmtDate(ms) {
  if (!ms) return "";
  const d = new Date(ms + 9 * 3600_000); // 日本時間
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
