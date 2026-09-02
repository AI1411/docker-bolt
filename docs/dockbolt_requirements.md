# DockBolt 要件定義書

**Version:** MVP v0.1  
**Status:** Draft  
**Date:** 2026-09-02

## 1. 概要

DockBoltは、Dockerの主要リソースを高速かつシンプルに管理するための軽量GUIアプリケーションである。

Docker DesktopやOrbStackのような多機能な統合環境を最初から目指すのではなく、MVPでは日常的に利用頻度の高い操作に絞り、**高速な起動・低いリソース消費・レスポンスの良いUI**を重視する。

### コンセプト

> View. Filter. Delete. Fast.

MVPでは以下を中心機能とする。

- Containersの一覧確認・削除
- Imagesの一覧確認・削除
- Volumesの一覧確認・削除
- Container Logsの閲覧
- Logsのフィルター

---

## 2. プロダクト名

**DockBolt**

Docker管理と「高速さ」を連想できる名称として採用する。

---

## 3. MVPの目的

DockBolt v0.1では、Docker Engine上に存在する主要リソースをGUIから素早く確認・整理できる状態を完成条件とする。

特に以下のユーザーフローを高速に実行できることを重視する。

1. DockBoltを起動する
2. Containers / Images / Volumesを確認する
3. 不要なリソースを削除する
4. Containerのログを開く
5. 必要なログだけをフィルターして確認する

---

## 4. 対象ユーザー

- Dockerを利用するソフトウェアエンジニア
- Docker Desktop等のGUIが重いと感じているユーザー
- CLIだけでなくGUIでもDockerリソースを素早く確認したいユーザー
- 開発中のContainer Logsを頻繁に確認するユーザー

---

## 5. MVP機能要件

### 5.1 Containers

#### 必須機能

- Container一覧表示
- Container削除
- Container Logs表示
- Logsのリアルタイム更新
- Logsの文字列フィルター
- stdout / stderrによるフィルター

#### MVP対象外

- Start
- Stop
- Restart
- Exec / Terminal
- Container作成
- Container内ファイル閲覧
- Stats表示

これらは必要に応じてv0.2以降で検討する。

---

### 5.2 Images

#### 必須機能

- Image一覧表示
- Image削除

#### MVP対象外

- Image Pull
- Image Build
- Image Push
- Registry管理
- BuildKit GUI

---

### 5.3 Volumes

#### 必須機能

- Volume一覧表示
- Volume削除

#### MVP対象外

- Volume作成
- Volume内ファイル閲覧
- ファイル編集
- Export / Backup
- Prune
- Volumeサイズの詳細分析

---

### 5.4 Logs

LogsはDockBolt MVPにおける重要機能の一つとする。

#### 必須機能

- Container Logs表示
- リアルタイムストリーミング
- 文字列によるログ検索・フィルター
- stdout / stderr切り替え
- フィルター解除

#### UIイメージ

```text
api-server                                  ● Running

[ Search logs...                         ] [ All ▾ ] [ Clear ]

──────────────────────────────────────────────────────

21:14:03  INFO   Server started on :8080
21:14:05  INFO   GET /api/users 200
21:14:08  ERROR  Database connection failed
21:14:09  WARN   Retrying connection...
21:14:10  INFO   Database connected
```

#### MVP対象外

- 正規表現検索
- AND / OR条件
- ログレベル自動解析
- 複数Container横断検索
- 保存済みフィルター

---

## 6. 画面構成

MVPでは以下のシンプルな構成とする。

```text
DockBolt
│
├── Containers
│   ├── Container List
│   ├── Delete
│   └── Logs
│       └── Filter
│
├── Images
│   ├── Image List
│   └── Delete
│
└── Volumes
    ├── Volume List
    └── Delete
```

### 共通UI

- Docker Engine接続状態を表示する
- 削除操作では確認ダイアログを表示する
- 一覧画面は大量のリソースが存在してもスムーズに操作できることを重視する

---

## 7. 非機能要件

### 7.1 パフォーマンス

DockBoltではパフォーマンス自体を主要なプロダクト価値として扱う。

目標値の初期案は以下とする。

