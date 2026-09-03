# DockBolt Compose プロジェクト操作 詳細設計

**Date:** 2026-09-03  
**Status:** Approved  
**Requirements:** `docs/dockbolt_requirements.md`（将来拡張候補: Docker Compose）  
**Depends on:** `docs/superpowers/specs/2026-09-02-dockbolt-mvp-design.md`  
**Approach:** Compose CLI / compose ライブラリは使わず、Engine API のラベルからプロジェクトを組み立てて start / stop / down する

## 1. 目的

DockBolt に **実行中・停止中の Compose プロジェクト** を一覧し、プロジェクト単位で Start / Stop / Down できる画面を足す。compose.yml を選んで `up` する機能はこのスライスに含めない。

Down 後はコンテナが消えるため、**同じプロジェクトを DockBolt から再 Up できない**。それは仕様であり、ファイル指定の `up` は別スライスとする。

## 2. 決定済みのプロダクト方針

| 項目 | 決定 |
|---|---|
| 発見方法 | Engine 上の Compose ラベル。ディスクの compose.yml は読まない |
| 操作単位 | プロジェクト全体のみ。サービス単位の Start / Stop はしない |
| Start / Stop | 確認ダイアログなし |
| Down | `docker compose down` 相当。コンテナと、そのプロジェクトが作ったネットワークを削除。named volume は残す。確認ダイアログ必須 |
| Up from file | 対象外 |
| ログ | Compose 画面には置かない。既存の Containers → Logs を使う |
| 個別削除 | Compose 画面には置かない。既存の Containers / Images / Volumes を使う |
| CLI | `docker compose` の spawn はしない |
| UI 文言 | 英語。仕様書は日本語 |

## 3. 画面

サイドバーに **Compose** を追加する。ルートは `/compose`。Containers / Images / Volumes の並びに置く（Containers の次）。

一覧はプロジェクトが 1 行。仮想リストは既存の `VirtualTable` を使う。

### 3.1 行

| 列 | 内容 |
|---|---|
| Name | `com.docker.compose.project` の値 |
| Status | `running` / `partial` / `stopped` |
| Services | ユニークな `com.docker.compose.service` の数。サービスラベルが無いコンテナはサービス 1 つと数える（コンテナ数と同じ） |
| Containers | `{running_count}/{container_count}` |

状態の定義:

- 全コンテナ `running` → `running`
- 1 つ以上 `running` かつ 1 つ以上非 running → `partial`
- それ以外 → `stopped`

ソートはプロジェクト名の昇順（大文字小文字無視）。

空状態: `No compose projects`。未接続・切断は他画面と同じコピーと Retry。

### 3.2 操作

選択行があるとき **Start / Stop / Down** を有効にする。操作中はその 3 つを disable する。他画面の操作とログストリームは止めない。

- **Start:** そのプロジェクトの非 running コンテナだけ `start` する。すでに running のものは触らない。`depends_on` 順は再現しない。開始順はコンテナ名昇順で直列。
- **Stop:** そのプロジェクトの running コンテナだけ `stop` する。timeout は Engine デフォルト。停止順はコンテナ名昇順で直列。
- **Down:** 下記 5.3。確認後に実行する。

確認ダイアログ（Down のみ）:

- Title: `Down compose project`
- Body: `{project} will remove {container_count} container(s) and project networks. Named volumes are kept. You cannot start this project again from DockBolt.`

成功時は Events の invalidate、または返ってきたあとの `list_compose_projects` で一覧を更新する。Down 成功でそのプロジェクトが 0 コンテナになれば行は消える。失敗時は行を残し、エラーダイアログ（既存の IPC メッセージ）を出す。

## 4. アーキテクチャ

MVP と同じ 3 層。Compose ドメインは `crates/dockbolt-core` の `compose` モジュール。Tauri はコマンドと invalidate。React は `/compose` と Zustand。

```text
src/screens/Compose.tsx
src/stores/compose.ts
        invoke list/start/stop/down
src-tauri
        dockbolt_core::compose
        DockerPort
        Bollard
```

### 4.1 DockerPort の拡張

