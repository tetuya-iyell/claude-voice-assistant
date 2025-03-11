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

### AWS リージョンの設定

このアプリケーションは、デフォルトで `us-east-1` リージョンにデプロイするよう設計されています。リージョンを設定するには、以下の方法があります：

1. **AWS CLIの設定を使用** (推奨):
   ```bash
   aws configure set region us-east-1
   ```

2. **環境変数で設定**:
   ```bash
   # Linuxまたは macOS
   export AWS_REGION=us-east-1
   export CDK_DEPLOY_REGION=us-east-1
   
   # Windows (コマンドプロンプト)
   set AWS_REGION=us-east-1
   set CDK_DEPLOY_REGION=us-east-1
   
   # Windows (PowerShell)
   $env:AWS_REGION = "us-east-1"
   $env:CDK_DEPLOY_REGION = "us-east-1"
   ```

### デプロイスクリプトの使用 (推奨)

プロジェクトに含まれるデプロイスクリプトを使用すると、ECRログインから始まる一連のデプロイ手順を自動的に実行できます。

#### macOS/Linux:

```bash
# CDKディレクトリに移動
cd cdk

# スクリプトに実行権限を付与
chmod +x deploy.sh

# デプロイを実行
./deploy.sh
```

#### Windows:

```bash
# CDKディレクトリに移動
cd cdk

# デプロイを実行
deploy.bat
```

### 手動でのデプロイ手順

デプロイスクリプトを使用せず、手動でデプロイする場合は以下の手順を実行します：

1. **ECRへのログイン**

```bash
# アカウントIDを取得
ACCOUNT_ID=$(aws sts get-caller-identity --query "Account" --output text)

# ECRにログイン
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin ${ACCOUNT_ID}.dkr.ecr.us-east-1.amazonaws.com
```

2. **CDKプロジェクトのセットアップとデプロイ**

```bash
# CDKディレクトリに移動
cd cdk

# 依存関係のインストール
npm install

# AWS環境の初期化（初回のみ）
cdk bootstrap aws://${ACCOUNT_ID}/us-east-1

# デプロイ内容の確認
cdk diff

# CDKスタックのデプロイ
cdk deploy
```

3. **デプロイの確認**

```bash
# ロードバランサーDNSを取得
aws cloudformation describe-stacks --stack-name ClaudeVoiceAssistantStack --query "Stacks[0].Outputs[?OutputKey=='LoadBalancerDns'].OutputValue" --output text --region us-east-1
```

### APIキーの設定

AWS Management Consoleで、または以下のAWS CLIコマンドを使用して、AWS Secrets Managerにシークレットを設定します：

```bash
aws secretsmanager update-secret \
  --secret-id "claude-voice-assistant-secrets" \
  --secret-string '{
    "ANTHROPIC_API_KEY": "sk-ant-your-anthropic-api-key",
    "GOOGLE_APPLICATION_CREDENTIALS_JSON": "{\"type\":\"service_account\",\"project_id\":\"your-project-id\",\"private_key\":\"your-private-key\",\"client_email\":\"your-service-account@your-project.iam.gserviceaccount.com\"}"
  }' \
  --region us-east-1
```

### アプリケーションへのアクセス

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
# 重要: S3_BUCKET_NAME と AWS_REGION=us-east-1 を設定する

# アプリケーションの起動
npm run dev
```

ブラウザで `http://localhost:3000` にアクセスします。

## 管理と運用

### モニタリング

AWS CloudWatchを使用して、アプリケーションのログとメトリクスをモニタリングできます：

```bash
# ログストリームの確認 (us-east-1リージョンを指定)
aws logs get-log-events \
  --log-group-name /ecs/claude-voice-assistant \
  --log-stream-name $(aws logs describe-log-streams \
    --log-group-name /ecs/claude-voice-assistant \
    --order-by LastEventTime \
    --descending \
    --limit 1 \
    --query 'logStreams[0].logStreamName' \
    --output text \
    --region us-east-1) \
  --region us-east-1
```

### リソースのクリーンアップ

環境を削除する場合は以下のコマンドを実行します：

```bash
cd cdk
cdk destroy --region us-east-1
```

## トラブルシューティング

### AWS Transcribe関連の問題

- **ジョブが失敗する場合**:
  - S3バケットへのアクセス権限を確認
  - ファイル形式がサポートされているか確認
  - IAM権限が適切に設定されているか確認
  - リージョン設定が一致しているか確認（アプリケーションとS3バケットが同じリージョンにあるべき）

- **処理が遅い場合**:
  - AWS Transcribeは非同期処理のため、短い音声でも数秒の処理時間が必要です
  - 長い音声ファイルの場合はさらに時間がかかります

### リージョン関連の問題

- **リソースが見つからない場合**:
  - すべてのリソースが同じリージョン（us-east-1）にあることを確認
  - AWS CLIやSDKの操作時にリージョンを明示的に指定
  - CDKデプロイがus-east-1に対して行われたことを確認

### ECRプッシュの問題

- **ECRへのプッシュに失敗する場合**:
  - 提供されているデプロイスクリプトを使用して、ECRへのログインを確実に行う
  - Dockerが実行中であることを確認
  - AWS認証情報が正しく設定されていることを確認
  - デプロイスクリプト実行時のエラーメッセージを確認

### その他の一般的な問題については、[app/README.md](app/README.md)を参照してください。

## 技術スタック

- **フロントエンド**: HTML, CSS, JavaScript
- **バックエンド**: Node.js, Express
- **AI/機械学習**: Claude API, AWS Transcribe, Google Text-to-Speech
- **インフラ**: AWS CDK, ECS Fargate, ECR, ALB, S3, Secrets Manager, Transcribe
- **CI/CD**: AWS CLI, Docker