const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const { Anthropic } = require('@anthropic-ai/sdk');
const { 
  S3Client, 
  PutObjectCommand, 
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');

// Google Cloud クライアントを条件付きで読み込む
let textToSpeech;
try {
  textToSpeech = require('@google-cloud/text-to-speech');
} catch (err) {
  console.log('Google Cloud Text-to-Speech not available');
}

// 環境変数のロード
dotenv.config();

// Express アプリの初期化
const app = express();
const PORT = process.env.PORT || 3000;

// タイムアウト設定を増やす (2分)
const TIMEOUT_MS = 120000;

// ミドルウェアの設定
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// AWS リージョン
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

// リクエストタイムアウトの設定
app.use((req, res, next) => {
  req.setTimeout(TIMEOUT_MS);
  res.setTimeout(TIMEOUT_MS);
  next();
});

// S3クライアントの初期化
const s3 = new S3Client({
  region: AWS_REGION,
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME;

// ローカルストレージかS3かを判定するフラグ
const useS3 = !!process.env.S3_BUCKET_NAME;

// クライアントの初期化
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Google Cloud Text-to-Speech クライアントの初期化
let ttsClient;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  try {
    // JSON文字列から認証情報を作成
    const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    ttsClient = new textToSpeech.TextToSpeechClient({ credentials });
  } catch (err) {
    console.error('Error initializing Google TTS client:', err);
  }
}

// 会話履歴保存用のオブジェクト
const conversations = {};

// ヘルスチェックエンドポイント
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// S3にファイルをアップロードする関数
async function uploadToS3(fileBuffer, contentType, key) {
  try {
    console.log(`Uploading to S3. Bucket: ${BUCKET_NAME}, Key: ${key}, Size: ${fileBuffer.length} bytes`);
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType,
    });

    await s3.send(command);
    console.log(`Upload successful: ${key}`);
    return key;
  } catch (error) {
    console.error('Error uploading to S3:', error);
    throw error;
  }
}

// AI応答生成エンドポイント
app.post('/api/chat', async (req, res) => {
  // タイムアウト設定
  req.setTimeout(TIMEOUT_MS);
  res.setTimeout(TIMEOUT_MS);
  
  try {
    const { message, conversationId } = req.body;
    
    // 入力値チェック
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Invalid message format' });
    }
    
    console.log(`Received message: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`);
    
    // 新しい会話かどうかをチェック
    if (!conversationId || !conversations[conversationId]) {
      // 新しい会話IDを生成
      const newConversationId = 'conv-' + uuidv4();
      console.log(`Creating new conversation: ${newConversationId}`);
      
      conversations[newConversationId] = {
        messages: [{ role: "user", content: message }]
      };
      
      // Claudeを使用してレスポンスを生成
      console.log('Sending request to Claude API...');
      const response = await anthropic.messages.create({
        model: "claude-3-7-sonnet-20250219",
        max_tokens: 1000,
        messages: conversations[newConversationId].messages,
        system: "あなたは親切で役立つAIアシスタントです。音声対話で使われるため、簡潔で明瞭な応答を心がけてください。"
      });
      
      // 応答を会話履歴に追加
      const assistantResponse = response.content[0].text;
      console.log(`Claude response: "${assistantResponse.substring(0, 50)}${assistantResponse.length > 50 ? '...' : ''}"`);
      
      conversations[newConversationId].messages.push({ 
        role: "assistant", 
        content: assistantResponse 
      });
      
      res.json({ 
        text: assistantResponse,
        conversationId: newConversationId
      });
    } else {
      // 既存の会話の場合
      console.log(`Continuing conversation: ${conversationId}`);
      
      // ユーザーメッセージを追加
      conversations[conversationId].messages.push({ 
        role: "user", 
        content: message 
      });
      
      // Claudeを使用してレスポンスを生成
      console.log('Sending request to Claude API...');
      const response = await anthropic.messages.create({
        model: "claude-3-7-sonnet-20250219",
        max_tokens: 1000,
        messages: conversations[conversationId].messages,
        system: "あなたは親切で役立つAIアシスタントです。音声対話で使われるため、簡潔で明瞭な応答を心がけてください。"
      });
      
      // 応答を会話履歴に追加
      const assistantResponse = response.content[0].text;
      console.log(`Claude response: "${assistantResponse.substring(0, 50)}${assistantResponse.length > 50 ? '...' : ''}"`);
      
      conversations[conversationId].messages.push({ 
        role: "assistant", 
        content: assistantResponse 
      });
      
      res.json({ 
        text: assistantResponse,
        conversationId: conversationId
      });
    }
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Failed to generate response: ' + (error.message || 'Unknown error') });
  }
});

