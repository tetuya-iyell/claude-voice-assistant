# Claude Voice Assistant CDK Infrastructure

このディレクトリには、Claude APIを使用した音声会話アプリケーションをAWS環境にデプロイするためのAWS CDKコードが含まれています。

## 前提条件

- Node.js (バージョン18以上)
- AWS CLI (設定済み)
- AWS CDK CLI (`npm install -g aws-cdk`)

## セットアップ手順

```bash
# プロジェクトディレクトリに移動
cd cdk

# 依存関係のインストール
npm install

# CDKの初期化（初回のみ）
cdk bootstrap

# スタック内容の確認
cdk diff

# デプロイ
cdk deploy
```

## インフラストラクチャの構成

- VPC (プライベート/パブリックサブネット)
- ECS Fargate クラスター
- Application Load Balancer
- ECRリポジトリ
- SecretsManager (API認証情報の管理)
- S3バケット (一時ファイル保存用)
- CloudWatchログとアラート
- IAMロールとポリシー

## クリーンアップ

```bash
# リソースの削除
cdk destroy
```