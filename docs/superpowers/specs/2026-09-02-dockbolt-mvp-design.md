# DockBolt MVP 詳細設計

**Date:** 2026-09-02  
**Status:** Approved  
**Requirements:** `docs/dockbolt_requirements.md`（MVP v0.1）  
**Approach:** ドメインを Rust `dockbolt-core` に置き、Tauri は IPC、React は表示に限定する

## 1. 目的

DockBolt v0.1 は、ローカル Docker Engine 上の Containers / Images / Volumes の確認と削除、および Container Logs の高速な閲覧・フィルタに特化したデスクトップ GUI である。

完成条件は要件定義書セクション 12 に従う。本ドキュメントはその実装境界、モジュール分割、データフロー、エラー、テストを固定する。

## 2. 決定済みのプロダクト方針

| 項目 | 決定 |
|---|---|
| OS | macOS と Linux。Windows は対象外 |
| 接続 | ローカル Unix ソケットのみ。Remote / TLS / named pipe は対象外 |
| 検出 | Docker Desktop / OrbStack / Colima default / `/var/run/docker.sock` を自動検出 |
| 複数 Engine | ステータスバーから切替。選択した `engine_id` を永続化する。初回は優先順位で接続 |
| 起動中コンテナ削除 | 確認ダイアログで警告したあと `force=true` |
| Image / Volume 削除 | `force=false`。使用中なら失敗を表示する |
| Logs | 直近 1000 行を読んでから follow |
| 一覧更新 | Docker Events 購読 + 手動 Refresh。ポーリングしない |
| 複数選択削除 | しない。1 行ずつ |
| UI 文言 | 英語。仕様書は日本語 |
| i18n / スプラッシュ / ファイルログ / テレメトリ | MVP 対象外 |

要件定義の MVP 対象外（Compose、Networks、K8s、Start/Stop/Restart、Exec、Stats、Pull/Build、正規表現フィルタ等）は本設計でも実装しない。

## 3. アーキテクチャ

プロセスは 1 つ。Tauri 2 が WebView（React + TypeScript）と Rust を同居させる。Docker Engine API には Rust だけが Unix ソケットで接続する。`docker` CLI の spawn と stdout パースはしない。

```text
src/                          React UI, Zustand, TanStack Virtual
        invoke / listen
src-tauri/                    Tauri commands, event emit, window
        function calls
crates/dockbolt-core/         detection, DockerPort, list/delete, logs, events
        Bollard
Docker Engine API
```

### 3.1 クレート境界

| パス | 責務 | 依存してよいもの |
|---|---|---|
| `crates/dockbolt-core` | ドメインと Docker 通信。UI を知らない | Bollard, Tokio, serde, thiserror, tracing |
| `src-tauri` | コマンド登録、core のストリームを Tauri イベント化、設定ファイル I/O | dockbolt-core, Tauri 2 |
| `src` | 画面、ルーティング、仮想リスト、確認ダイアログ | React, Zustand, TanStack Virtual, Tauri JS API |

core を今公開 CLI にしない。将来 CLI を足す余地だけ残す（公開 API を小さく、副作用を trait の向こうに置く）。

### 3.2 core モジュール

| モジュール | 責務 |
|---|---|
| `engine` | ソケット候補の列挙、優先順位、ping、`EngineId` |
| `client` | `DockerPort` trait と Bollard 実装 |
| `containers` | 一覧 DTO、削除（running 時のみ force） |
| `images` | 一覧 DTO、削除（force なし） |
| `volumes` | 一覧 DTO、削除（force なし） |
| `logs` | tail 1000、follow、行分割、バッチ、背圧 |
| `events` | Docker Events 購読、切断時再接続、どの一覧を invalidate するか |
| `error` | セクション 8 のエラー型 |

### 3.3 IPC の切り方

- 一覧取得、削除、Engine 一覧、Engine 切替、ログ購読開始/停止、手動 Refresh トリガ → `invoke`
- ログバッチ、接続状態変化、リソース invalidate → `emit`
- ログは 1 行 1 イベントにしない。core でバッチしてから UI へ送る

コマンドとイベント名は次で固定する（フロントと Tauri で同じ文字列）。

**Commands**

