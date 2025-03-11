#!/bin/bash

# 実行権限を付与するには以下のコマンドを実行してください:
# chmod +x deploy.sh

# リージョンを設定
export AWS_REGION=us-east-1

# アカウントID取得
ACCOUNT_ID=$(aws sts get-caller-identity --query "Account" --output text)
echo "Using AWS Account: $ACCOUNT_ID"

# ECRリポジトリが存在するか確認、なければ作成
ECR_REPO_NAME="claude-voice-assistant"
ECR_REPO_EXISTS=$(aws ecr describe-repositories --repository-names $ECR_REPO_NAME --region $AWS_REGION 2>/dev/null || echo "not_exists")

if [ "$ECR_REPO_EXISTS" = "not_exists" ]; then
  echo "Creating ECR repository..."
  aws ecr create-repository --repository-name $ECR_REPO_NAME --region $AWS_REGION
fi

# ECRにログイン
echo "Logging in to ECR..."
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

# appディレクトリに移動
cd ../app

# Dockerイメージをビルド
echo "Building Docker image..."
docker build -t $ECR_REPO_NAME .

# イメージにタグ付け
ECR_REPO_URI="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO_NAME"
docker tag $ECR_REPO_NAME:latest $ECR_REPO_URI:latest

# ECRにプッシュ
echo "Pushing image to ECR..."
docker push $ECR_REPO_URI:latest

# CDKディレクトリに戻る
cd ../cdk

# cdk bootstrap実行 (必要に応じて)
echo "Running cdk bootstrap..."
cdk bootstrap aws://$ACCOUNT_ID/$AWS_REGION

# CDKデプロイ実行（assetイメージの作成をスキップ）
echo "Running cdk deploy..."
cdk deploy --require-approval never \
  --parameters ClaudeVoiceAssistantStack:ContainerImage=$ECR_REPO_URI:latest

# デプロイステータス確認
if [ $? -eq 0 ]; then
  echo "Deployment completed successfully!"
  
  # ロードバランサーDNSを取得
  LB_DNS=$(aws cloudformation describe-stacks --stack-name ClaudeVoiceAssistantStack --query "Stacks[0].Outputs[?OutputKey=='LoadBalancerDns'].OutputValue" --output text)
  
  if [ ! -z "$LB_DNS" ]; then
    echo "Application is available at: http://$LB_DNS"
  fi
else
  echo "Deployment failed. Check the logs above for details."
fi