既存の `list_containers` / `remove_container` は残す。次を追加する。

| メソッド | 用途 |
|---|---|
| `start_container(id)` | Compose Start |
| `stop_container(id)` | Compose Stop と Down 前の停止 |
| `list_networks()` | Down 対象ネットワークの選定 |
| `remove_network(id)` | Down |

モック（既存テストの `DockerPort` impl）も同じメソッドを足す。

### 4.2 ラベルと DTO

コンテナ一覧 API の `ContainerRow` に任意フィールドを足す。無いときは JSON から省略し、既存 UI は無視してよい。

| フィールド | 元 |
|---|---|
| `compose_project` | ラベル `com.docker.compose.project` |
| `compose_service` | ラベル `com.docker.compose.service` |

`list_containers` はこれまでどおり停止中を含む全コンテナを返す（Bollard の all）。Compose 画面は `compose_project` がある行だけをグループする。Compose ラベルの無いコンテナは Compose 一覧に出さない（Containers 画面には出る）。

ネットワークは UI に出さない。core 内部用:

```text
NetworkRow { id, name, compose_project: Option<String> }
```

`compose_project` はラベル `com.docker.compose.project`。このラベルが無いネットワークは Compose 管理外（external 相当）とし、Down で消さない。

### 4.3 プロジェクト行

```text
ComposeProjectRow {
  project: string,
  status: "running" | "partial" | "stopped",
  service_count: number,
  running_count: number,
  container_count: number,
}
```

組み立ては純関数 `build_compose_projects(containers: &[ContainerRow]) -> Vec<ComposeProjectRow>`。ネットワークは一覧には使わず Down 時だけ見る。

`service_count`: そのプロジェクト内で、`compose_service` がある値のユニーク数。ラベル無しコンテナはそれぞれ 1 サービスとして足す（同一空キーにまとめない）。

## 5. 操作の詳細

対象プロジェクト名 `project` に一致するコンテナが 0 件なら、Start / Stop / Down はすべて `not_found`（メッセージにプロジェクト名を含める）。一覧に無い名前を IPC で渡した場合も同じ。

### 5.1 Start

1. 対象コンテナを名前昇順で並べる  
2. `running == false` のものだけ `start_container`  
3. 5.4 の部分失敗ルール

### 5.2 Stop

1. 対象コンテナを名前昇順で並べる  
2. `running == true` のものだけ `stop_container`  
3. 5.4 の部分失敗ルール

### 5.3 Down（`docker compose down` 相当）

volume API は呼ばない。

1. 対象コンテナを名前昇順で並べる  
2. running なら先に `stop_container`（失敗しても remove は試みる）  
3. `remove_container(id, force)`。force は既存どおり running なら true、それ以外 false。stop 直後でも state が残っていれば running 時の force ルールを、stop 成功後は force=false でよい。実装は「remove 時にその時点の running フラグ」ではなく、**当初の `row.running` で force を決める**（既存の個別削除と同じ）  
4. `list_networks` のうち `compose_project == project` のネットワークを名前昇順で `remove_network`  
5. 5.4 の部分失敗ルール。コンテナ段階の失敗を覚えてもネットワーク削除は続ける

### 5.4 部分失敗

対象を最後まで処理する。途中で return しない。1 件以上失敗したら、**最初の失敗**を `Err` として返す。成功した操作は取り消さない。

UI はエラーダイアログを出し、続けて `list_compose_projects` を再取得する（Events と二重になってもよい。debounce 済み invalidate と競合しても最終的に Engine の事実と一致する）。

## 6. IPC

コマンド名とイベントはフロントと Tauri で同じ文字列。

| コマンド | 入力 | 出力 |
|---|---|---|
| `list_compose_projects` | なし | `ComposeProjectRow[]` |
| `start_compose_project` | `{ project: string }` | `{ ok: true }` |
| `stop_compose_project` | `{ project: string }` | `{ ok: true }` |
| `down_compose_project` | `{ project: string }` | `{ ok: true }` |

