# Claude Voice Assistant アプリケーション

このディレクトリには、Claude APIを使用した音声会話アプリケーションのコードが含まれています。

## 機能

- ブラウザでのマイク録音による音声入力
- AWS Transcribeを使用した音声認識
- Claude APIを利用した自然言語処理
- Google Text-to-Speechを利用した音声合成
- 会話履歴の保持
- AWS S3との統合（必須）

## 前提条件

- Node.js (バージョン18以上)
- 各種APIキー:
  - Anthropic API Key (Claude)
  - Google Cloud キー（音声合成用）
- AWS設定:
  - S3バケットアクセス（必須）
  - Transcribeサービス利用権限
  - AWS_REGION=us-east-1（推奨）

## ローカル開発

1. 必要なパッケージをインストール:
   ```bash
   npm install
   ```

2. 環境変数を設定:
   ```bash
   # .envファイルを作成
   cp .env.example .env
   # 各APIキーを設定し、AWS_REGIONをus-east-1に設定
   ```

3. アプリケーションを起動:
   ```bash
   npm run dev
   ```

4. ブラウザで `http://localhost:3000` にアクセス

## AWS Transcribeについて

音声認識にはAWS Transcribeを使用しています。AWS Transcribeは非同期APIのため、以下の点に注意してください：

1. **S3バケットが必須**: 
   - AWS Transcribeは音声ファイルをS3から読み取り、結果もS3に保存します
   - S3_BUCKET_NAME環境変数が必須です

2. **リージョン設定**:
   - S3バケットとTranscribeサービスは同じリージョンである必要があります
   - デフォルトでは `us-east-1` を使用します
   - 他のリージョンを使用する場合は、S3バケットとTranscribeサービスの両方に同じリージョンを指定する必要があります

3. **処理時間**:
   - 短い音声ファイルでも数秒の処理時間がかかります
   - アプリケーションはジョブが完了するまで待機します

4. **サポート言語**:
   - デフォルトでは日本語（ja-JP）に設定されています
   - 他の言語を使用する場合は、`server.js`の`StartTranscriptionJobCommand`設定を変更してください

5. **ファイル形式**:
   - サポートされるファイル形式: WAV, MP3, MP4, FLAC, AMR, OGG, WebMなど
   - 詳細はAWS Transcribe公式ドキュメントを参照してください

## コンテナビルド

```bash
docker build -t claude-voice-assistant .
docker run -p 3000:3000 \
  -e ANTHROPIC_API_KEY=your_api_key \
  -e GOOGLE_APPLICATION_CREDENTIALS_JSON='{"type":"service_account",...}' \
  -e S3_BUCKET_NAME=your-bucket-name \
  -e AWS_REGION=us-east-1 \
  claude-voice-assistant
```

## AWS環境へのデプロイ

AWS環境へのデプロイは、リポジトリのルートディレクトリにあるCDKコードを使用して行います。

### AWS リージョンの設定

このアプリケーションはデフォルトで `us-east-1` リージョンを使用します。ローカル開発時には以下の方法でリージョンを設定できます：

1. **.env ファイルに設定**:
   ```
   AWS_REGION=us-east-1
   ```

2. **環境変数で設定**:
   ```bash
   # Linux/macOS
   export AWS_REGION=us-east-1
   
   # Windows
   set AWS_REGION=us-east-1
   ```

3. **コードで明示的に指定**:
   必要に応じて、AWS SDKクライアント初期化時にリージョンを指定できます：
   ```javascript
   const s3 = new S3Client({ region: 'us-east-1' });
   const transcribeClient = new TranscribeClient({ region: 'us-east-1' });
   ```

### ECRへのイメージプッシュ

1. AWSにログイン:
   ```bash
   aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin [YOUR_ACCOUNT_ID].dkr.ecr.us-east-1.amazonaws.com
   ```

2. CDKデプロイ後にECRリポジトリURLを取得:
   ```bash
   # CDKスタック出力から
   ECR_REPO_URL=$(aws cloudformation describe-stacks --stack-name ClaudeVoiceAssistantStack --query "Stacks[0].Outputs[?OutputKey=='EcrRepositoryUri'].OutputValue" --output text --region us-east-1)
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
    "GOOGLE_APPLICATION_CREDENTIALS_JSON": "{\"type\":\"service_account\",\"project_id\":\"your-project-id\",\"private_key\":\"-----BEGIN PRIVATE KEY-----\\nYOUR_PRIVATE_KEY\\n-----END PRIVATE KEY-----\\n\",\"client_email\":\"your-service-account@your-project.iam.gserviceaccount.com\",\"client_id\":\"client-id\",\"auth_uri\":\"https://accounts.google.com/o/oauth2/auth\",\"token_uri\":\"https://oauth2.googleapis.com/token\",\"auth_provider_x509_cert_url\":\"https://www.googleapis.com/oauth2/v1/certs\",\"client_x509_cert_url\":\"https://www.googleapis.com/robot/v1/metadata/x509/your-service-account%40your-project.iam.gserviceaccount.com\",\"universe_domain\":\"googleapis.com\"}"
  }' \
  --region us-east-1
```

## 環境変数

| 変数名 | 説明 | 必須 |
|-------|------|------|
| `ANTHROPIC_API_KEY` | Anthropic Claude APIのAPIキー | はい |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | Google Cloud JSONキー（音声合成用） | はい |
| `S3_BUCKET_NAME` | AWS Transcribeと一時ファイル保存用のS3バケット名 | はい |
| `AWS_REGION` | AWSリージョン | はい(デフォルト: us-east-1) |
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

### AWS Transcribeの問題

- S3バケットが設定されていない場合、音声認識は機能しません
- 処理に時間がかかる場合は、AWS Transcribeジョブのステータスを確認してください:
  ```bash
  aws transcribe get-transcription-job --transcription-job-name [JOB_NAME] --region us-east-1
  ```
- S3バケットへのアクセス権限が正しく設定されているか確認してください
- サポートされているファイル形式であることを確認してください
- S3バケットとTranscribeサービスが同じリージョン（通常はus-east-1）にあることを確認してください

### AWS認証情報の問題

認証情報やリージョンに関する問題が発生した場合は、以下を確認してください：

- AWS CLIが正しく設定されていること:
  ```bash
  aws configure list
  ```
- AWSプロファイルが正しいこと
- 環境変数 `AWS_REGION` が明示的に設定されていること
- AWS_PROFILE 環境変数が設定されている場合は、そのプロファイルのリージョン設定も確認

### 音声合成の問題

- Google Cloud認証情報が正しいかチェックしてください
- テキスト長が長すぎる場合は分割して処理する必要があるかもしれません
