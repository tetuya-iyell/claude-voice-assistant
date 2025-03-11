#!/bin/bash

# 実行権限を付与するには以下のコマンドを実行してください:
# chmod +x deploy.sh

# リージョンを設定
export AWS_REGION=us-east-1

# アカウントID取得
ACCOUNT_ID=$(aws sts get-caller-identity --query "Account" --output text)
echo "Using AWS Account: $ACCOUNT_ID"

# ECRにログイン
echo "Logging in to ECR..."
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

# cdk bootstrap実行 (必要に応じて)
echo "Running cdk bootstrap..."
cdk bootstrap aws://$ACCOUNT_ID/$AWS_REGION

# CDKデプロイ実行
echo "Running cdk deploy..."
cdk deploy

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
