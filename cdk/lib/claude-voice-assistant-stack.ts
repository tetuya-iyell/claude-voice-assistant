import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as path from 'path';
import { Construct } from 'constructs';

export class ClaudeVoiceAssistantStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC作成
    const vpc = new ec2.Vpc(this, 'ClaudeVoiceAssistantVPC', {
      maxAzs: 2,
      natGateways: 1,
    });

    // ECSクラスター作成
    const cluster = new ecs.Cluster(this, 'ClaudeVoiceAssistantCluster', {
      vpc,
      containerInsights: true,
    });

    // ECRリポジトリ作成
    const repository = new ecr.Repository(this, 'ClaudeVoiceAssistantRepo', {
      repositoryName: 'claude-voice-assistant',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          maxImageCount: 10,
          description: 'Keep only the last 10 images',
        },
      ],
    });

    // シークレットの作成
    const appSecrets = new secretsmanager.Secret(this, 'AppSecrets', {
      secretName: 'claude-voice-assistant-secrets',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          ANTHROPIC_API_KEY: '',
          GOOGLE_APPLICATION_CREDENTIALS_JSON: '',
        }),
        generateStringKey: 'password',
      },
    });

    // S3バケット作成 - 一時ファイル用
    const tempFilesBucket = new s3.Bucket(this, 'TempFilesBucket', {
      bucketName: `claude-voice-assistant-temp-files-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(1),
          id: 'DeleteAfterOneDay',
        },
      ],
    });

    // タスク実行ロールの作成
    const executionRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')
      ]
    });

    // タスクロールの作成
    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
    });

    // タスク定義
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'ClaudeVoiceAssistantTask', {
      memoryLimitMiB: 2048,
      cpu: 1024,
      executionRole: executionRole,
      taskRole: taskRole
    });

    // S3アクセス権限をタスクロールに付与
    tempFilesBucket.grantReadWrite(taskDefinition.taskRole);

    // CloudWatch Logs グループ
    const logGroup = new logs.LogGroup(this, 'ClaudeVoiceAssistantLogs', {
      logGroupName: '/ecs/claude-voice-assistant',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // シークレットマネージャーへのアクセス権をタスク実行ロールに付与
    appSecrets.grantRead(executionRole);

    // Transcribeサービス用のポリシーを追加
    const transcribePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'transcribe:StartTranscriptionJob',
        'transcribe:GetTranscriptionJob',
        'transcribe:ListTranscriptionJobs',
      ],
      resources: ['*'],  // Transcribeは特定のARNターゲットをサポートしていないため、*を使用
    });

    // タスクロールにTranscribeポリシーを追加
    taskDefinition.taskRole.addToPrincipalPolicy(transcribePolicy);

    // コンテナイメージをローカルのDockerfileからビルドするための設定
    const containerImage = ecs.ContainerImage.fromAsset(path.join(__dirname, '../../app'), {
      // 小さなイメージサイズと互換性の高い設定
      platform: cdk.aws_ecr_assets.Platform.LINUX_AMD64,
      buildArgs: {
        NODE_ENV: 'production',
      },
      // ビルドキャッシュを無効化
      invalidation: {
        buildArgs: true,
      },
    });

    // コンテナ定義
    const container = taskDefinition.addContainer('ClaudeVoiceAssistantContainer', {
      // イメージをリポジトリから参照するのではなく、ローカルからビルド
      image: containerImage,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'claude-voice-assistant',
        logGroup,
      }),
      environment: {
        NODE_ENV: 'production',
        S3_BUCKET_NAME: tempFilesBucket.bucketName,
        AWS_REGION: this.region,
      },
      secrets: {
        ANTHROPIC_API_KEY: ecs.Secret.fromSecretsManager(appSecrets, 'ANTHROPIC_API_KEY'),
        GOOGLE_APPLICATION_CREDENTIALS_JSON: ecs.Secret.fromSecretsManager(appSecrets, 'GOOGLE_APPLICATION_CREDENTIALS_JSON'),
      },
      portMappings: [
        {
          containerPort: 3000,
          hostPort: 3000,
          protocol: ecs.Protocol.TCP,
        },
      ],
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:3000/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10), // タイムアウトを増やす
        retries: 3,
        startPeriod: cdk.Duration.seconds(120), // 起動待機時間を増やす
      },
    });

    // ECSサービス作成
    const securityGroup = new ec2.SecurityGroup(this, 'ServiceSecurityGroup', {
      vpc,
      allowAllOutbound: true,
      description: 'Security group for Claude Voice Assistant service',
    });

    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(3000),
      'Allow HTTP traffic'
    );

    // Application Load Balancer
    const lb = new elbv2.ApplicationLoadBalancer(this, 'ClaudeVoiceAssistantLB', {
      vpc,
      internetFacing: true,
      securityGroup: securityGroup,
    });

    const listener = lb.addListener('HttpListener', {
      port: 80,
      open: true,
    });

    // ECSサービス
    const service = new ecs.FargateService(this, 'ClaudeVoiceAssistantService', {
      cluster,
      taskDefinition,
      desiredCount: 2,
      securityGroups: [securityGroup],
      assignPublicIp: false,
      healthCheckGracePeriod: cdk.Duration.seconds(180), // ヘルスチェックの猶予期間を長く設定
    });

    // ロードバランサーのターゲットとしてサービスを追加
    // プロトコルを明示的に指定
    listener.addTargets('ClaudeVoiceAssistantTarget', {
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyHttpCodes: '200',
      },
    });

    // Auto Scaling設定
    const scalableTarget = service.autoScaleTaskCount({
      minCapacity: 2,
      maxCapacity: 10,
    });

    scalableTarget.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    // 出力
    new cdk.CfnOutput(this, 'LoadBalancerDns', {
      value: lb.loadBalancerDnsName,
      description: 'The DNS name of the load balancer',
    });

    new cdk.CfnOutput(this, 'EcrRepositoryUri', {
      value: repository.repositoryUri,
      description: 'The URI of the ECR repository',
    });

    new cdk.CfnOutput(this, 'S3BucketName', {
      value: tempFilesBucket.bucketName,
      description: 'The name of the S3 bucket for temp files',
    });
  }
}