既存の `refresh` コマンドは変更しない（`"all"` の JSON も Containers / Images / Volumes のまま）。Compose の初回ロード・手動 Refresh・切断復帰後の取り直しは、どれも `list_compose_projects` だけを使う。Images 画面の `reload` と同じ形。

### 6.1 Events

`ResourceKind` に `Compose` を足す。`resources://invalidate` の `resource` は `"compose"`。

| Docker type | 追加の invalidate |
|---|---|
| `container` | 既存の `containers`（および image in-use 用の images）に加え `compose` |
| `network` | `compose` のみ（Networks 画面は無い） |

Events 購読フィルタに `network` を足す。debounce は既存どおり同一 kind 100ms。

切断時の再接続後フル refresh では compose ストアも取り直す。

## 7. フロント

- `src/screens/Compose.tsx` — Images に近い選択 + アクション + ConfirmDialog  
- `src/stores/compose.ts` — `rows`, `selectedProject`, `loading`, `error`, `reload`, `clear`  
- `App.tsx` — 切断時 `clear`。`invalidate === "compose"` で `reload`。`container` invalidate でも compose を reload する（イベントが compose と containers の両方で来る場合は二重取得になりうる。 debouncer は kind 別なので 2 回呼ぶ。許容する。コンテナ event だけ compose を更新し、network event でも更新する）  
- サイドバーに NavLink `/compose`

コンテナ invalidate と compose invalidate が短時間に両方来てもよい。

## 8. エラー

既存 `DockboltError` を使う。新しいコードは増やさない。

| 状況 | コード |
|---|---|
| プロジェクトにコンテナが無い | `not_found` |
| ネットワークがまだ使われている | `in_use`（既存の 409 マップ） |
| 権限・切断・timeout | 既存どおり |

Down でコンテナは消えたがネットワーク削除が失敗した場合も、最初のネットワーク失敗（またはそれ以前のコンテナ失敗）を返す。UI は再取得して残件を見せる。

## 9. 対象外

- compose.yml からの `up` / `build` / `pull` / `restart`
- サービス単位の Start / Stop / ログ
- 複数プロジェクト横断
- named volume の削除（`down -v`）
- `depends_on`・ヘルスウェイト
- Compose ライブラリ、`docker compose` CLI
- Networks を独立画面にすること
- Windows

## 10. テスト

実 Docker は使わない。`DockerPort` モックと純関数。

Rust:

- ラベル無しコンテナはプロジェクトに入らない。停止中ラベル付きは入る
- 同一 project の 3 コンテナで running 3 / 1 / 0 がそれぞれ running / partial / stopped
- service ラベル 2 種 + ラベル無し 1 台 → `service_count == 3`
- Start は stopped の id だけ `start_container` される
- Stop は running の id だけ `stop_container` される
- Down は対象コンテナの remove のあと、同じ project の network だけ remove。volume メソッドは呼ばれない。他プロジェクトの network は呼ばない
- 2 コンテナ中 2 件目の start が失敗しても 1 件目は start 済み。`Err` が返る
- 存在しない project 名は `not_found` で Docker 変更メソッドを呼ばない

フロント（Vitest）:

- `buildComposeProjects` 相当の純関数（Rust と同じ規則）。コアに置くならフロントは薄いラッパで、テストは Rust 側を厚くしてもよい。**グループ化の正は Rust。フロントは受け取った `ComposeProjectRow[]` を表示するだけ**とし、重複実装を避ける。フロントの Vitest は状態ラベルの表示用ヘルパがあればそれだけ（例 status 文字列のそのまま表示ならテスト不要）。ステータス表示がマッピング無しならフロント新規テストは必須にしない。

CI: 既存の lint / fmt / clippy / test / build に乗せる。E2E は足さない。

## 11. 完成条件

- サイドバーから Compose に入れる
- Compose ラベル付きコンテナがプロジェクト行にまとまる
- Start / Stop / Down がプロジェクト単位で動く
- Down の確認に volume を残すことと再 Up できないことが書いてある
- Down がプロジェクトネットワークを消し、volume を消さない
- ファイル選択の Up が無い
- 既存の Containers / Images / Volumes / Logs が壊れていない
- CI が通る
