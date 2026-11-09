// ボトルメール：投稿の受け付けと確認（Cloudflare Worker + D1）
//
//   GET  /                     投稿ページ
//   POST /api/submit           投稿（multipart: text, image?, cf-turnstile-response?）
//   GET  /admin                確認画面（Basic 認証。ユーザー名 admin / パスワード ADMIN_PASSWORD）
//   GET  /admin/image/:id      投稿画像（管理者のみ）
//   POST /admin/review         承認・却下・取り下げ（JSON {id, action}）
//   GET  /admin/new            管理者の投稿ページ（連投制限なし、すぐ公開・沈まないを選べる）
//   POST /admin/submit         管理者の投稿（multipart: text, image?, publish?, pinned?）
//   GET  /api/export           承認済みの一覧（Bearer EXPORT_TOKEN。GitHub Actions 用）
//   GET  /api/export/image/:id 承認済みの画像（同上）

import { submitPage } from "./pages/submit.js";
import { adminPage } from "./pages/admin.js";
import { formatId, sinkExpired } from "./util.js";

const MAX_IMAGE_BYTES = 600 * 1024; // 投稿ページ側で縮めてから送るので、これを超えるのは異常
const RATE_PER_HOUR = 3;
const RATE_PER_DAY = 10;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (request.method === "GET" && path === "/") return html(submitPage(env));
      if (request.method === "GET" && path === "/robots.txt") return text("User-agent: *\nDisallow: /\n");
      if (request.method === "POST" && path === "/api/submit") return await handleSubmit(request, env);

      if (path === "/admin" || path.startsWith("/admin/")) {
        if (!checkAdmin(request, env)) {
          return new Response("認証が必要です", {
            status: 401,
            headers: { "WWW-Authenticate": 'Basic realm="bottlemail-admin", charset="UTF-8"' },
          });
        }
        if (request.method === "GET" && path === "/admin") return html(await adminPage(env));
        if (request.method === "GET" && path.startsWith("/admin/image/")) return await serveImage(env, path, false);
        if (request.method === "POST" && path === "/admin/review") return await handleReview(request, env);
        if (request.method === "GET" && path === "/admin/new") return html(submitPage(env, { admin: true }));
        if (request.method === "POST" && path === "/admin/submit") return await handleAdminSubmit(request, env);
      }

      if (path === "/api/export" || path.startsWith("/api/export/")) {
        if (!checkExportToken(request, env)) return json({ error: "unauthorized" }, 401);
        if (request.method === "GET" && path === "/api/export") return await handleExport(env);
        if (request.method === "GET" && path.startsWith("/api/export/image/")) return await serveImage(env, path, true);
      }

      return text("Not found", 404);
    } catch (e) {
      console.error(e);
      return json({ error: "server_error" }, 500);
    }
  },
};

// ───────── 投稿 ─────────

// 本文と画像を取り出して確かめる。問題があれば { error } を返す
async function readBottleForm(form, env) {
  const maxText = parseInt(env.MAX_TEXT || "140", 10);
  const body = normalizeText(String(form.get("text") || ""));
  const length = Array.from(body).length;
  if (length === 0) return { error: "手紙が空です。" };
  if (length > maxText) return { error: `手紙は ${maxText} 文字までです。` };

  let image = null;
  let imageType = null;
  const file = form.get("image");
  if (file && typeof file === "object" && file.size > 0) {
    if (!IMAGE_TYPES.includes(file.type)) return { error: "画像の形式に対応していません。" };
    if (file.size > MAX_IMAGE_BYTES) return { error: "画像が大きすぎます。" };
    image = await file.arrayBuffer();
    imageType = file.type;
  }
  return { body, image, imageType };
}

async function handleSubmit(request, env) {
  const form = await request.formData();
  const ip = request.headers.get("CF-Connecting-IP") || "";

  if (env.TURNSTILE_SECRET) {
    const ok = await verifyTurnstile(env.TURNSTILE_SECRET, form.get("cf-turnstile-response"), ip);
    if (!ok) return json({ error: "ボットではないことの確認に失敗しました。もう一度お試しください。" }, 400);
  }

  const parsed = await readBottleForm(form, env);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const { body, image, imageType } = parsed;

  const now = Date.now();
  const ipHash = await sha256Hex((env.IP_SALT || "") + ip);
  const counts = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN created_at > ?1 THEN 1 ELSE 0 END) AS hour,
       COUNT(*) AS day
     FROM bottles WHERE ip_hash = ?2 AND created_at > ?3`
  ).bind(now - 3600_000, ipHash, now - 86400_000).first();
  if ((counts?.hour || 0) >= RATE_PER_HOUR || (counts?.day || 0) >= RATE_PER_DAY) {
    return json({ error: "たくさん流してくれてありがとう。少し時間をおいてから、また流してください。" }, 429);
  }

  const result = await env.DB.prepare(
    "INSERT INTO bottles (text, image, image_type, status, ip_hash, created_at) VALUES (?1, ?2, ?3, 'pending', ?4, ?5)"
  ).bind(body, image, imageType, ipHash, now).run();

  return json({ ok: true, id: formatId(result.meta.last_row_id) });
}

function normalizeText(s) {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "") // 改行以外の制御文字
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function verifyTurnstile(secret, token, ip) {
  if (!token) return false;
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", String(token));
  if (ip) body.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const data = await res.json();
  return data.success === true;
}

// ───────── 管理者の投稿（連投制限・ボット対策なし） ─────────

async function handleAdminSubmit(request, env) {
  if (request.headers.get("X-BottleMail-Admin") !== "1") return json({ error: "forbidden" }, 403);
  const form = await request.formData();
  const parsed = await readBottleForm(form, env);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const { body, image, imageType } = parsed;

  const publish = form.get("publish") === "1";
  const pinned = form.get("pinned") === "1" ? 1 : 0;
  const now = Date.now();

  let slot = null;
  if (publish && image) {
    await sinkExpired(env);
    slot = await findFreeSlot(env);
    if (slot == null) return json({ error: "画像の置き場所がいっぱいです。古いボトルを取り下げてください。" }, 409);
  }

  const result = await env.DB.prepare(
    `INSERT INTO bottles (text, image, image_type, status, slot, pinned, created_at, reviewed_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
  ).bind(body, image, imageType, publish ? "approved" : "pending", slot, pinned, now, publish ? now : null).run();

  return json({ ok: true, id: formatId(result.meta.last_row_id) });
}

