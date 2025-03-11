# Claude Voice Assistant

Claude APIを使用した音声会話アプリケーションです。このアプリケーションは、ユーザーの音声入力をテキストに変換し、Claude APIを使用して応答を生成し、その応答をテキスト読み上げで返すことができます。

## プロジェクト構造

- `app/` - Node.jsバックエンドアプリケーションコード
- `cdk/` - AWS CDK インフラストラクチャコード

## 主な機能

- ブラウザベースの音声インターフェース
- リアルタイム音声認識 (AWS Transcribe)
- 高度な自然言語処理 (Claude API)
- 音声合成による回答 (Google Text-to-Speech)
- AWS環境へのデプロイ (CDK)

## AWSへのデプロイ手順

### 前提条件

- Node.js v18以上
- AWS CLI (設定済み)
- AWS CDK CLI (`npm install -g aws-cdk`)
- Docker

### 1. CDKプロジェクトのセットアップとデプロイ

```bash
# CDKディレクトリに移動
cd cdk

# 依存関係のインストール
npm install

# AWS環境の初期化（初回のみ）
cdk bootstrap

# デプロイ内容の確認
cdk diff

# CDKスタックのデプロイ
cdk deploy

# 出力情報を確認
# 重要: ECRリポジトリURI、ロードバランサーDNS、S3バケット名をメモしておく
```

### 2. APIキーの設定

AWS Management Consoleで、または以下のAWS CLIコマンドを使用して、AWS Secrets Managerにシークレットを設定します：

```bash
aws secretsmanager update-secret \
  --secret-id "claude-voice-assistant-secrets" \
  --secret-string '{
    "ANTHROPIC_API_KEY": "sk-ant-your-anthropic-api-key",
    "GOOGLE_APPLICATION_CREDENTIALS_JSON": "{\"type\":\"service_account\",\"project_id\":\"your-project-id\",\"private_key\":\"your-private-key\",\"client_email\":\"your-service-account@your-project.iam.gserviceaccount.com\"}"
  }'
```

### 3. アプリケーションのビルドとデプロイ

```bash
# appディレクトリに移動
cd app

# Dockerイメージのビルド
docker build -t claude-voice-assistant .

# AWSにログイン
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin ${ECR_REPOSITORY_URI}

# イメージにタグ付け
docker tag claude-voice-assistant:latest ${ECR_REPOSITORY_URI}:latest

# ECRにプッシュ
docker push ${ECR_REPOSITORY_URI}:latest
```

以下のコマンドでECSサービスを更新し、新しいイメージをデプロイします：

```bash
aws ecs update-service \
  --cluster claude-voice-assistant-cluster \
  --service claude-voice-assistant-service \
  --force-new-deployment
```

### 4. アプリケーションへのアクセス

デプロイが完了すると、CDKの出力に表示されたロードバランサーのDNS名を使用してアプリケーションにアクセスできます：

```
http://${LOAD_BALANCER_DNS}
```

## AWS Transcribeについて

このアプリケーションは音声認識にAWS Transcribeを使用します。AWS Transcribeを使用するには、次の要件があります：

1. **S3バケットが必須**: AWS Transcribeは音声ファイルをS3から読み取り、結果もS3に保存します。そのため、`S3_BUCKET_NAME` 環境変数の設定が必須となります。

2. **必要なIAM権限**:
   - `transcribe:StartTranscriptionJob`
   - `transcribe:GetTranscriptionJob`
   - `transcribe:ListTranscriptionJobs`
   - S3バケットへの読み書きアクセス権限

3. **サポートされる音声形式**:
   - WAV, MP3, MP4, FLAC, AMR, OGG, WebM など

4. **処理時間**:
   - 短い音声ファイルの場合でも数秒の処理時間が必要です
   - アプリケーションはジョブが完了するまで待機します

## Google Text-to-Speechについて

音声合成にはGoogle Cloud Text-to-Speech APIを使用しています。設定には以下が必要です：

1. **必要なサービスアカウント権限**:
   - **Cloud Text-to-Speech API User** (`roles/cloudtexttospeech.user`)

2. **サービスアカウントの設定手順**:
   - Google Cloud Consoleでプロジェクトを作成
   - Cloud Text-to-Speech APIを有効化
   - サービスアカウントを作成し、適切な権限を付与
   - JSONキーをダウンロードし、内容をエスケープして環境変数に設定

## ローカル開発

ローカル環境で開発とテストを行う場合は以下の手順を実行します：

```bash
# appディレクトリに移動
cd app

# 依存関係のインストール
npm install

# .envファイルを作成し、必要なAPIキーを設定
cp .env.example .env
# .envファイルを編集して必要な情報を追加

# アプリケーションの起動
npm run dev
```

ブラウザで `http://localhost:3000` にアクセスします。

## 管理と運用

### モニタリング

AWS CloudWatchを使用して、アプリケーションのログとメトリクスをモニタリングできます：

```bash
# ログストリームの確認
aws logs get-log-events \
  --log-group-name /ecs/claude-voice-assistant \
  --log-stream-name $(aws logs describe-log-streams \
    --log-group-name /ecs/claude-voice-assistant \
    --order-by LastEventTime \
    --descending \
    --limit 1 \
    --query 'logStreams[0].logStreamName' \
    --output text)
```

### リソースのクリーンアップ

環境を削除する場合は以下のコマンドを実行します：

```bash
cd cdk
cdk destroy
```

## トラブルシューティング

### AWS Transcribe関連の問題

- **ジョブが失敗する場合**:
  - S3バケットへのアクセス権限を確認
  - ファイル形式がサポートされているか確認
  - IAM権限が適切に設定されているか確認

- **処理が遅い場合**:
  - AWS Transcribeは非同期処理のため、短い音声でも数秒の処理時間が必要です
  - 長い音声ファイルの場合はさらに時間がかかります

### その他の一般的な問題については、[app/README.md](app/README.md)を参照してください。

## 技術スタック

- **フロントエンド**: HTML, CSS, JavaScript
- **バックエンド**: Node.js, Express
- **AI/機械学習**: Claude API, AWS Transcribe, Google Text-to-Speech
- **インフラ**: AWS CDK, ECS Fargate, ECR, ALB, S3, Secrets Manager, Transcribe
- **CI/CD**: AWS CLI, Docker
