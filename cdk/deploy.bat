@echo off
REM Windows用デプロイスクリプト

REM リージョンを設定
set AWS_REGION=us-east-1

REM アカウントID取得
for /f "tokens=*" %%i in ('aws sts get-caller-identity --query "Account" --output text') do set ACCOUNT_ID=%%i
echo Using AWS Account: %ACCOUNT_ID%

REM ECRリポジトリが存在するか確認、なければ作成
set ECR_REPO_NAME=claude-voice-assistant
aws ecr describe-repositories --repository-names %ECR_REPO_NAME% --region %AWS_REGION% 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo Creating ECR repository...
  aws ecr create-repository --repository-name %ECR_REPO_NAME% --region %AWS_REGION%
)

REM ECRにログイン
echo Logging in to ECR...
for /f "tokens=*" %%i in ('aws ecr get-login-password --region %AWS_REGION%') do set ECR_PASSWORD=%%i
docker login --username AWS --password %ECR_PASSWORD% %ACCOUNT_ID%.dkr.ecr.%AWS_REGION%.amazonaws.com

REM appディレクトリに移動
cd ..\app

REM Dockerイメージをビルド
echo Building Docker image...
docker build -t %ECR_REPO_NAME% .

REM イメージにタグ付け
set ECR_REPO_URI=%ACCOUNT_ID%.dkr.ecr.%AWS_REGION%.amazonaws.com/%ECR_REPO_NAME%
docker tag %ECR_REPO_NAME%:latest %ECR_REPO_URI%:latest

REM ECRにプッシュ
echo Pushing image to ECR...
docker push %ECR_REPO_URI%:latest

REM CDKディレクトリに戻る
cd ..\cdk

REM cdk bootstrap実行 (必要に応じて)
echo Running cdk bootstrap...
call cdk bootstrap aws://%ACCOUNT_ID%/%AWS_REGION%

REM CDKデプロイ実行（assetイメージの作成をスキップ）
echo Running cdk deploy...
call cdk deploy --require-approval never --parameters ClaudeVoiceAssistantStack:ContainerImage=%ECR_REPO_URI%:latest

REM デプロイステータス確認
if %ERRORLEVEL% EQU 0 (
  echo Deployment completed successfully!
  
  REM ロードバランサーDNSを取得
  for /f "tokens=*" %%i in ('aws cloudformation describe-stacks --stack-name ClaudeVoiceAssistantStack --query "Stacks[0].Outputs[?OutputKey==''LoadBalancerDns''].OutputValue" --output text') do set LB_DNS=%%i
  
  if not "%LB_DNS%"=="" (
    echo Application is available at: http://%LB_DNS%
  )
) else (
  echo Deployment failed. Check the logs above for details.
)