| 名前 | 入力 | 出力 |
|---|---|---|
| `list_engines` | なし | `EngineCandidate[]` |
| `connect_engine` | `{ engine_id: string }` | `ConnectionView` |
| `connection_status` | なし | `ConnectionView` |
| `list_containers` | なし | `ContainerRow[]` |
| `list_images` | なし | `ImageRow[]` |
| `list_volumes` | なし | `VolumeRow[]` |
| `delete_container` | `{ id: string }` | `{ ok: true }` or error |
| `delete_image` | `{ id: string }` | `{ ok: true }` or error |
| `delete_volume` | `{ name: string }` | `{ ok: true }` or error |
| `refresh` | `{ resource: "containers" \| "images" \| "volumes" \| "all" }` | 対応する行配列 |
| `start_logs` | `{ container_id: string }` | `{ session_id: string }` |
| `stop_logs` | `{ session_id: string }` | `{ ok: true }` |

**Events**

| 名前 | ペイロード |
|---|---|
| `connection://changed` | `ConnectionView` |
| `resources://invalidate` | `{ resource: "containers" \| "images" \| "volumes" }` |
| `logs://batch` | `{ session_id, lines: LogLine[], omitted: number }` |
| `logs://ended` | `{ session_id, reason: "stopped" \| "container_gone" \| "disconnected" \| "error" }` |

`resources://invalidate` を受けたら UI は該当 `list_*` を invoke する。core はイベントのたびに巨大な一覧を event に載せない。

## 4. 接続検出と Engine 切替

### 4.1 候補

存在するパスだけを候補にする。Colima は `default` プロファイルのみ見る。他プロファイルやカスタム `DOCKER_HOST` は MVP 対象外。

| 優先度 | `engine_id` | 表示名 | ソケットパス |
|---|---|---|---|
| 1 | `orbstack` | OrbStack | `{home}/.orbstack/run/docker.sock` |
| 2 | `docker-desktop` | Docker Desktop | `{home}/.docker/run/docker.sock` |
| 3 | `colima-default` | Colima | `{home}/.colima/default/docker.sock` |
| 4 | `unix-default` | Docker Engine | `/var/run/docker.sock` |

`{home}` は実行ユーザのホームディレクトリ。パスがファイルとして存在し、短い ping に成功したものだけ `available: true`。

ping は Engine バージョン取得（Bollard `version()`）。タイムアウトは 100ms。失敗した候補は一覧には出すが `available: false` と理由を付ける。接続対象にはしない。

### 4.2 起動時の選択

1. 設定ファイルの `selected_engine_id` があり、その候補が `available` ならそれを使う
2. なければ優先順位が最も高い `available` な候補
3. `available` が 0 件なら `Disconnected { reason: SocketNotFound または PermissionDenied }`

設定ファイルは OS の app config ディレクトリ（Tauri `app_config_dir`）の `engine.json`:

```json
{ "selected_engine_id": "orbstack" }
```

フォーマット不正や欠落は「未選択」と同じ。

### 4.3 切替

ステータスバーの Engine メニューから選ぶ。`connect_engine` は次を同期的に行う。

1. 進行中の `start_logs` セッションを cancel
2. Events 購読を止める
3. 新しいソケットでクライアントを作り ping
4. `selected_engine_id` を保存
5. `connection://changed` を emit
6. 3 一覧を空にしたうえで再取得する（別 Engine の行が残らない）

### 4.4 接続ビュー

```text
ConnectionView =
  | { status: "connecting" }
  | { status: "connected", engine_id, name, endpoint, api_version }
  | { status: "disconnected", reason, message }
```

ステータスバーは常にこの 3 態のどれかを表示する。未接続時は一覧の代わりに `message` と Retry（`list_engines` + 再接続）を出す。サイドバー遷移は許可するがデータは空配列。

Linux で PermissionDenied の `message` は「This user cannot access the Docker socket. Add the user to the docker group or run with sufficient permissions.」とする。chmod ウィザードは作らない。

## 5. ドメインモデル（DTO）

serde で JSON 化して IPC する。ID は Docker のフル ID を持ち、表示は先頭 12 文字。

```text
ContainerRow {
  id: string,
  name: string,          // 先頭の Names。スラッシュ除去。無名なら id 短縮
  image: string,
  state: string,         // Docker の state（running, exited, ...）
  running: bool,         // state == running
  created_unix: i64
}

ImageRow {
  id: string,            // sha256 付き可
  tags: string[],        // 空なら UI は <none>
  size_bytes: u64,
  created_unix: i64
}

VolumeRow {
  name: string,
  driver: string
}

EngineCandidate {
  engine_id: string,
  name: string,
  endpoint: string,      // unix:// パス
  available: bool,
  unavailable_reason?: string
}

LogLine {
  seq: u64,              // セッション内単調増加
  stream: "stdout" | "stderr",
  timestamp_unix_ms?: i64,
  raw: string            // メッセージ本体。タイムスタンププレフィックスは除く
}
```

