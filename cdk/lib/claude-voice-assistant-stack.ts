import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as acm from 'aws-cdk-lib/aws-certificatemanager'; // ACMをインポート
import * as route53 from 'aws-cdk-lib/aws-route53'; // Route53をインポート (必要な場合)
import * as targets from 'aws-cdk-lib/aws-route53-targets'; // Route53ターゲットをインポート (必要な場合)
import * as path from 'path';
import { Construct } from 'constructs';

export class ClaudeVoiceAssistantStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // コンテナイメージURIのパラメータを定義
    const containerImageParam = new cdk.CfnParameter(this, 'ContainerImage', {
      type: 'String',
      description: 'The URI of the container image to deploy',
      default: `${this.account}.dkr.ecr.${this.region}.amazonaws.com/claude-voice-assistant:latest`
    });

    // ドメイン名パラメータ (オプション)
    const domainNameParam = new cdk.CfnParameter(this, 'DomainName', {
      type: 'String',
      description: 'Domain name for the application (optional)',
      default: '',
    });

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

    // 既存のECRリポジトリを参照する（作成しない）
    const repository = ecr.Repository.fromRepositoryName(
      this, 
      'ClaudeVoiceAssistantRepo',
      'claude-voice-assistant'
    );

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

    // コンテナ定義 - パラメータからイメージURIを使用
    const container = taskDefinition.addContainer('ClaudeVoiceAssistantContainer', {
      image: ecs.ContainerImage.fromRegistry(containerImageParam.valueAsString),
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

    // HTTPS用にポート443も開ける
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS traffic'
    );

    // Application Load Balancer
    const lb = new elbv2.ApplicationLoadBalancer(this, 'ClaudeVoiceAssistantLB', {
      vpc,
      internetFacing: true,
      securityGroup: securityGroup,
    });

    // ACM証明書の作成 - ドメイン名が指定されている場合のみ
    let certificate;
    const domainName = domainNameParam.valueAsString;
    
    // HTTPリスナー
    const httpListener = lb.addListener('HttpListener', {
      port: 80,
      open: true,
    });
    
    // HTTPSリスナーとターゲット
    let httpsListener;
    
    if (domainName && domainName !== '') {
      // カスタムドメインが指定されている場合は証明書を作成
      certificate = new acm.Certificate(this, 'Certificate', {
        domainName: domainName,
        validation: acm.CertificateValidation.fromDns(),
      });
      
      // HTTPSリスナーを追加
      httpsListener = lb.addListener('HttpsListener', {
        port: 443,
        certificates: [certificate],
        open: true,
      });
      
      // HTTPからHTTPSへリダイレクト
      httpListener.addAction('HttpToHttps', {
        action: elbv2.ListenerAction.redirect({
          port: '443',
          protocol: elbv2.ApplicationProtocol.HTTPS,
          permanent: true,
        }),
      });
    }

    // ECSサービス
    const service = new ecs.FargateService(this, 'ClaudeVoiceAssistantService', {
      cluster,
      taskDefinition,
      desiredCount: 2,
      securityGroups: [securityGroup],
      assignPublicIp: false,
      healthCheckGracePeriod: cdk.Duration.seconds(180), // ヘルスチェックの猶予期間を長く設定
    });

    // リスナーにターゲットを追加
    if (httpsListener) {
      // HTTPSリスナーが存在する場合はそこにターゲットを追加
      httpsListener.addTargets('ClaudeVoiceAssistantTarget', {
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
    } else {
      // HTTPSリスナーがない場合はHTTPリスナーにターゲットを追加
      httpListener.addTargets('ClaudeVoiceAssistantTarget', {
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
    }

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

    if (domainName && domainName !== '') {
      new cdk.CfnOutput(this, 'HttpsUrl', {
        value: `https://${domainName}`,
        description: 'The HTTPS URL of the application',
      });
    } else {
      new cdk.CfnOutput(this, 'HttpUrl', {
        value: `http://${lb.loadBalancerDnsName}`,
        description: 'The HTTP URL of the application',
      });
    }

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