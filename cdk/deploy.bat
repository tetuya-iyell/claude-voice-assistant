@echo off
REM Windows用デプロイスクリプト

REM リージョンを設定
set AWS_REGION=us-east-1

REM アカウントID取得
for /f "tokens=*" %%i in ('aws sts get-caller-identity --query "Account" --output text') do set ACCOUNT_ID=%%i
echo Using AWS Account: %ACCOUNT_ID%

REM ECRにログイン
echo Logging in to ECR...
aws ecr get-login-password --region %AWS_REGION% | docker login --username AWS --password-stdin %ACCOUNT_ID%.dkr.ecr.%AWS_REGION%.amazonaws.com

REM cdk bootstrap実行 (必要に応じて)
echo Running cdk bootstrap...
call cdk bootstrap aws://%ACCOUNT_ID%/%AWS_REGION%

REM CDKデプロイ実行
echo Running cdk deploy...
call cdk deploy

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