| 項目 | 目標 |
|---|---:|
| Cold Start | 500ms未満を目標 |
| Docker接続 | 100ms程度を目標 |
| 一覧表示 | 可能な限り100ms程度を目標 |
| Idle CPU | ほぼ0% |
| Idle Memory | 100MB未満を目標 |

数値は実装・計測結果を踏まえて調整する。

### 7.2 UIレスポンス

- 操作に対するUIフィードバックを即座に返す
- 不要なポーリングを避ける
- 大量ログによってUIスレッドがブロックされないようにする
- 大量リストではVirtualizationを利用する

### 7.3 Logsパフォーマンス

ログは1行ごとにフロントエンドへ送信するのではなく、必要に応じてバッチ化する。

```text
Docker Log Stream
       ↓
Rust Stream
       ↓
Bounded Channel
       ↓
Batch
       ↓
Frontend
       ↓
Virtualized Renderer
```

大量ログが流れるContainerでもGUI操作が重くならないことを目指す。

---

## 8. 技術スタック案

MVPの第一候補は以下とする。

| 領域 | 技術 |
|---|---|
| Core Language | Rust |
| Desktop Framework | Tauri 2 |
| Frontend | React |
| Frontend Language | TypeScript |
| Async Runtime | Tokio |
| Docker API Client | Bollard |
| Serialization | serde |
| Frontend State | Zustand |
| Large List Rendering | TanStack Virtual |
| Logging / Diagnostics | tracing |

### 基本アーキテクチャ

```text
┌──────────────────────────────────────┐
│           Tauri / React UI           │
│                                      │
│ Containers / Images / Volumes / Logs│
└──────────────────┬───────────────────┘
                   │ IPC / Events
                   ▼
┌──────────────────────────────────────┐
│              Rust Core               │
│                                      │
│ Tokio / Bollard / State / Streams    │
└──────────────────┬───────────────────┘
                   │
                   │ Docker Engine API
                   ▼
┌──────────────────────────────────────┐
│            Docker Engine             │
└──────────────────────────────────────┘
```

---

## 9. Dockerとの通信方針

原則としてDocker CLIを子プロセスとして実行し、そのstdoutを解析する方式は採用しない。

```text
NG（原則）

DockBolt
   ↓
docker ps
   ↓
Process Spawn
   ↓
stdout parse
```

Docker Engine APIへ直接接続する。

```text
DockBolt UI
    ↓
Rust Core
    ↓
Docker Engine API
    ↓
Docker Engine
```

これにより、余計なProcess Spawnや文字列解析を避け、低レイテンシな実装を目指す。

---

## 10. MVP対象外

以下はv0.1では実装しない。

- Docker Compose管理
- Networks管理
- Kubernetes
- Docker VM管理
- Linux VMの自前実装
- Docker Desktop完全代替
- OrbStack完全代替
- Remote Docker
- Podman
- containerd直接管理
- Registry管理
- Terminal / Exec
- Container Stats
- Image Build

---

## 11. 将来的な拡張候補

MVP完成後、利用頻度やフィードバックを踏まえて以下を検討する。

- Container Start / Stop / Restart
- Exec / Terminal
- Docker Compose
- Networks
- Container Stats
- Volume Prune
- Image Pull / Build
- 高度なLogsフィルター
- 複数ContainerのLogs統合表示
- Remote Docker
- Podman対応
- containerd対応
- macOS向けLinux VM管理

---

## 12. MVP完成条件

以下の操作が安定して高速に行えることをDockBolt v0.1の完成条件とする。

- DockBoltが高速に起動する
- ローカルDocker Engineへ接続できる
- Containersを一覧表示できる
- Imagesを一覧表示できる
- Volumesを一覧表示できる
- Containersを削除できる
- Imagesを削除できる
- Volumesを削除できる
- Container Logsをリアルタイムで閲覧できる
- Logsを文字列でフィルターできる
- stdout / stderrを切り替えられる
- 大量のリソース・ログが存在してもUIが著しく重くならない

---

## 13. MVPの一言定義

> **DockBolt v0.1は、Containers・Images・Volumesの確認と削除、Container Logsの高速な閲覧・フィルタリングに特化した軽量Docker GUIである。**
