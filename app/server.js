const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Anthropic } = require('@anthropic-ai/sdk');
const { 
  S3Client, 
  PutObjectCommand, 
  GetObjectCommand, 
  DeleteObjectCommand 
} = require('@aws-sdk/client-s3');
const { 
  TranscribeClient, 
  StartTranscriptionJobCommand, 
  GetTranscriptionJobCommand 
} = require('@aws-sdk/client-transcribe');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');
const { PassThrough } = require('stream');

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

// ミドルウェアの設定
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// AWS リージョン
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

// S3クライアントの初期化
const s3 = new S3Client({
  region: AWS_REGION,
});

// Transcribeクライアントの初期化
const transcribeClient = new TranscribeClient({
  region: AWS_REGION,
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME;

// ローカルストレージかS3かを判定するフラグ
const useS3 = !!process.env.S3_BUCKET_NAME;

// 一時ファイル保存用のストレージ設定
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = './uploads';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `audio-${Date.now()}${path.extname(file.originalname)}`);
  }
});
const upload = multer({ storage });

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
    console.log(`Uploading to S3. Bucket: ${BUCKET_NAME}, Key: ${key}`);
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

// S3からファイルをダウンロードする関数
async function getFileFromS3(key) {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  const response = await s3.send(command);
  return response.Body;
}