Containers のデフォルトソート: `running` が先、同値なら `name` 昇順。Images / Volumes は `name`/`tags[0]` 昇順。

## 6. 一覧・削除・Events

### 6.1 画面と列

サイドバー: Containers / Images / Volumes。各画面に Refresh と、選択行があるときの Delete。

- Containers: Name, Image, State, ID(12), Created
- Images: Tags, ID(12), Size（人間可読）, Created
- Volumes: Name, Driver。Mountpoint はツールチップのみ（列には出さない）

空状態コピー:

- Containers: `No containers`
- Images: `No images`
- Volumes: `No volumes`

### 6.2 削除

確認モーダルは必須。Copy は英語。

| 対象 | タイトル | 本文 | API |
|---|---|---|---|
| 停止中コンテナ | Delete container | `Delete {name}? This cannot be undone.` | `remove(id, force=false)` |
| 起動中コンテナ | Delete running container | `{name} is running. Force delete this container?` | `remove(id, force=true)` |
| Image | Delete image | `Delete {tag or id}?` | `remove(id, force=false, noprune=false)` |
| Volume | Delete volume | `Delete volume {name}?` | `remove(name, force=false)` |

成功したら待たずに該当行をストアから除く。失敗したら行は残し、エラーダイアログを出す。削除中そのボタンは disable。他の一覧操作とログストリームは止めない。

Image / Volume の InUse では Docker に force を付け直さない。

### 6.3 Events

接続中は Events ストリームを 1 本。フィルタ type: `container`, `image`, `volume`。

| Docker の type | invalidate |
|---|---|
| container | `containers` |
| image | `images` |
| volume | `volumes` |

action の細かい分岐はしない（create/destroy/die いずれもその一覧を再取得）。core は `resources://invalidate` をデバウンスする（同一 resource は 100ms 以内にまとめて 1 回）。

ストリーム切断時は指数バックオフ（200ms, 400ms, 800ms, … 上限 5s）で再接続。成功したら `refresh(all)` 相当で 3 一覧を取り直す。

手動 Refresh は表示中リソース、または明示的に `all`。

ポーリングタイマーは持たない。

### 6.4 件数

list API はページングしない。UI は TanStack Virtual。ローカル Docker で数万行になってもスクロール性能は仮想化で担保する。

## 7. Logs

同時セッションは 1 本。`start_logs` 時に既存があれば先に止める。Logs 画面を離れる、Engine を切る、`stop_logs` で cancel。

### 7.1 取得

1 本の `logs` ストリームで `stdout=true, stderr=true, follow=true, tail=1000, timestamps=true` を指定する。履歴と follow を分けて 2 回叩かない（隙間と重複を避ける）。

timestamps は Docker の RFC3339Nano プレフィックス。パースできれば `timestamp_unix_ms` に入れ、`raw` からプレフィックスを除く。できなければ `timestamp_unix_ms` は無し、行全体を `raw` にする。

表示時刻はローカルタイムゾーンの `HH:MM:SS`。無い行は時刻列を空にする。

stdout/stderr の区別は Bollard のマルチプレックスフレームの stream type を使う。tty コンテナで多重化されない場合はすべて `stdout` とする（stderr フィルタでは見えない。仕様として許容する）。

### 7.2 パイプと背圧

```text
Bollard → 改行分割 → 容量 1024 の bounded channel
       → フラッシュ条件: 16ms 経過 または 200 行
       → logs://batch
       → Zustand リングバッファ（上限 20,000 行、古い順に破棄）
       → TanStack Virtual
```

channel が満杯のときは最も古い未読バッチを捨て、そのバッチの行数を `omitted` に加算して次の batch に載せる。UI は `omitted > 0` ならヘッダに `Skipped {n} lines` を出す。

フロントのフィルタ:

- 文字列: Unicode の lowercase 同士で部分一致。空文字は全行表示。正規表現なし
- ストリーム: `all` / `stdout` / `stderr`
- Clear: query を `""`、stream を `all`。バッファは消さない
- フィルタ変更で Docker を再購読しない

ルート: `/containers/:id/logs`。ヘッダはコンテナ名と状態ドット（一覧の `running` を使う。ログ画面表示中の state 追従は `resources://invalidate` → 一覧再取得後に同じ id の state を反映。コンテナが消えたら `logs://ended` と `Container not found`）。

## 8. エラー処理

core は `DockboltError` を返す。Tauri は `{ code, message }` に変換する。

