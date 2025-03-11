#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ClaudeVoiceAssistantStack } from '../lib/claude-voice-assistant-stack';

const app = new cdk.App();
new ClaudeVoiceAssistantStack(app, 'ClaudeVoiceAssistantStack', {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1' 
  },
});

app.synth();