// ───────── 確認（管理者） ─────────

async function handleReview(request, env) {
  // 他サイトからのなりすまし送信（CSRF）を防ぐため、独自ヘッダーを必須にする
  if (request.headers.get("X-BottleMail-Admin") !== "1") return json({ error: "forbidden" }, 403);

  const { id, action } = await request.json();
  const row = await env.DB.prepare("SELECT id, status, image IS NOT NULL AS has_image, slot FROM bottles WHERE id = ?1")
    .bind(id).first();
  if (!row) return json({ error: "not_found" }, 404);
  const now = Date.now();

  if (action === "approve") {
    await sinkExpired(env); // 沈んだボトルの画像の置き場所を先に空ける
    let slot = row.slot;
    if (row.has_image && slot == null) {
      slot = await findFreeSlot(env);
      if (slot == null) return json({ error: "画像の置き場所がいっぱいです。古いボトルを取り下げてください。" }, 409);
    }
    await env.DB.prepare("UPDATE bottles SET status = 'approved', slot = ?2, reviewed_at = ?3 WHERE id = ?1")
      .bind(id, slot, now).run();
  } else if (action === "reject" || action === "remove") {
    const status = action === "reject" ? "rejected" : "removed";
    // 却下・取り下げたものは画像も消す（手元にも残さない）
    await env.DB.prepare("UPDATE bottles SET status = ?2, slot = NULL, image = NULL, reviewed_at = ?3 WHERE id = ?1")
      .bind(id, status, now).run();
  } else {
    return json({ error: "bad_action" }, 400);
  }
  return json({ ok: true });
}

async function findFreeSlot(env) {
  const max = parseInt(env.MAX_SLOTS || "256", 10);
  const { results } = await env.DB.prepare("SELECT slot FROM bottles WHERE slot IS NOT NULL ORDER BY slot").all();
  let expected = 0;
  for (const r of results) {
    if (r.slot !== expected) break;
    expected++;
  }
  return expected < max ? expected : null;
}

// ───────── 書き出し（GitHub Actions 用） ─────────

async function handleExport(env) {
  await sinkExpired(env);
  const { results } = await env.DB.prepare(
    "SELECT id, text, slot, reviewed_at FROM bottles WHERE status = 'approved' ORDER BY id"
  ).all();
  return json({
    bottles: results.map((r) => ({ id: formatId(r.id), dbId: r.id, text: r.text, slot: r.slot })),
  });
}

async function serveImage(env, path, approvedOnly) {
  const id = parseInt(path.split("/").pop(), 10);
  const sql = approvedOnly
    ? "SELECT image, image_type FROM bottles WHERE id = ?1 AND status = 'approved'"
    : "SELECT image, image_type FROM bottles WHERE id = ?1";
  const row = await env.DB.prepare(sql).bind(id).first();
  if (!row || !row.image) return text("Not found", 404);
  return new Response(new Uint8Array(row.image), {
    headers: { "Content-Type": row.image_type || "application/octet-stream", "Cache-Control": "private, no-store" },
  });
}

// ───────── 補助 ─────────

function checkAdmin(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Basic ")) return false;
  let decoded = "";
  try {
    decoded = new TextDecoder().decode(Uint8Array.from(atob(header.slice(6)), (c) => c.charCodeAt(0)));
  } catch {
    return false;
  }
  return timingSafeEqual(decoded, "admin:" + env.ADMIN_PASSWORD);
}

function checkExportToken(request, env) {
  if (!env.EXPORT_TOKEN) return false;
  const header = request.headers.get("Authorization") || "";
  return timingSafeEqual(header, "Bearer " + env.EXPORT_TOKEN);
}

function timingSafeEqual(a, b) {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] || 0) ^ (eb[i] || 0);
  return diff === 0;
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function html(body) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
    },
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function text(s, status = 200) {
  return new Response(s, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