// 音声合成エンドポイント
app.post('/api/speech', async (req, res) => {
  // タイムアウト設定
  req.setTimeout(TIMEOUT_MS);
  res.setTimeout(TIMEOUT_MS);
  
  try {
    const { text } = req.body;
    
    // 入力値チェック
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Invalid text format' });
    }
    
    console.log(`Synthesizing speech for text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
    
    // Google Text-to-Speechが利用可能かチェック
    if (!ttsClient) {
      return res.status(500).json({ error: 'Text-to-speech service not available' });
    }
    
    // Google Text-to-Speechリクエストの設定
    const request = {
      input: { text },
      voice: { languageCode: 'ja-JP', ssmlGender: 'NEUTRAL' },
      audioConfig: { audioEncoding: 'MP3' },
    };

    console.log('Sending request to Google TTS API...');
    // テキストを音声に変換
    const [response] = await ttsClient.synthesizeSpeech(request);
    console.log(`Speech synthesis successful, audio size: ${response.audioContent.length} bytes`);
    
    const outputFileName = `speech-${Date.now()}.mp3`;
    
    if (useS3) {
      // S3に音声ファイルをアップロード
      const s3Key = `temp/${outputFileName}`;
      await uploadToS3(response.audioContent, 'audio/mp3', s3Key);
      
      // 署名付きURLを生成（一時的なアクセス用）
      const command = {
        Bucket: BUCKET_NAME,
        Key: s3Key,
      };
      
      console.log('Generating signed URL...');
      const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
      
      // URLを返す
      res.json({ url: signedUrl });
      
      // 5分後にS3から削除するようにスケジュール
      setTimeout(async () => {
        try {
          const deleteCommand = new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: s3Key,
          });
          await s3.send(deleteCommand);
          console.log(`Deleted temporary file: ${s3Key}`);
        } catch (err) {
          console.error('Error deleting temporary file from S3:', err);
        }
      }, 5 * 60 * 1000);
    } else {
      // ローカルに一時的に音声ファイルを保存
      const tempDir = './temp';
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      const outputFile = path.join(tempDir, outputFileName);
      fs.writeFileSync(outputFile, response.audioContent, 'binary');
      
      // 音声ファイルを送信
      res.sendFile(path.resolve(outputFile), {}, (err) => {
        if (err) {
          console.error('Error sending file:', err);
        }
        // ファイル送信後に削除
        fs.unlinkSync(outputFile);
      });
    }
  } catch (error) {
    console.error('Speech synthesis error:', error);
    res.status(500).json({ error: 'Failed to synthesize speech: ' + (error.message || 'Unknown error') });
  }
});

// 一時ファイル用のディレクトリを作成
const tempDir = './temp';
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// サーバーの起動
const server = app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Using S3 for storage: ${useS3 ? 'Yes' : 'No'}`);
  if (useS3) {
    console.log(`S3 Bucket: ${BUCKET_NAME}, Region: ${AWS_REGION}`);
  }
  console.log(`Note: Using Web Speech API for client-side speech recognition`);
});

// サーバーのタイムアウト設定
server.timeout = TIMEOUT_MS;