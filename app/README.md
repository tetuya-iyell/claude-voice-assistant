# Claude Voice Assistant アプリケーション

このディレクトリには、Claude APIを使用した音声会話アプリケーションのコードが含まれています。

## 機能

- ブラウザでのマイク録音による音声入力
- OpenAI Whisper APIを使用した音声認識
- Claude APIを利用した自然言語処理
- Google Text-to-Speechを利用した音声合成
- 会話履歴の保持
- AWS S3との統合（オプション）

## 前提条件

- Node.js (バージョン18以上)
- 各種APIキー:
  - Anthropic API Key (Claude)
  - OpenAI API Key (Whisper)
  - Google Cloud キー（音声合成用）

## ローカル開発

1. 必要なパッケージをインストール:
   ```bash
   npm install
   ```

2. 環境変数を設定:
   ```bash
   # .envファイルを作成
   cp .env.example .env
   # 各APIキーを設定
   ```

3. アプリケーションを起動:
   ```bash
   npm run dev
   ```

4. ブラウザで `http://localhost:3000` にアクセス

## コンテナビルド

```bash
docker build -t claude-voice-assistant .
docker run -p 3000:3000 \
  -e ANTHROPIC_API_KEY=your_api_key \
  -e OPENAI_API_KEY=your_api_key \
  -e GOOGLE_APPLICATION_CREDENTIALS_JSON='{"type":"service_account",...}' \
  claude-voice-assistant
```

## AWS環境へのデプロイ

AWS環境へのデプロイは、リポジトリのルートディレクトリにあるCDKコードを使用して行います。

### ECRへのイメージプッシュ

1. AWSにログイン:
   ```bash
   aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin [YOUR_ACCOUNT_ID].dkr.ecr.us-east-1.amazonaws.com
   ```

2. CDKデプロイ後にECRリポジトリURLを取得:
   ```bash
   # CDKスタック出力から
   ECR_REPO_URL=$(aws cloudformation describe-stacks --stack-name ClaudeVoiceAssistantStack --query "Stacks[0].Outputs[?OutputKey=='EcrRepositoryUri'].OutputValue" --output text)
   ```

3. イメージにタグを付けてプッシュ:
   ```bash
   docker tag claude-voice-assistant:latest $ECR_REPO_URL:latest
   docker push $ECR_REPO_URL:latest
   ```

### シークレットマネージャーの設定

AWS Management Consoleまたは以下のAWS CLIコマンドを使用して、Secrets Managerのシークレット値を設定します:

```bash
aws secretsmanager update-secret \
  --secret-id "claude-voice-assistant-secrets" \
  --secret-string '{
    "ANTHROPIC_API_KEY": "sk-ant-your-anthropic-api-key",
    "OPENAI_API_KEY": "sk-your-openai-api-key",
    "GOOGLE_APPLICATION_CREDENTIALS_JSON": "{\"type\":\"service_account\",\"project_id\":\"your-project-id\",\"private_key_id\":\"key-id\",\"private_key\":\"-----BEGIN PRIVATE KEY-----\\nYOUR_PRIVATE_KEY\\n-----END PRIVATE KEY-----\\n\",\"client_email\":\"your-service-account@your-project.iam.gserviceaccount.com\",\"client_id\":\"client-id\",\"auth_uri\":\"https://accounts.google.com/o/oauth2/auth\",\"token_uri\":\"https://oauth2.googleapis.com/token\",\"auth_provider_x509_cert_url\":\"https://www.googleapis.com/oauth2/v1/certs\",\"client_x509_cert_url\":\"https://www.googleapis.com/robot/v1/metadata/x509/your-service-account%40your-project.iam.gserviceaccount.com\",\"universe_domain\":\"googleapis.com\"}"
  }'
```

## 環境変数

| 変数名 | 説明 | 必須 |
|-------|------|------|
| `ANTHROPIC_API_KEY` | Anthropic Claude APIのAPIキー | はい |
| `OPENAI_API_KEY` | OpenAI APIのAPIキー（音声認識用） | はい |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | Google Cloud JSONキー（音声合成用） | はい |
| `S3_BUCKET_NAME` | 一時ファイル保存用のS3バケット名 | いいえ |
| `AWS_REGION` | AWSリージョン（S3使用時） | いいえ |
| `PORT` | アプリケーションのポート番号 | いいえ(デフォルト: 3000) |

## ファイル構造

```
app/
├── public/              # 静的ファイル
│   ├── index.html       # メインHTML
│   ├── styles.css       # スタイルシート
│   └── app.js           # フロントエンドJavaScript
├── server.js            # メインサーバーコード
├── package.json         # 依存関係
├── Dockerfile           # Dockerビルド定義
├── temp/                # 一時ファイル用ディレクトリ (自動生成)
└── uploads/             # アップロード用ディレクトリ (自動生成)
```

## トラブルシューティング

### マイクアクセスの問題

- ブラウザでマイクへのアクセス許可が必要です
- HTTPSまたはlocalhost環境でのみ動作します

### 音声認識の問題

- 環境雑音が多い場合、認識精度が低下することがあります
- OpenAI APIキーが有効であることを確認してください

### 音声合成の問題

- Google Cloud認証情報が正しいかチェックしてください
- テキスト長が長すぎる場合は分割して処理する必要があるかもしれません
