# Claude Voice Assistant

Claude APIを使用した音声会話アプリケーションです。このアプリケーションは、ユーザーの音声入力をテキストに変換し、Claude APIを使用して応答を生成し、その応答をテキスト読み上げで返すことができます。

## プロジェクト構造

- `app/` - Node.jsバックエンドアプリケーションコード
- `cdk/` - AWS CDK インフラストラクチャコード

## 主な機能

- ブラウザベースの音声インターフェース
- リアルタイム音声認識 (OpenAI Whisper API)
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
    "OPENAI_API_KEY": "sk-your-openai-api-key",
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

## ローカル開発

ローカル環境で開発とテストを行う場合は以下の手順を実行します：

```bash
# appディレクトリに移動
cd app

# 依存関係のインストール
npm install

# .envファイルを作成し、必要なAPIキーを設定
echo "ANTHROPIC_API_KEY=sk-ant-your-key
OPENAI_API_KEY=sk-your-key
GOOGLE_APPLICATION_CREDENTIALS_JSON={\"type\":\"service_account\",...}" > .env

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

### スケーリング設定

負荷に応じたスケーリングは自動的に設定されていますが、以下のコマンドで手動調整も可能です：

```bash
# タスク数の調整
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --resource-id service/claude-voice-assistant-cluster/claude-voice-assistant-service \
  --scalable-dimension ecs:service:DesiredCount \
  --min-capacity 2 \
  --max-capacity 10
```

### リソースのクリーンアップ

環境を削除する場合は以下のコマンドを実行します：

```bash
cd cdk
cdk destroy
```

## トラブルシューティング

一般的な問題と解決策については、[app/README.md](app/README.md)を参照してください。

## 技術スタック

- **フロントエンド**: HTML, CSS, JavaScript
- **バックエンド**: Node.js, Express
- **AI/機械学習**: Claude API, OpenAI Whisper API, Google Text-to-Speech
- **インフラ**: AWS CDK, ECS Fargate, ECR, ALB, S3, Secrets Manager
- **CI/CD**: AWS CLI, Docker
