// ボトル番号の表示（1 → "0001"）
export function formatId(n) {
  return String(n).padStart(4, "0");
}
