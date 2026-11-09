# BottleMail Server

VRChat ワールド「ボトルメール」の投稿受付と配信の仕組み。

- `worker/` … Cloudflare Worker + D1。投稿ページ、確認画面（`/admin`）、GitHub Actions 向けの書き出し。
- `builder/` … 承認済みのボトルから `index.json` と画像アトラスを作るスクリプト。
- `.github/workflows/deploy.yml` … 30 分おきに承認済みのボトルを取りに行き、変化があれば GitHub Pages に公開する。

手紙そのものはこのリポジトリにはコミットしない。Actions がその場で作って Pages に直接公開するので、取り下げたボトルは履歴に残らない。

## 準備

```sh
cd worker
npm install
npx wrangler login
npx wrangler d1 create bottlemail          # 表示された database_id を wrangler.toml に書く
npm run db:init
npx wrangler secret put ADMIN_PASSWORD     # 確認画面のパスワード（ユーザー名は admin）
npx wrangler secret put EXPORT_TOKEN       # Actions 用の合言葉（長いランダム文字列）
npx wrangler secret put IP_SALT            # 連投制限用（長いランダム文字列）
npm run deploy
```

GitHub 側:

- Settings > Pages > Source を「GitHub Actions」にする。
- Settings > Secrets and variables > Actions
  - Variables: `BOTTLEMAIL_API` = Worker の URL
  - Secrets: `EXPORT_TOKEN` = Worker と同じ値

## 公開前にやること

- Turnstile（ボット対策）のサイトキーを `wrangler.toml` の `TURNSTILE_SITE_KEY` に、シークレットを `TURNSTILE_SECRET` に設定する。

## ローカルで試す

```sh
cd worker
printf 'ADMIN_PASSWORD=localpass\nEXPORT_TOKEN=localtoken\nIP_SALT=localsalt\n' > .dev.vars
npm run db:init:local
npx wrangler dev
```
