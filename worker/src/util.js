// ボトル番号の表示（1 → "0001"）
export function formatId(n) {
  return String(n).padStart(4, "0");
}

export function expireDays(env) {
  return parseFloat(env.EXPIRE_DAYS || "7");
}

// 承認から EXPIRE_DAYS 日たったボトルを沈める（配信から外し、画像も消して置き場所を空ける）
export async function sinkExpired(env) {
  const cutoff = Date.now() - expireDays(env) * 86400_000;
  await env.DB.prepare(
    "UPDATE bottles SET status = 'sunk', slot = NULL, image = NULL WHERE status = 'approved' AND reviewed_at < ?1"
  ).bind(cutoff).run();
}
