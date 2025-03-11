document.addEventListener('DOMContentLoaded', () => {
    const micButton = document.getElementById('mic-button');
    const chatContainer = document.getElementById('chat-container');
    const statusElement = document.getElementById('status');
    
    // 録音関連の変数
    let mediaRecorder;
    let audioChunks = [];
    let isRecording = false;
    let conversationId = null;
    
    // オーディオコンテキスト（処理中か確認用）
    let audioContext = null;
    let isProcessing = false;
    
    // マイクボタンのクリックイベント
    micButton.addEventListener('click', () => {
        if (isProcessing) return;
        
        if (!isRecording) {
            startRecording();
        } else {
            stopRecording();
        }
    });
    
    // 録音開始関数
    async function startRecording() {
        try {
            // マイクへのアクセス要求
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            // MediaRecorderの初期化
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            
            // データが利用可能になったときのイベント
            mediaRecorder.addEventListener('dataavailable', event => {
                audioChunks.push(event.data);
            });
            
            // 録音停止時のイベント
            mediaRecorder.addEventListener('stop', () => {
                processRecording();
            });
            
            // 録音開始
            mediaRecorder.start();
            isRecording = true;
            micButton.classList.add('recording');
            statusElement.textContent = '録音中... クリックして停止';
        } catch (error) {
            console.error('録音の開始に失敗しました:', error);
            statusElement.textContent = 'マイクへのアクセスが許可されていません';
        }
    }
    
    // 録音停止関数
    function stopRecording() {
        if (mediaRecorder && isRecording) {
            mediaRecorder.stop();
            isRecording = false;
            micButton.classList.remove('recording');
            statusElement.textContent = '処理中...';
            
            // すべてのトラックを停止
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
    }
    
    // 録音の処理関数
    async function processRecording() {
        try {
            isProcessing = true;
            
            // 録音データをBlobに変換
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            
            // FormDataの作成
            const formData = new FormData();
            formData.append('audio', audioBlob);
            
            // 音声認識リクエスト
            statusElement.textContent = '音声認識中...';
            const transcriptionResponse = await fetch('/api/transcribe', {
                method: 'POST',
                body: formData
            });
            
            if (!transcriptionResponse.ok) {
                throw new Error('音声認識に失敗しました');
            }
            
            const transcriptionData = await transcriptionResponse.json();
            const transcribedText = transcriptionData.text;
            
            // 認識結果が空の場合
            if (!transcribedText || transcribedText.trim() === '') {
                statusElement.textContent = '音声を認識できませんでした。もう一度試してください。';
                isProcessing = false;
                return;
            }
            
            // ユーザーメッセージをチャットに表示
            addMessageToChat(transcribedText, 'user');
            
            // Claudeへのリクエスト
            statusElement.textContent = 'Claude処理中...';
            const chatResponse = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: transcribedText,
                    conversationId
                })
            });
            
            if (!chatResponse.ok) {
                throw new Error('Claudeからの応答の取得に失敗しました');
            }
            
            const chatData = await chatResponse.json();
            conversationId = chatData.conversationId;
            
            // アシスタントメッセージをチャットに表示
            addMessageToChat(chatData.text, 'assistant');
            
            // 音声合成リクエスト
            statusElement.textContent = '音声合成中...';
            const speechResponse = await fetch('/api/speech', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: chatData.text
                })
            });
            
            if (!speechResponse.ok) {
                throw new Error('音声合成に失敗しました');
            }
            
            // 音声再生
            const speechData = await speechResponse.json();
            
            if (speechData.url) {
                // 署名付きURLがある場合（S3を使用している場合）
                const audio = new Audio(speechData.url);
                
                // 再生完了時のイベント
                audio.onended = () => {
                    statusElement.textContent = '準備完了';
                    isProcessing = false;
                };
                
                // エラー時のイベント
                audio.onerror = (error) => {
                    console.error('音声再生エラー:', error);
                    statusElement.textContent = '音声再生に失敗しました';
                    isProcessing = false;
                };
                
                // 再生開始
                await audio.play();
            } else {
                // 直接音声データを受け取った場合
                const audioBlob = await speechResponse.blob();
                const audioUrl = URL.createObjectURL(audioBlob);
                const audio = new Audio(audioUrl);
                
                // 再生完了時のイベント
                audio.onended = () => {
                    URL.revokeObjectURL(audioUrl);
                    statusElement.textContent = '準備完了';
                    isProcessing = false;
                };
                
                // 再生開始
                await audio.play();
            }
            
        } catch (error) {
            console.error('処理エラー:', error);
            statusElement.textContent = 'エラーが発生しました: ' + error.message;
            isProcessing = false;
        }
    }
    
    // チャットにメッセージを追加する関数
    function addMessageToChat(text, sender) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', sender);
        
        const contentDiv = document.createElement('div');
        contentDiv.classList.add('message-content');
        contentDiv.textContent = text;
        
        messageDiv.appendChild(contentDiv);
        chatContainer.appendChild(messageDiv);
        
        // 自動スクロール
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
});