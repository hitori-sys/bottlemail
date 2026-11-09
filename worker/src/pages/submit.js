// 投稿ページ（スマホ前提の1枚もの）
// admin: true のときは管理者用（連投制限・ボット対策なし、すぐ公開・沈まないを選べる、続けて書ける）
export function submitPage(env, { admin = false } = {}) {
  const maxText = parseInt(env.MAX_TEXT || "140", 10);
  const siteKey = admin ? "" : env.TURNSTILE_SITE_KEY || "";
  const title = admin ? "管理者としてボトルを流す" : "ボトルメールを流す";
  const lead = admin
    ? '連投制限なしで流せます。<a href="/admin">確認画面に戻る</a>'
    : "あなたの手紙を、どこかの浜辺に届けます。<br>VRChat のどこかのインスタンスで、知らない誰かが拾うかもしれません。";
  const notice = admin
    ? `<div class="note">
        <label class="agree"><input type="checkbox" id="publish" checked> すぐ公開する（外すと確認待ちに入る）</label>
        <label class="agree"><input type="checkbox" id="pinned"> 沈まない（期限で配信から外れない）</label>
      </div>`
    : `<div class="note">
        流す前に読んでください
        <ul>
          <li>手紙は確認してから流します。届くまで時間がかかったり、届かないこともあります。</li>
          <li>流した手紙は<strong>公開されます</strong>（誰でも読める状態になります）。</li>
          <li>名前・連絡先・住所など、あなたや他の人が分かることは書かないでください。</li>
          <li>画像の位置情報などは、送る前にこの画面で消しています。</li>
        </ul>
      </div>

      <label class="agree"><input type="checkbox" id="agree"> 上のことを読んで、公開されることに同意します</label>`;
  const turnstileScript = siteKey
    ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'
    : "";
  const turnstileWidget = siteKey ? `<div class="cf-turnstile" data-sitekey="${escapeAttr(siteKey)}"></div>` : "";

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
${turnstileScript}
<style>
  :root {
    --sea: #1f6b8c; --sea-deep: #134a63; --sand: #f3ead6; --paper: #fbf6ea;
    --ink: #3f2e1f; --muted: #7a6a58; --accent: #2f8fb3; --danger: #b3422f;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; color: var(--ink);
    font-family: "Hiragino Maru Gothic ProN", "Yu Gothic", "Noto Sans JP", sans-serif;
    background: linear-gradient(180deg, #8fc9e0 0%, var(--sea) 45%, var(--sea-deep) 100%);
  }
  main { max-width: 560px; margin: 0 auto; padding: 32px 16px 48px; }
  h1 { color: #fff; font-size: 1.5rem; margin: 0 0 4px; letter-spacing: .05em; }
  .lead { color: #e6f4fa; margin: 0 0 20px; line-height: 1.7; font-size: .95rem; }
  .card { background: var(--paper); border-radius: 14px; padding: 20px; box-shadow: 0 8px 24px rgba(0,0,0,.18); }
  label { display: block; font-weight: bold; margin: 0 0 8px; }
  textarea {
    width: 100%; min-height: 180px; padding: 12px; font-size: 1rem; line-height: 1.8;
    border: 1px solid #d8cdb5; border-radius: 8px; background: #fffdf7; color: var(--ink); resize: vertical;
    font-family: inherit;
  }
  .counter { text-align: right; font-size: .85rem; color: var(--muted); margin-top: 4px; }
  .counter.over { color: var(--danger); font-weight: bold; }
  .field { margin-bottom: 20px; }
  .preview { margin-top: 10px; display: none; }
  .preview img { max-width: 100%; max-height: 240px; border-radius: 8px; display: block; }
  .preview button { margin-top: 6px; background: none; border: none; color: var(--accent); padding: 0; font-size: .9rem; cursor: pointer; }
  .note { font-size: .85rem; color: var(--muted); line-height: 1.7; background: var(--sand); border-radius: 8px; padding: 12px; margin-bottom: 16px; }
  .note ul { margin: 6px 0 0; padding-left: 1.2em; }
  .agree { display: flex; gap: 8px; align-items: flex-start; font-weight: normal; font-size: .9rem; margin-bottom: 16px; }
  .agree input { margin-top: 4px; }
  button.send {
    width: 100%; padding: 14px; font-size: 1.05rem; font-weight: bold; color: #fff; border: none;
    border-radius: 10px; background: var(--accent); cursor: pointer; font-family: inherit;
  }
  button.send:disabled { background: #9bb8c4; cursor: default; }
  .message { margin-top: 14px; line-height: 1.7; }
  .message.error { color: var(--danger); }
  .done { text-align: center; padding: 24px 8px; line-height: 1.9; }
  .done strong { font-size: 1.2rem; }
  .cf-turnstile { margin-bottom: 16px; }
</style>
</head>
<body>
<main>
  <h1>${title}</h1>
  <p class="lead">${lead}</p>

  <div class="card" id="formCard">
    <form id="form">
      <div class="field">
        <label for="text">手紙</label>
        <textarea id="text" name="text" maxlength="${maxText * 2}" placeholder="拾ってくれた誰かへ…"></textarea>
        <div class="counter" id="counter">0 / ${maxText}</div>
      </div>

      <div class="field">
        <label for="image">画像（なくても大丈夫）</label>
        <input id="image" type="file" accept="image/*">
        <div class="preview" id="preview">
          <img id="previewImg" alt="">
          <button type="button" id="clearImage">画像をはずす</button>
        </div>
      </div>

      ${notice}
      ${turnstileWidget}
      <button class="send" id="send" type="submit" disabled>海に流す</button>
      <div class="message" id="message"></div>
    </form>
  </div>
</main>

<script>
const ADMIN = ${admin ? "true" : "false"};
const MAX = ${maxText};
const MAX_SIDE = 1024;
const MAX_BYTES = 550 * 1024;
const form = document.getElementById("form");
const textEl = document.getElementById("text");
const counter = document.getElementById("counter");
const agree = document.getElementById("agree");
const send = document.getElementById("send");
const message = document.getElementById("message");
const fileEl = document.getElementById("image");
const preview = document.getElementById("preview");
const previewImg = document.getElementById("previewImg");
let imageBlob = null;

function length(s) { return Array.from(s.trim()).length; }
function update() {
  const n = length(textEl.value);
  counter.textContent = n + " / " + MAX;
  counter.classList.toggle("over", n > MAX);
  send.disabled = !((ADMIN || agree.checked) && n > 0 && n <= MAX);
}
textEl.addEventListener("input", update);
if (agree) agree.addEventListener("change", update);

fileEl.addEventListener("change", async () => {
  message.textContent = "";
  message.className = "message";
  const file = fileEl.files[0];
  if (!file) return;
  try {
    imageBlob = await shrink(file);
    previewImg.src = URL.createObjectURL(imageBlob);
    preview.style.display = "block";
  } catch (e) {
    imageBlob = null;
    fileEl.value = "";
    preview.style.display = "none";
    showError("この画像は読み込めませんでした。別の画像を選んでください。");
  }
});
document.getElementById("clearImage").addEventListener("click", () => {
  imageBlob = null;
  fileEl.value = "";
  preview.style.display = "none";
});

// 画像を縮めて JPEG にし直す（位置情報などのメタデータもここで消える）
async function shrink(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  for (let q = 0.85; q >= 0.4; q -= 0.15) {
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", q));
    if (blob && blob.size <= MAX_BYTES) return blob;
  }
  throw new Error("too large");
}

function showError(s) { message.textContent = s; message.className = "message error"; }

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  send.disabled = true;
  message.textContent = "流しています…";
  message.className = "message";
  const data = new FormData();
  data.append("text", textEl.value);
  if (imageBlob) data.append("image", imageBlob, "image.jpg");
  const ts = form.querySelector('[name="cf-turnstile-response"]');
  if (ts) data.append("cf-turnstile-response", ts.value);
  if (ADMIN) {
    data.append("publish", document.getElementById("publish").checked ? "1" : "0");
    data.append("pinned", document.getElementById("pinned").checked ? "1" : "0");
  }
  try {
    const res = ADMIN
      ? await fetch("/admin/submit", { method: "POST", body: data, headers: { "X-BottleMail-Admin": "1" } })
      : await fetch("/api/submit", { method: "POST", body: data });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "送れませんでした。");
    if (ADMIN) {
      // 続けて書けるように、フォームは残して中身だけ空にする
      textEl.value = "";
      imageBlob = null;
      fileEl.value = "";
      preview.style.display = "none";
      message.textContent = "No." + body.id + " を流しました。続けて書けます。";
      message.className = "message";
      update();
      return;
    }
    document.getElementById("formCard").innerHTML =
      '<div class="done"><strong>ボトルを海に流しました</strong><br>確認が済むと、どこかの浜辺に流れ着きます。<br>ボトル番号：No.' + body.id +
      '<br><br><a href="/">もう1通流す</a></div>';
  } catch (err) {
    showError(err.message);
    if (window.turnstile) window.turnstile.reset();
    update();
  }
});
update();
</script>
</body>
</html>`;
}

function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
