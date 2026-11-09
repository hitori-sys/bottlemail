"""承認済みのボトルを Worker から取ってきて、GitHub Pages に置くファイルを作る。

出力（_site/）:
  index.json      ワールドが読む手紙の一覧
  atlas_XX.jpg    画像をまとめたもの（2048x2048、512px のマスが 4x4）
  robots.txt      検索エンジンに収集させない
  .nojekyll

環境変数:
  BOTTLEMAIL_API   Worker の URL（例 https://bottlemail.xxx.workers.dev）
  EXPORT_TOKEN     Worker の EXPORT_TOKEN と同じ値
  PAGES_URL        今公開中のサイトの URL（中身が変わっていなければ公開を省くため。任意）
  GITHUB_OUTPUT    Actions が渡す。changed=true/false を書き出す
"""

import hashlib
import io
import json
import os
import sys
import urllib.error
import urllib.request

from PIL import Image, ImageOps

GRID = 4                 # 1 枚のアトラスに 4x4 マス
CELL = 512               # 1 マスの大きさ
SLOTS_PER_ATLAS = GRID * GRID
BACKGROUND = (224, 214, 189)  # 手紙の写真枠と同じ色（余白に使う）
OUT_DIR = "_site"


def fetch(url, token=None):
    req = urllib.request.Request(url, headers={"User-Agent": "bottlemail-builder"})
    if token:
        req.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(req, timeout=60) as res:
        return res.read()


def fit_into_cell(data):
    """画像を 512x512 のマスに収める（縦横比は保ち、余白は背景色）。メタデータは捨てる。"""
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img).convert("RGB")
    img.thumbnail((CELL, CELL), Image.LANCZOS)
    cell = Image.new("RGB", (CELL, CELL), BACKGROUND)
    cell.paste(img, ((CELL - img.width) // 2, (CELL - img.height) // 2))
    return cell


def main():
    api = os.environ["BOTTLEMAIL_API"].rstrip("/")
    token = os.environ["EXPORT_TOKEN"]
    pages_url = os.environ.get("PAGES_URL", "").rstrip("/")

    export = json.loads(fetch(api + "/api/export", token))
    bottles = export["bottles"]

    atlases = {}  # atlas 番号 -> Image
    entries = []
    digest = hashlib.sha256()

    for b in bottles:
        entry = {"id": b["id"], "text": b["text"]}
        digest.update(json.dumps(entry, ensure_ascii=False, sort_keys=True).encode("utf-8"))

        slot = b.get("slot")
        if slot is not None:
            try:
                data = fetch(f"{api}/api/export/image/{b['dbId']}", token)
                cell = fit_into_cell(data)
            except Exception as e:  # 画像が壊れていても文字だけで流す
                print(f"warning: image of {b['id']} skipped: {e}", file=sys.stderr)
                cell = None
            if cell is not None:
                atlas_index, cell_index = divmod(slot, SLOTS_PER_ATLAS)
                atlas = atlases.get(atlas_index)
                if atlas is None:
                    atlas = Image.new("RGB", (CELL * GRID, CELL * GRID), BACKGROUND)
                    atlases[atlas_index] = atlas
                row, col = divmod(cell_index, GRID)
                atlas.paste(cell, (col * CELL, row * CELL))
                entry["atlas"] = atlas_index
                entry["cell"] = cell_index
                digest.update(f"{slot}:".encode() + hashlib.sha256(data).digest())

        entries.append(entry)

    rev = digest.hexdigest()[:16]
    changed = True
    if pages_url:
        try:
            live = json.loads(fetch(pages_url + "/index.json"))
            changed = live.get("rev") != rev
        except (urllib.error.URLError, ValueError) as e:
            print(f"live index not available ({e}); deploying", file=sys.stderr)

    os.makedirs(OUT_DIR, exist_ok=True)
    index = {"version": 1, "rev": rev, "grid": GRID, "bottles": entries}
    with open(os.path.join(OUT_DIR, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, separators=(",", ":"))
    for i, atlas in atlases.items():
        atlas.save(os.path.join(OUT_DIR, f"atlas_{i:02d}.jpg"), "JPEG", quality=82, optimize=True, progressive=False)
    with open(os.path.join(OUT_DIR, "robots.txt"), "w") as f:
        f.write("User-agent: *\nDisallow: /\n")
    open(os.path.join(OUT_DIR, ".nojekyll"), "w").close()

    print(f"bottles={len(entries)} atlases={len(atlases)} rev={rev} changed={changed}")
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f:
            f.write(f"changed={'true' if changed else 'false'}\n")


if __name__ == "__main__":
    main()
