# traQ Flow

traQの短時間の連投をまとめる、非公式のユーザースクリプト / Chrome拡張です。

- **自分の連投**: 同じチャンネルの最新メッセージが自分の投稿なら、その投稿に改行して追記します。サーバー上の編集なので、他の人にも反映されます。
- **表示をまとめる**: 同じ人の連続した発言の名前・アイコンを畳みます。本文、添付、スタンプ、個別メッセージの操作を残し、他人の投稿データは変更しません。自分の未結合の発言にも適用します。
- **時間の設定**: 初期値60秒。1〜600秒を指定できます。自動追記と表示の結合は別々に無効化できます。

## インストール（おすすめ）

1. [Tampermonkey](https://www.tampermonkey.net/) をブラウザにインストールします。
2. [**traQ Flowをインストール**](https://raw.githubusercontent.com/blueberry1001/traq-flow/main/dist/traq-flow.user.js) を開き、ユーザースクリプト管理画面で「インストール」を押します。
3. [traQ](https://q.trap.jp/) を再読み込みします。右上の **Flow** ボタンから設定できます。

Chromeでスクリプトが動かない場合は、Tampermonkeyの案内に従って「ユーザースクリプトを許可」を有効にしてください。本文がそのまま表示される場合は、管理拡張が有効か確認してください。

対応対象は `https://q.trap.jp/` のブラウザ版です。PC上のChrome 116以降を前提に検証しています。ユーザースクリプトとChrome拡張はどちらか一方だけ導入してください。traQのネイティブアプリやService Workerからの通知返信は対象外です。

## Chrome拡張として使う

[Releases](https://github.com/blueberry1001/traq-flow/releases) の `traq-flow-chrome.zip` を展開し、`chrome://extensions` でデベロッパーモードを有効にして「パッケージ化されていない拡張機能を読み込む」から展開先を選んでください。ビルドは不要です。

Chrome Web Storeでの公開・審査完了を意味するものではありません。ストア公開手順は [公開ガイド](docs/PUBLISHING.md) にあります。

## 動作の詳細

`はじめ` → 30秒後に `つづき` と送ると、元のメッセージが次の内容になります。

```text
はじめ
つづき
```

- 間に別の人の投稿がある、閾値を超えた、ピン留めされた投稿である、結合後に10,000文字を超える場合は、新規投稿します。
- 最初の判定は投稿の作成日時を使います。このタブで成功した追記は、最後の追記時刻からの間隔で判定します。再読み込み・別タブでは作成日時に戻ります。
- 「次の1回は新規投稿」で、次の送信だけ追記を避けられます。
- 通常の入力欄からのMarkdown、メンション、添付URLをそのまま追記します。Markdownとしては一つの本文になるため、開いたコードフェンスなどの影響は後続テキストにも及びます。
- 元の投稿時刻は変わりません。新着投稿としての通知・未読・並び順は通常投稿と異なります。
- 編集失敗時は、自動で新規投稿し直しません。標準入力欄に文章が残ります。通信断では編集だけ成功している可能性もあるため、再送前に履歴を確認してください。
- 最新情報の読み取りに失敗した場合は、元の新規投稿をそのまま行います。
- 表示結合はチャンネル/DMのメッセージ一覧を対象にします。日付・未読区切り、ピン留め、編集中、リンク先として強調された投稿は越えて結合しません。ホバーで時刻・名前が再表示されます。
- traQ APIに条件付き編集（If-Match）の仕組みがないため、別端末や拡張なしのタブとの同時編集を完全には防げません。同一ブラウザ・同一オリジンで本拡張を使うタブはWeb Locksで送信を直列化し、編集直前にも読み直します。
- 表示結合はVueの描画ツリーとCSSクラスに依存します。traQの将来のUI変更で使えなくなる可能性があります。対応できない構造では表示結合を行いません。

## プライバシー / 権限

追加のAPIトークンは不要です。ログイン中のtraQセッションを使い、同じtraQサーバーだけにアクセスします。外部送信・解析・広告・遠隔コード読み込みはありません。保存するのはブラウザのlocalStorage内の設定のみで、メッセージ本文は永続保存しません。詳しくは [プライバシーポリシー](docs/PRIVACY.md) を参照してください。

自前のtraQに導入する場合は、`scripts/build.mjs` の `@match` と `matches` を自分のサーバーに変更してビルドしてください。バックエンドとUIが同じオリジンで `/api/v3` を使う構成を対象とします。

## 開発

Node.js 20以降。ビルド・単体テストに追加パッケージは不要です。

```sh
npm test
npm run build
```

- `src/core.js`: 結合条件、時間・文字数・設定検証
- `src/runtime.js`: XHR/fetchフック、Vue表示アダプター、設定画面
- `dist/traq-flow.user.js`: Greasy Fork投稿用の完成ファイル
- `dist/chrome/`: Manifest V3拡張

GitHub Actionsでテストと配布ファイルの再現性を確認します。実traQへの投稿を伴う試験は実施していません。Vue本番モード + Axios + テスト用APIによるブラウザ検証内容は [検証メモ](docs/VERIFICATION.md) に記載しています。

## 調査した公式実装

- [traQ バックエンド](https://github.com/traPtitech/traQ)、[OpenAPI仕様](https://github.com/traPtitech/traQ/blob/7bfa7ba6c71f977c8f9117d0ddbb95a2151f08b8/docs/v3-api.yaml)
- [traQ_S-UI](https://github.com/traPtitech/traQ_S-UI)、[投稿処理](https://github.com/traPtitech/traQ_S-UI/blob/a61b636305a25e3735aeccc934c32dc2fea350a4/src/components/Main/MainView/MessageInput/composables/usePostMessage.ts)

公式traQプロジェクトとは無関係の拡張です。MIT License。
