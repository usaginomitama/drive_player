from google.cloud import texttospeech

def synthesize_text(text, output_filename):
    """指定されたテキストをGoogle Cloud TTSで合成し、MP3ファイルとして保存する"""
    # TTSクライアントの作成
    client = texttospeech.TextToSpeechClient()

    # 合成するテキストを設定
    synthesis_input = texttospeech.SynthesisInput(text=text)

    # 英語の音声設定（必要に応じて language_code や ssml_gender を変更してください）
    voice = texttospeech.VoiceSelectionParams(
        language_code="en-US",
        ssml_gender=texttospeech.SsmlVoiceGender.NEUTRAL
    )

    # オーディオ出力設定（MP3形式）
    audio_config = texttospeech.AudioConfig(
        audio_encoding=texttospeech.AudioEncoding.MP3
    )

    # 音声合成のリクエスト送信
    response = client.synthesize_speech(
        input=synthesis_input,
        voice=voice,
        audio_config=audio_config
    )

    # 生成された音声データをファイルに保存
    with open(output_filename, "wb") as out:
        out.write(response.audio_content)
    print(f"Audio content written to file {output_filename}")

def process_file(input_file):
    """
    ファイル全体を読み込み、エントリごと（エントリはダブル改行で区切られる）に、
    ":" の左側の文字列を出力ファイル名の一部に、右側の英文を合成する
    """
    with open(input_file, 'r', encoding='utf-8') as f:
        content = f.read().strip()

    # エントリをダブル改行で分割（空のエントリは除外）
    entries = [entry for entry in content.split('\n\n') if entry.strip()]

    for entry in entries:
        # ":" で分割（左右に空白はない前提）
        if ':' not in entry:
            print("エントリに ':' が含まれていません:", entry)
            continue

        target_word, sentence = entry.split(':', 1)
        output_filename = fr"\Users\akihi\English\audio\{target_word}.mp3"
        synthesize_text(sentence, output_filename)

if __name__ == "__main__":
    input_file = r"C:\Users\akihi\English\sentences\20250417.txt"  # 英文が指定の形式で記載されたファイルのパス
    process_file(input_file)
