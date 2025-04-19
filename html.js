// html.js の先頭あたり
const { API_KEY, CLIENT_ID } = window.appConfig || {};
if (!API_KEY || !CLIENT_ID) {
  console.error('config.js から API_KEY/CLIENT_ID が読み込めませんでした');
}


document.addEventListener('DOMContentLoaded', function() {
    // DOM要素
    const audioPlayer = document.getElementById('audio-player');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const stopBtn = document.getElementById('stop-btn');
    const muteBtn = document.getElementById('mute-btn');
    const volumeSlider = document.getElementById('volume-slider');
    const currentTimeDisplay = document.getElementById('current-time');
    const durationDisplay = document.getElementById('duration');
    const FIXED_FOLDER_ID = window.appConfig.FIXED_FOLDER_ID;;
    const loadFilesBtn = document.getElementById('load-files-btn');
    const toggleLoopBtn = document.getElementById('toggle-loop-btn');
    const fileListContainer = document.getElementById('file-list');
    const clearPlaylistBtn = document.getElementById('clear-playlist-btn');
    const playlistContainer = document.getElementById('playlist-container');
    const errorContainer = document.getElementById('error-container');

    // プレイヤーの状態
    let isLooping = false;
    let playlist = [];
    let currentPlaylistIndex = -1;
    let isPlaying = false;
    let audioFiles = [];
    let isApiInitialized = false;
    let lastFolderId = '';

    function ensureTokenValid(next) {
      const t = gapi.client.getToken();
      const willExpireSoon = t && t.expires_at && (t.expires_at - Date.now() < 60_000);

      if (!t || !t.access_token || willExpireSoon) {
                // トークンが無い or ほぼ期限切れ => ポップアップ or silent で取得し、
                // 取得後に next() の戻り値を resolve する Promise を返す
                return new Promise(resolve => {
                tokenClient.requestAccessToken({
                    prompt: '', // '' で silent refresh、'consent' で必ずポップアップ
                    callback: () => resolve(next())
                });
                });
        } else {
                // トークン有効なら next() の戻り値をそのまま返す
                return next();
        }
    }

    // Google API設定
    const API_KEY = window.appConfig.API_KEY; // Google Cloud ConsoleでAPIキーを取得して設定してください
    const CLIENT_ID = window.appConfig.CLIENT_ID;
    const DISCOVERY_DOCS = ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'];
    const SCOPES = 'https://www.googleapis.com/auth/drive.readonly';

    // エラーメッセージを表示する関数
    function showError(title, message, details = null, errorCode = null, retryFunction = null) {
        // 既存のエラーメッセージをクリア
        errorContainer.innerHTML = '';
        
        // エラーメッセージ要素を作成
        const errorElement = document.createElement('div');
        errorElement.className = 'error-message';
        
        // エラータイトルと説明
        let errorHTML = `<h3>エラー: ${title}</h3><p>${message}</p>`;
        
        // 詳細情報がある場合は追加
        if (details) {
            if (Array.isArray(details)) {
                errorHTML += '<ul>';
                details.forEach(detail => {
                    errorHTML += `<li>${detail}</li>`;
                });
                errorHTML += '</ul>';
            } else {
                errorHTML += `<p>${details}</p>`;
            }
        }
        
        // エラーコードがある場合は追加
        if (errorCode) {
            errorHTML += `<p>エラーコード: <span class="error-code">${errorCode}</span></p>`;
        }
        
        // 再試行ボタンがある場合は追加
        if (retryFunction) {
            errorHTML += '<button class="retry-button">再試行</button>';
        }
        
        errorElement.innerHTML = errorHTML;
        
        // 再試行ボタンのイベントリスナーを追加
        if (retryFunction) {
            errorElement.querySelector('.retry-button').addEventListener('click', () => {
                errorContainer.innerHTML = '';
                retryFunction();
            });
        }
        
        // エラーメッセージを表示
        errorContainer.appendChild(errorElement);
        
        // エラーメッセージまでスクロール
        errorContainer.scrollIntoView({ behavior: 'smooth' });
    }

    // エラーメッセージをクリアする関数
    function clearError() {
        errorContainer.innerHTML = '';
    }

    async function testFetchPlayback(fileId) {
        const tokenObj = gapi.client.getToken();
        if (!tokenObj || !tokenObj.access_token) {
            console.error('No access token');
            return;
        }
        const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
        try {
            const resp = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${tokenObj.access_token}`
            }
            });
            console.log('Fetch status:', resp.status, resp.headers.get('Content-Type'));
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const blob = await resp.blob();
            const objUrl = URL.createObjectURL(blob);
            audioPlayer.src = objUrl;
            await audioPlayer.play();
            console.log('再生 OK via fetch+blob');
        } catch (e) {
            console.error('fetch playback error', e);
        }
    }
    window.testFetchPlayback = testFetchPlayback;


    // プレイヤーの初期化
    function initPlayer() {
        // オーディオ要素のイベントリスナー設定
        audioPlayer.addEventListener('timeupdate', updateTimeDisplay);
        audioPlayer.addEventListener('loadedmetadata', updateDurationDisplay);
        audioPlayer.addEventListener('ended', handleAudioEnded);
        audioPlayer.addEventListener('play', () => {
            playPauseBtn.textContent = '一時停止';
            isPlaying = true;
        });
        audioPlayer.addEventListener('pause', () => {
            playPauseBtn.textContent = '再生';
            isPlaying = false;
        });
        
        // オーディオエラーイベントリスナー
        audioPlayer.addEventListener('error', (e) => {
            const errorMessages = {
                1: 'メディアの読み込みが中止されました',
                2: 'ネットワークエラーが発生しました',
                3: 'デコードエラーが発生しました',
                4: 'メディア形式がサポートされていません'
            };
            
            const errorCode = audioPlayer.error ? audioPlayer.error.code : 0;
            const errorMessage = errorMessages[errorCode] || '不明なエラーが発生しました';
            
            showError(
                '音声ファイルの再生エラー', 
                errorMessage,
                '再生中のファイルにアクセスできないか、形式が正しくない可能性があります。',
                `MEDIA_ERR_${errorCode}`,
                () => {
                    // 現在のプレイリストアイテムを再試行
                    if (currentPlaylistIndex >= 0 && currentPlaylistIndex < playlist.length) {
                        playPlaylistItem(currentPlaylistIndex);
                    }
                }
            );
        });

        // コントロールボタンの設定
        playPauseBtn.addEventListener('click', togglePlayPause);
        stopBtn.addEventListener('click', stopAudio);
        muteBtn.addEventListener('click', toggleMute);
        volumeSlider.addEventListener('input', changeVolume);
        loadFilesBtn.addEventListener('click', handleLoadFilesClick);
        toggleLoopBtn.addEventListener('click', toggleLoop);
        clearPlaylistBtn.addEventListener('click', clearPlaylist);

        // 初期ボリューム設定
        audioPlayer.volume = volumeSlider.value;

        // Google APIの初期化
        initGoogleAPI();
    }

    // Google APIの初期化
    function initGoogleAPI() {
        // APIの読み込みを確認
        if (!window.gapi) {
            showError(
                'Google APIの読み込みエラー',
                'Google APIが正しく読み込まれませんでした。',
                [
                    'インターネット接続を確認してください。',
                    'ブラウザのアドブロッカーを無効にしてみてください。',
                    'ページを再読み込みしてください。'
                ],
                'GAPI_LOAD_ERROR',
                () => window.location.reload()
            );
            return;
        }
        
        // ローディング表示
        loadFilesBtn.disabled = true;
        loadFilesBtn.textContent = 'APIを初期化中...';
        
        // タイムアウト設定
        const apiInitTimeout = setTimeout(() => {
            loadFilesBtn.disabled = false;
            showError(
                'Google APIの初期化タイムアウト',
                'Google APIの初期化に時間がかかりすぎています。',
                [
                    'インターネット接続を確認してください。',
                    'Google APIが利用可能か確認してください。',
                    'ブラウザのキャッシュをクリアしてみてください。'
                ],
                'API_INIT_TIMEOUT',
                initGoogleAPI
            );
        }, 20000); // 20秒のタイムアウト
        
        gapi.load('client', () => {
                            clearTimeout(apiInitTimeout);

        gapi.client.init({
            apiKey: API_KEY,
            discoveryDocs: DISCOVERY_DOCS        // scope と clientId は不要
        }).then(() => {
            console.log('gapi client initialized');
            isApiInitialized = true;

            /* ── GIS トークンクライアントを初期化 ── */
            tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,                     // 例: 'https://www.googleapis.com/auth/drive.readonly'
            callback: (resp) => {
                if (resp.error) {
                showError(
                    'トークン取得エラー',
                    resp.error,
                    'Google認証でアクセスを許可してください。',
                    'TOKEN_ERROR'
                );
                return;
                }
                /* 取得したアクセストークンを gapi にセット */
                gapi.client.setToken({ access_token: resp.access_token });
                updateSigninStatus(true);        // サインイン完了として処理
                clearError();
            }
            });

            /* 初期状態を「未サインイン」として UI 更新 */
            updateSigninStatus(false);
            // 認証済みならすぐファイルをロード
            tokenClient.requestAccessToken({ prompt: '' });
            clearError();

        }).catch(error => {
            console.error('Error initializing Google API', error);
            loadFilesBtn.disabled = false;

            /* ↓↓↓ ここから下は元の catch 内のエラー解析ロジックを そのまま残す ↓↓↓ */
            let errorMessage = 'Google APIの初期化に失敗しました。';
            let errorDetails = [];
            let errorCode = 'API_INIT_ERROR';

            if (error.message && error.message.includes('API key')) {
            errorMessage = 'APIキーが無効です。';
            errorDetails = [
                'APIキーが正しく設定されているか確認してください。',
                'Google Cloud ConsoleでAPIキーの制限を確認してください。',
                'このドメインからのアクセスが許可されているか確認してください。'
            ];
            errorCode = 'INVALID_API_KEY';
            }

            showError(
            errorMessage,
            error.details || error.message || '詳細なエラー情報がありません。',
            errorDetails,
            errorCode,
            initGoogleAPI
            );
            /* ↑↑↑ もともとの catch 内コードは必要に応じて調整してください ↑↑↑ */
        });
        });
    }

    // 認証状態の更新
    function updateSigninStatus(isSignedIn) {
        loadFilesBtn.disabled = false;
        
        if (isSignedIn) {
            loadFilesBtn.textContent = 'ファイル一覧を取得';
            loadFilesBtn.onclick = loadGoogleDriveFiles;
            clearError(); // 認証成功したらエラーをクリア
        } else {
            loadFilesBtn.textContent = 'Googleにサインイン';
            loadFilesBtn.onclick = handleAuthClick;
        }
    }

    // 認証クリックハンドラ
    function handleAuthClick() {
        if (!isApiInitialized) {
            showError(
                'APIが初期化されていません',
                'Google APIがまだ初期化されていません。',
                'ページを再読み込みしてから再試行してください。',
                'API_NOT_INITIALIZED',
                () => window.location.reload()
            );
            return;
        }
        
        /* ───── 置換ブロック（GIS 版）───── */
        try {
        tokenClient.requestAccessToken({
            prompt: 'consent',          // 毎回アカウント選択ポップアップ
            callback: (resp) => {
            if (resp.error) {
                console.error('Auth error', resp);

                let errorMessage = 'Google認証に失敗しました。';
                let errorDetails = [];
                let errorCode = 'AUTH_ERROR';

                // GIS の代表的なエラーコード
                switch (resp.error) {
                case 'popup_window_error':           // ポップアップを開けない（ブロック）
                    errorMessage = '認証ポップアップがブロックされました。';
                    errorDetails = [
                    'ブラウザのポップアップブロッカーを無効にしてください。',
                    'このサイトのポップアップを許可してください。'
                    ];
                    errorCode = 'POPUP_BLOCKED';
                    break;

                case 'access_denied':                // アクセス拒否
                    errorMessage = 'アクセスが拒否されました。';
                    errorDetails = [
                    'Google認証でアクセスを許可してください。',
                    '別のGoogleアカウントでログインしてみてください。'
                    ];
                    errorCode = 'ACCESS_DENIED';
                    break;

                case 'user_cancel':                  // ユーザーがポップアップを閉じた
                    errorMessage = '認証ポップアップが閉じられました。';
                    errorDetails = [
                    '認証プロセスを完了するために、ポップアップを閉じないでください。'
                    ];
                    errorCode = 'POPUP_CLOSED';
                    break;
                }

                showError(
                errorMessage,
                resp.error_description || '詳細なエラー情報がありません。',
                errorDetails,
                errorCode,
                () => tokenClient.requestAccessToken({ prompt: 'consent' })
                );
                return;
            }

            /* ------- 認証成功時の処理 ------- */
            gapi.client.setToken({ access_token: resp.access_token });
            clearError();
            updateSigninStatus(true);     // サインイン状態を true として UI 更新
            }
        });
        } catch (err) {
        console.error('Unexpected auth error', err);
        showError(
            '予期しない認証エラー',
            err.message || '不明なエラーが発生しました。',
            'ブラウザを更新して再試行してください。',
            'UNEXPECTED_AUTH_ERROR',
            () => window.location.reload()
        );
        }
        /* ───── 置換ブロック ここまで ───── */

    }

    // ロードボタンクリックハンドラ
    function handleLoadFilesClick() {
        clearError(); // エラーをクリア
        
        if (!isApiInitialized) {
            showError(
                'APIが初期化されていません',
                'Google APIがまだ初期化されていません。',
                'ページを再読み込みしてから再試行してください。',
                'API_NOT_INITIALIZED',
                () => window.location.reload()
            );
            return;
        }
        
        if (gapi.client.getToken() && gapi.client.getToken().access_token) {
        // すでにアクセストークンを持っている
        loadGoogleDriveFiles();
        } else {
        // トークンを取得（ポップアップ）
        tokenClient.requestAccessToken({ prompt: 'consent' });
        }
    }

    // Google Driveからファイル一覧を取得
    function loadGoogleDriveFiles() {
        const folderId = folderIdInput.value.trim() || FIXED_FOLDER_ID;
        
        if (!folderId) {
            showError(
                'フォルダIDが未入力',
                'Google DriveフォルダIDを入力してください。',
                'フォルダIDはGoogle DriveのフォルダURLから取得できます。',
                'EMPTY_FOLDER_ID'
            );
            return;
        }
        
        // 前回と同じフォルダIDの場合はキャッシュを使用
        if (folderId === lastFolderId && audioFiles.length > 0) {
            updateFileListUI(audioFiles);
            return;
        }
        
        lastFolderId = folderId;
        
        // ローディング表示
        fileListContainer.innerHTML = `
            <div class="loading">
                <div class="spinner"></div>
                <p>ファイル一覧を読み込み中...</p>
            </div>
        `;
        
        // ボタンを無効化
        loadFilesBtn.disabled = true;
        loadFilesBtn.textContent = '読み込み中...';
        
        // ファイル一覧を格納する配列
        audioFiles = [];
        
        // タイムアウト設定
        const fetchTimeout = setTimeout(() => {
            loadFilesBtn.disabled = false;
            loadFilesBtn.textContent = 'ファイル一覧を取得';
            
            showError(
                'ファイル一覧の取得タイムアウト',
                'ファイル一覧の取得に時間がかかりすぎています。',
                [
                    'インターネット接続を確認してください。',
                    'フォルダIDが正しいか確認してください。',
                    'フォルダ内のファイル数が多すぎないか確認してください。'
                ],
                'FETCH_TIMEOUT',
                loadGoogleDriveFiles
            );
        }, 60000); // 60秒のタイムアウト
        
        // ページネーションを使用してファイルを取得する関数
        fetchFilesWithPagination(folderId, null, fetchTimeout);
    }

    // ページネーションを使用してファイルを取得する関数を追加
    function fetchFilesWithPagination(folderId, pageToken = null, timeoutId = null) {
        // リクエストパラメータ
        const params = {
            q: `'${folderId}' in parents and (mimeType contains 'audio/')`,
            fields: 'nextPageToken, files(id, name, mimeType)',
            pageSize: 100, // 一度に取得するファイル数を制限
            orderBy: 'name'
        };
        
        // ページトークンがある場合は追加
        if (pageToken) {
            params.pageToken = pageToken;
        }
        
        // Google Drive APIを呼び出し
        gapi.client.drive.files.list(params)
            .then(response => {
                const result = response.result;
                const files = result.files || [];
                
                // 取得したファイルを配列に追加
                audioFiles = audioFiles.concat(files);
                
                // 進捗状況を表示
                fileListContainer.innerHTML = `
                    <div class="loading">
                        <div class="spinner"></div>
                        <p>ファイル一覧を読み込み中... (${audioFiles.length}件取得済み)</p>
                    </div>
                `;
                
                // 次のページがある場合は再帰的に呼び出し
                if (result.nextPageToken) {
                    // 少し遅延を入れてAPIの制限に引っかからないようにする
                    setTimeout(() => {
                        fetchFilesWithPagination(folderId, result.nextPageToken, timeoutId);
                    }, 300);
                } else {
                    // すべてのファイルを取得完了
                    if (timeoutId) clearTimeout(timeoutId);
                    loadFilesBtn.disabled = false;
                    loadFilesBtn.textContent = 'ファイル一覧を取得';
                    
                    if (audioFiles.length > 0) {
                        updateFileListUI(audioFiles);
                        clearError(); // 成功したらエラーをクリア
                    } else {
                        fileListContainer.innerHTML = '<div class="empty-list">フォルダ内に音声ファイルが見つかりませんでした。</div>';
                        showError(
                            'ファイルが見つかりません',
                            '指定されたフォルダ内に音声ファイルが見つかりませんでした。',
                            [
                                'フォルダIDが正しいか確認してください。',
                                'フォルダ内に音声ファイルが存在するか確認してください。',
                                'フォルダへのアクセス権があるか確認してください。'
                            ],
                            'NO_FILES_FOUND'
                        );
                    }
                }
            })
            .catch(error => {
                console.error('Error loading files', error);
                if (timeoutId) clearTimeout(timeoutId);
                loadFilesBtn.disabled = false;
                loadFilesBtn.textContent = 'ファイル一覧を取得';
                
                let errorMessage = 'ファイル一覧の取得に失敗しました。';
                let errorDetails = [];
                let errorCode = 'FILE_LIST_ERROR';
                
                if (error.status === 404) {
                    errorMessage = 'フォルダが見つかりません。';
                    errorDetails = [
                        'フォルダIDが正しいか確認してください。',
                        'フォルダが削除されていないか確認してください。'
                    ];
                    errorCode = 'FOLDER_NOT_FOUND';
                } else if (error.status === 403) {
                    errorMessage = 'フォルダへのアクセスが拒否されました。';
                    errorDetails = [
                        'フォルダへのアクセス権があるか確認してください。',
                        '別のGoogleアカウントでログインしてみてください。'
                    ];
                    errorCode = 'ACCESS_DENIED';
                } else if (error.status === 401) {
                    errorMessage = '認証エラーが発生しました。';
                    errorDetails = [
                        '再度ログインしてください。',
                        'APIキーとクライアントIDが正しいか確認してください。'
                    ];
                    errorCode = 'AUTH_ERROR';
                } else if (error.message && error.message.includes('API key')) {
                    errorMessage = 'APIキーが無効です。';
                    errorDetails = [
                        'APIキーが正しく設定されているか確認してください。',
                        'Google Cloud ConsoleでAPIキーの制限を確認してください。'
                    ];
                    errorCode = 'INVALID_API_KEY';
                }
                
                fileListContainer.innerHTML = '<div class="empty-list">ファイル一覧の取得に失敗しました。</div>';
                
                showError(
                    errorMessage,
                    error.result ? error.result.error.message : (error.message || '詳細なエラー情報がありません。'),
                    errorDetails,
                    errorCode,
                    loadGoogleDriveFiles
                );
            });
    }

    // ファイル一覧UIの更新
    function updateFileListUI(files) {
        fileListContainer.innerHTML = '';
        
        files.forEach((file, index) => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            
            fileItem.innerHTML = `
                <div class="file-item-title">${file.name}</div>
                <div class="file-item-actions">
                    <button class="play-file-btn">▶️</button>
                    <button class="add-to-playlist-btn">➕</button>
                </div>
            `;
            
            fileListContainer.appendChild(fileItem);
            
            // ボタンのイベントリスナー
            fileItem.querySelector('.play-file-btn').addEventListener('click', () => {
                playGoogleDriveFile(file);
            });
            
            fileItem.querySelector('.add-to-playlist-btn').addEventListener('click', () => {
                addToPlaylist(file);
            });
        });
    }

    // Google Driveファイルの再生
    function playGoogleDriveFile(file) {
        return ensureTokenValid(() => {
                
               // Google Driveファイルの直接リンクを取得
// ─── fetch＋blob 版に置き換え ───
            fetch(
                `https://www.googleapis.com/drive/v3/files/${file.id}` +
                `?alt=media&supportsAllDrives=true`,
                {
                headers: {
                    'Authorization': `Bearer ${gapi.client.getToken().access_token}`
                }
                }
            )
                .then(resp => {
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                return resp.blob();
                })
                .then(blob => {
                // Blob を URL 化して再生
                const objUrl = URL.createObjectURL(blob);
                audioPlayer.src = objUrl;
                audioPlayer.load();
                audioPlayer.onended = () => URL.revokeObjectURL(objUrl);
                audioPlayer.play().then(resolve).catch(error => {
                    console.error('Play error', error);
                    reject(error);
                    showError(
                    '再生エラー',
                    `「${file.name}」の再生に失敗しました。`,
                    [
                        'ブラウザの自動再生ポリシーにより、ユーザーの操作が必要な場合があります。',
                        '再生ボタンをクリックしてください。'
                    ],
                    'PLAY_ERROR',
                    () => playGoogleDriveFile(file)
                    );
                });
                })
                .catch(error => {
                // タイムアウト用タイマー解除＆UIクリア
                clearTimeout(playTimeout);
                if (statusText.parentNode) statusText.parentNode.removeChild(statusText);
                console.error('fetch playback error', error);
                reject(error);
                showError(
                    'ファイル読み込みエラー',
                    `「${file.name}」の取得に失敗しました。`,
                    [
                    'インターネット接続を確認してください。',
                    'ファイルへのアクセス権を確認してください。'
                    ],
                    'FETCH_ERROR',
                    () => playGoogleDriveFile(file)
                );
                });
            });
    }

    // Google DriveファイルのURLを取得
    function getGoogleDriveFileUrl(fileId) {
        return new Promise((resolve, reject) => {
        /* ① アクセストークンがあるか確認  */
        const tokenObj = gapi.client.getToken();
        if (!(tokenObj && tokenObj.access_token)) {
            // まだトークンが無い → Silent 取得→再実行
            tokenClient.requestAccessToken({
            prompt: 'consent',                // 毎回ポップアップなら 'consent'
            callback: () => resolve(null)     // 1 度トークンが付くと再度呼び出し側で retry
            });
            return;
        }

        /* ② 共有ドライブ対応 & アクセストークン付き URL を生成  */
        const directUrl =
            `https://www.googleapis.com/drive/v3/files/${fileId}` +
            `?alt=media&supportsAllDrives=true` +
            `&access_token=${encodeURIComponent(tokenObj.access_token)}`;
        audioPlayer.src = directUrl;

        /* ③ URL を返す  */
        resolve(directUrl);
        });

    }

    // 時間フォーマット
    function formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        seconds = Math.floor(seconds % 60);
        return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    }

    // 時間表示の更新
    function updateTimeDisplay() {
        currentTimeDisplay.textContent = formatTime(audioPlayer.currentTime);
    }

    // 再生時間表示の更新
    function updateDurationDisplay() {
        if (!isNaN(audioPlayer.duration)) {
            durationDisplay.textContent = formatTime(audioPlayer.duration);
        }
    }

    // 再生/一時停止の切り替え
    function togglePlayPause() {
        if (audioPlayer.paused) {
            audioPlayer.play().catch(error => {
                console.error('Play error', error);
                showError(
                    '再生エラー',
                    '音声の再生に失敗しました。',
                    [
                        'ブラウザの自動再生ポリシーにより、ユーザーの操作が必要な場合があります。',
                        '再生ボタンをクリックしてください。'
                    ],
                    'PLAY_ERROR',
                    () => audioPlayer.play()
                );
            });
        } else {
            audioPlayer.pause();
        }
    }

    // 停止
    function stopAudio() {
        audioPlayer.pause();
        audioPlayer.currentTime = 0;
        playPauseBtn.textContent = '再生';
    }

    // ミュートの切り替え
    function toggleMute() {
        audioPlayer.muted = !audioPlayer.muted;
        muteBtn.textContent = audioPlayer.muted ? '🔇' : '🔊';
    }

    // ボリューム変更
    function changeVolume() {
        audioPlayer.volume = volumeSlider.value;
        if (audioPlayer.volume === 0) {
            muteBtn.textContent = '🔇';
        } else {
            muteBtn.textContent = '🔊';
            audioPlayer.muted = false;
        }
    }

    // ===== 機能1: 単一ファイルのループ再生 =====
    // ループモードの切り替え
    function toggleLoop() {
        isLooping = !isLooping;
        audioPlayer.loop = isLooping;
        toggleLoopBtn.textContent = `ループ: ${isLooping ? 'オン' : 'オフ'}`;
    }

    // ===== 機能2: プレイリストの自動再生 =====
    // プレイリストに追加
    function addToPlaylist(file) {
        playlist.push(file);
        updatePlaylistUI();
        
        // 最初のアイテムの場合、再生を開始
        if (playlist.length === 1) {
            playPlaylistItem(0);
        }
    }
    
    // プレイリストUIの更新
    function updatePlaylistUI() {
        if (playlist.length === 0) {
            playlistContainer.innerHTML = '<div class="empty-list">プレイリストは空です。ファイル一覧から追加してください。</div>';
            return;
        }
        
        playlistContainer.innerHTML = '';
        
        playlist.forEach((item, index) => {
            const playlistItem = document.createElement('div');
            playlistItem.className = `playlist-item ${index === currentPlaylistIndex ? 'active' : ''}`;
            
            playlistItem.innerHTML = `
                <div class="playlist-item-title">${item.name}</div>
                <div class="playlist-item-actions">
                    <button class="play-item-btn">▶️</button>
                    <button class="remove-item-btn">🗑️</button>
                </div>
            `;
            
            playlistContainer.appendChild(playlistItem);
            
            // ボタンのイベントリスナー
            playlistItem.querySelector('.play-item-btn').addEventListener('click', () => {
                playPlaylistItem(index);
            });
            
            playlistItem.querySelector('.remove-item-btn').addEventListener('click', () => {
                removePlaylistItem(index);
            });
        });
    }
    
    // プレイリストアイテムの再生
    function playPlaylistItem(index) {
        if (index >= 0 && index < playlist.length) {
            currentPlaylistIndex = index;
            const item = playlist[index];
            
            // Google Driveファイルの再生
            playGoogleDriveFile(item)
                .then(() => {
                    // 再生成功
                    updatePlaylistUI();
                })
                .catch(error => {
                    console.error('Playlist item play error', error);
                    // エラーは既に表示されているので、ここでは何もしない
                });
        }
    }
    
    // プレイリストからアイテムを削除
    function removePlaylistItem(index) {
        // 現在再生中のアイテムを削除する場合
        const wasPlaying = index === currentPlaylistIndex;
        
        // アイテムを削除
        playlist.splice(index, 1);
        
        // 必要に応じてcurrentPlaylistIndexを調整
        if (currentPlaylistIndex >= playlist.length) {
            currentPlaylistIndex = playlist.length - 1;
        }
        
        // UIを更新
        updatePlaylistUI();
        
        // 削除したアイテムが再生中だった場合、次のアイテムを再生
        if (wasPlaying && playlist.length > 0) {
            playPlaylistItem(currentPlaylistIndex);
        } else if (playlist.length === 0) {
            // プレイリストが空になった場合
            stopAudio();
            currentPlaylistIndex = -1;
        }
    }
    
    // プレイリストをクリア
    function clearPlaylist() {
        playlist = [];
        currentPlaylistIndex = -1;
        stopAudio();
        updatePlaylistUI();
    }
    
    // オーディオ終了時の処理
    function handleAudioEnded() {
        if (isLooping) {
            // ループが有効な場合は、audioPlayer.loopプロパティが処理
            return;
        }
        
        // プレイリストがあり、最後のアイテムでない場合
        if (playlist.length > 0 && currentPlaylistIndex < playlist.length - 1) {
            // 次のアイテムを再生
            playPlaylistItem(currentPlaylistIndex + 1);
        } else {
            // プレイリストの最後または空の場合
            stopAudio();
        }
    }

    // プレイヤーの初期化
    initPlayer();
});