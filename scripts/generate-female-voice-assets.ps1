$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Speech

$projectRoot = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $projectRoot 'assets\voice\female'
$ffmpegPath = & node -e "process.stdout.write(require('ffmpeg-static'))"

if (-not $ffmpegPath -or -not (Test-Path -LiteralPath $ffmpegPath)) {
    throw 'ffmpeg-static executable was not found. Run npm install first.'
}

$bosses = @(
    '노블루드',
    '악시오스',
    '바르시엔',
    '구루타',
    '카루카',
    '비슈베다',
    '쉬라크',
    '타르탄',
    '카샤파',
    '라그타',
    '가르투아',
    '사르바카',
    '미나사라',
    '브란트',
    '아그로',
    '카이라'
)

$phrases = [System.Collections.Generic.List[string]]::new()
$phrases.Add('음성 알림 테스트입니다.')
$phrases.Add('슈고페스타 5분 남았습니다.')
$phrases.Add('슈고페스타 시간입니다.')
$phrases.Add('습격 시간입니다.')

foreach ($boss in $bosses) {
    $phrases.Add("$boss 젠 5분 전입니다.")
    $phrases.Add("$boss 곧 출현합니다.")
}

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

$synthesizer = [System.Speech.Synthesis.SpeechSynthesizer]::new()
$femaleKoreanVoice = $synthesizer.GetInstalledVoices() |
    Where-Object {
        $_.Enabled -and
        $_.VoiceInfo.Culture.Name -eq 'ko-KR' -and
        $_.VoiceInfo.Gender -eq [System.Speech.Synthesis.VoiceGender]::Female
    } |
    Select-Object -First 1

if (-not $femaleKoreanVoice) {
    $synthesizer.Dispose()
    throw 'A Korean female Windows speech voice is required to generate these assets.'
}

$synthesizer.SelectVoice($femaleKoreanVoice.VoiceInfo.Name)
$synthesizer.Rate = 0
$synthesizer.Volume = 100

try {
    foreach ($phrase in $phrases) {
        $hashBytes = [System.Security.Cryptography.SHA256]::HashData(
            [System.Text.Encoding]::UTF8.GetBytes($phrase)
        )
        $hash = [Convert]::ToHexString($hashBytes).ToLowerInvariant()
        $wavePath = Join-Path $outputDirectory "$hash.wav"
        $mp3Path = Join-Path $outputDirectory "$hash.mp3"

        $synthesizer.SetOutputToWaveFile($wavePath)
        $synthesizer.Speak($phrase)
        $synthesizer.SetOutputToNull()

        & $ffmpegPath -y -hide_banner -loglevel error -i $wavePath -ac 1 -ar 24000 -b:a 64k $mp3Path
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to encode voice asset for: $phrase"
        }

        Remove-Item -LiteralPath $wavePath
        Write-Host "Generated: $phrase"
    }
}
finally {
    $synthesizer.Dispose()
}

Write-Host "Generated $($phrases.Count) Korean female voice assets with $($femaleKoreanVoice.VoiceInfo.Name)."