// S3からファイルを取得してBufferに変換する関数
async function getBufferFromS3(key) {
  const fileStream = await getFileFromS3(key);
  return new Promise((resolve, reject) => {
    const chunks = [];
    fileStream.on('data', (chunk) => chunks.push(chunk));
    fileStream.on('error', reject);
    fileStream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

// AWS Transcribeジョブのステータスを確認する関数
async function checkTranscriptionJobStatus(jobName) {
  const command = new GetTranscriptionJobCommand({
    TranscriptionJobName: jobName,
  });

  try {
    const response = await transcribeClient.send(command);
    return response.TranscriptionJob;
  } catch (error) {
    console.error('Error checking transcription job status:', error);
    throw error;
  }
}

// 音声認識ジョブの結果を取得する関数
async function getTranscriptionResult(transcriptFileUri) {
  try {
    // URIからS3パスを解析
    const url = new URL(transcriptFileUri);
    const bucket = url.hostname.split('.')[0];
    const key = url.pathname.substring(1); // 先頭の/を削除
    
    console.log(`Getting transcription result. Bucket: ${bucket}, Key: ${key}`);
    
    // S3からJSONファイルを取得
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    
    const response = await s3.send(command);
    
    // レスポンスをテキストに変換
    const responseBody = await new Promise((resolve, reject) => {
      const chunks = [];
      response.Body.on('data', (chunk) => chunks.push(chunk));
      response.Body.on('error', reject);
      response.Body.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    });
    
    // JSONをパース
    const transcriptData = JSON.parse(responseBody);
    
    // トランスクリプションテキストを返す
    return transcriptData.results.transcripts[0].transcript;
  } catch (error) {
    console.error('Error getting transcription result:', error);
    throw error;
  }
}

// 音声認識エンドポイント
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  try {
    // 音声ファイルが存在しない場合はエラー
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    console.log(`Processing audio file: ${req.file.path}, size: ${req.file.size} bytes`);

    // 一意のジョブ名を生成
    const jobName = `transcribe-job-${Date.now()}-${uuidv4().substring(0, 8)}`;
    let s3Key;

    if (useS3) {
      // ファイル拡張子を確認（.wav ファイルが必要）
      const fileExt = path.extname(req.file.path).toLowerCase();
      if (fileExt !== '.wav' && fileExt !== '.mp3') {
        return res.status(400).json({ error: 'Audio file must be .wav or .mp3 format' });
      }

      // ファイルをS3にアップロード
      s3Key = `uploads/audio-${Date.now()}${fileExt}`;
      console.log(`Reading file from ${req.file.path} for upload to S3`);
      const fileBuffer = fs.readFileSync(req.file.path);
      
      await uploadToS3(
        fileBuffer, 
        fileExt === '.wav' ? 'audio/wav' : 'audio/mp3', 
        s3Key
      );
      
      // S3 URLを作成
      const s3Uri = `s3://${BUCKET_NAME}/${s3Key}`;
      console.log(`S3 URI for transcription: ${s3Uri}`);
      
      // ファイル形式を取得
      const mediaFormat = fileExt.substring(1); // .wavから先頭の.を削除

      console.log(`Starting transcription job: ${jobName}, format: ${mediaFormat}`);
      
      // Transcribeジョブを開始
      const startCommand = new StartTranscriptionJobCommand({
        TranscriptionJobName: jobName,
        LanguageCode: 'ja-JP', // 日本語を指定
        MediaFormat: mediaFormat,
        Media: {
          MediaFileUri: s3Uri,
        },
        OutputBucketName: BUCKET_NAME,
        OutputKey: `transcripts/${jobName}.json`,
      });
      
      console.log('Sending transcription job command');
      await transcribeClient.send(startCommand);
      console.log('Transcription job started');
      
      // ジョブが完了するまで待機
      let job;
      let status;
      let attempts = 0;
      const maxAttempts = 30; // 最大30回試行（約30秒）
      
      do {
        attempts++;
        console.log(`Checking job status, attempt ${attempts}/${maxAttempts}`);
        
        try {
          job = await checkTranscriptionJobStatus(jobName);
          status = job.TranscriptionJobStatus;
          
          console.log(`Transcription job status: ${status}`);
          
          if (status === 'FAILED') {
            console.error(`Transcription job failed: ${job.FailureReason}`);
            throw new Error(`Transcription job failed: ${job.FailureReason}`);
          }
          
          if (status !== 'COMPLETED') {
            // 1秒待機してから再確認
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch (statusError) {
          console.error('Error checking job status:', statusError);
          if (attempts >= maxAttempts) {
            throw new Error('Transcription timeout: Job status check failed too many times');
          }
          // エラーが発生しても続行（一時的なネットワークエラーなどの可能性）
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } while (status !== 'COMPLETED' && attempts < maxAttempts);
      
      if (status !== 'COMPLETED') {
        throw new Error('Transcription timeout: Job did not complete in the allowed time');
      }
      
      console.log('Transcription job completed successfully');
      
      // トランスクリプション結果を取得
      console.log(`Getting result from ${job.Transcript.TranscriptFileUri}`);
      const transcriptionText = await getTranscriptionResult(job.Transcript.TranscriptFileUri);
      console.log(`Transcription result: ${transcriptionText}`);
      
      // ローカルの一時ファイルを削除
      fs.unlinkSync(req.file.path);
      console.log(`Deleted temporary file: ${req.file.path}`);
      
      res.json({ text: transcriptionText });
    } else {
      // S3が使用できない場合はサポートされていないことを通知
      res.status(501).json({ 
        error: 'AWS Transcribe requires S3 bucket. Please set S3_BUCKET_NAME environment variable.' 
      });
    }
  } catch (error) {
    console.error('Transcription error:', error);
    // ファイルのクリーンアップを試みる
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
      console.log(`Deleted temporary file after error: ${req.file.path}`);
    }
    res.status(500).json({ error: 'Failed to transcribe audio: ' + error.message });
  }
});

// AI応答生成エンドポイント
app.post('/api/chat', async (req, res) => {
  try {
    const { message, conversationId } = req.body;
    
    // 新しい会話かどうかをチェック
    if (!conversationId || !conversations[conversationId]) {
      // 新しい会話IDを生成
      const newConversationId = 'conv-' + uuidv4();
      conversations[newConversationId] = {
        messages: [{ role: "user", content: message }]
      };
      
      // Claudeを使用してレスポンスを生成
      const response = await anthropic.messages.create({
        model: "claude-3-7-sonnet-20250219",
        max_tokens: 1000,
        messages: conversations[newConversationId].messages,
        system: "あなたは親切で役立つAIアシスタントです。音声対話で使われるため、簡潔で明瞭な応答を心がけてください。"
      });
      
      // 応答を会話履歴に追加
      conversations[newConversationId].messages.push({ 
        role: "assistant", 
        content: response.content[0].text 
      });
      
      res.json({ 
        text: response.content[0].text,
        conversationId: newConversationId
      });
    } else {
      // 既存の会話の場合
      // ユーザーメッセージを追加
      conversations[conversationId].messages.push({ 
        role: "user", 
        content: message 
      });
      
      // Claudeを使用してレスポンスを生成
      const response = await anthropic.messages.create({
        model: "claude-3-7-sonnet-20250219",
        max_tokens: 1000,
        messages: conversations[conversationId].messages,
        system: "あなたは親切で役立つAIアシスタントです。音声対話で使われるため、簡潔で明瞭な応答を心がけてください。"
      });
      
      // 応答を会話履歴に追加
      conversations[conversationId].messages.push({ 
        role: "assistant", 
        content: response.content[0].text 
      });
      
      res.json({ 
        text: response.content[0].text,
        conversationId: conversationId
      });
    }
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Failed to generate response' });
  }
});

// 音声合成エンドポイント
app.post('/api/speech', async (req, res) => {
  try {
    const { text } = req.body;
    
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

    // テキストを音声に変換
    const [response] = await ttsClient.synthesizeSpeech(request);
    
    const outputFileName = `speech-${Date.now()}.mp3`;
    
    if (useS3) {
      // S3に音声ファイルをアップロード
      const s3Key = `temp/${outputFileName}`;
      await uploadToS3(response.audioContent, 'audio/mp3', s3Key);
      
      // 署名付きURLを生成（一時的なアクセス用）
      const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
      });
      
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
      const outputFile = path.join('./temp', outputFileName);
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
    res.status(500).json({ error: 'Failed to synthesize speech' });
  }
});

// 一時ファイル用のディレクトリを作成
const tempDir = './temp';
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

const uploadsDir = './uploads';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// サーバーの起動
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Using S3 for storage: ${useS3 ? 'Yes' : 'No'}`);
  if (useS3) {
    console.log(`S3 Bucket: ${BUCKET_NAME}, Region: ${AWS_REGION}`);
  }
});