| code | 条件 | UI |
|---|---|---|
| `socket_not_found` | 候補ゼロ、または選択ソケットが消えた | 未接続 + Retry |
| `permission_denied` | EACCES | 権限メッセージ |
| `timeout` | ping 100ms 超過 | その候補を unavailable。他を試す。全滅なら未接続 |
| `engine_unreachable` | 接続後の I/O 失敗 | Disconnected。ログと Events を止める。再接続試行 |
| `not_found` | 削除・ログ対象欠落 | 一覧再取得。Logs は終了メッセージ |
| `in_use` | Image/Volume 削除が conflict | ダイアログ。force しない |
| `conflict` | その他 409 | `message` をダイアログ |
| `internal` | その他 | tracing に error。短い失敗表示 |

ログストリームの失敗は一覧を落とさない。`logs://ended` + ヘッダメッセージ。

診断は `tracing` の stdout（dev）。ファイル sink は作らない。

## 9. UI と状態

### 9.1 ルート

| path | 画面 |
|---|---|
| `/` | Containers |
| `/containers/:id/logs` | Logs |
| `/images` | Images |
| `/volumes` | Volumes |

未接続でもルートは同じ。コンテンツスロットだけ空/エラーにする。

ウィンドウは 1 つ。スプラッシュなし。表示開始を Cold Start の計測点とする（目標 500ms）。Docker ping 完了は別メトリクス。

見た目: ダーク、高密度、システムフォント、モーダル以外のアニメーションなし。

### 9.2 Zustand

| ストア | 内容 |
|---|---|
| `connection` | `ConnectionView`、`EngineCandidate[]` |
| `containers` | `rows`, `loading`, `error`, `selectedId` |
| `images` | 同上（selected は image id） |
| `volumes` | 同上（selected は name） |
| `logs` | `sessionId`, `containerId`, `lines`, `query`, `streamFilter`, `omitted`, `endedReason` |

React Query 等は使わない。

## 10. ディレクトリ構成（新規作成）

```text
crates/dockbolt-core/src/
  lib.rs
  error.rs
  engine.rs
  client.rs
  containers.rs
  images.rs
  volumes.rs
  logs.rs
  events.rs
src-tauri/src/
  lib.rs          # Tauri builder, command handlers
  state.rs        # AppState: current client, log session, event task
src-tauri/capabilities/
  default.json
src/
  main.tsx
  App.tsx
  routes.tsx
  stores/{connection,containers,images,volumes,logs}.ts
  screens/{Containers,Images,Volumes,Logs}.tsx
  components/{Sidebar,StatusBar,ConfirmDialog,VirtualTable}.tsx
  lib/tauri.ts    # invoke/listen wrappers
```

フロントのテストは Vitest。core は `cargo test`。

## 11. テスト

Docker デーモンなしで core と UI ロジックを通す。結合テスト（実 Docker）はローカル任意。CI 必須にしない。

**core（モック `DockerPort`）**

- ソケットパスの優先順位と「存在する + ping 成功」だけ available
- `selected_engine_id` が available ならそれを採用、死んでいれば次点
- running コンテナ削除だけ `force=true`、それ以外の container は `false`
- image/volume 削除は常に `force=false`
- InUse を `in_use` にマップする
- ログ: 改行分割、タイムスタンプ剥離、200 行または時間でのバッチ、1024 チャネル満杯時の omitted
- Events type から invalidate 対象が 1 リソースになること
- invalidate デバウンス 100ms

**フロント（Vitest）**

- ログフィルタ: 大小無視の部分一致、stdout/stderr、Clear で query 空・stream all・lines 保持
- リングバッファ 20000 で古い行が落ちること
- 接続 3 態の表示分岐

性能目標（Idle CPU、メモリ 100MB、一覧 100ms）は実装後に計測して要件表を更新する。自動テストでは assert しない。

## 12. 受け入れチェック（v0.1）

- macOS または Linux でウィンドウがスプラッシュなしに開く
- 検出された Engine に接続でき、ステータスバーから切替・再起動後も選択が残る
- Containers / Images / Volumes を一覧できる
- 各リソースを確認ダイアログ付きで削除できる。起動中コンテナは force 警告がある
- 使用中 Image/Volume の削除失敗が分かる
- Logs で直近行と follow が見える
- 文字列フィルタと stdout/stderr 切替、Clear が効く
- 大量行でもスクロールとフィルタが UI を止めない
- 未接続時に理由と Retry がある
- Docker Events で外部の削除/作成が一覧に反映される（手動 Refresh でも可）

## 13. 非目標（再掲）

Windows、Remote Docker、Compose、Networks、Start/Stop/Restart、Exec、Stats、Pull/Build、Colima 非 default、`DOCKER_HOST`、複数ログタブ、複数選択削除、正規表現、ログレベル解析、core の CLI 配布。
