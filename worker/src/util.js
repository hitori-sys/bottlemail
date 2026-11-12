// ボトル番号の表示（1 → "0001"）
export function formatId(n) {
  return String(n).padStart(4, "0");
}

/// 海に浮かべておく手紙の上限（「沈まない」手紙は数えない）
export function maxAfloat(env) {
  return parseInt(env.MAX_AFLOAT || "100", 10);
}

// 公開中の手紙が上限を超えたら、承認した順に古いものから沈める（配信から外し、画像も消して置き場所を空ける）
export async function sinkExpired(env) {
  await env.DB.prepare(
    `UPDATE bottles SET status = 'sunk', slot = NULL, image = NULL
     WHERE status = 'approved' AND pinned = 0 AND id NOT IN (
       SELECT id FROM bottles WHERE status = 'approved' AND pinned = 0
       ORDER BY reviewed_at DESC, id DESC LIMIT ?1
     )`
  ).bind(maxAfloat(env)).run();
}
