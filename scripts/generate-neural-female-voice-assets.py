"""Generate the bot's bundled Korean female voice announcements.

Development-only requirements:
    pip install supertonic

The model is only needed while generating the files. Production plays the
resulting MP3 assets and does not install or load the model.
"""

from __future__ import annotations

import hashlib
import shutil
import subprocess
import tempfile
from pathlib import Path

from supertonic import TTS


PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIRECTORY = PROJECT_ROOT / "assets" / "voice" / "female"
VOICE_NAME = "F2"

BOSSES = (
    "노블루드",
    "악시오스",
    "바르시엔",
    "구루타",
    "카루카",
    "비슈베다",
    "쉬라크",
    "타르탄",
    "카샤파",
    "라그타",
    "가르투아",
    "사르바카",
    "미나사라",
    "브란트",
    "아그로",
    "카이라",
)


def get_phrases() -> list[str]:
    phrases = [
        "음성 알림 테스트입니다.",
        "슈고페스타 5분 남았습니다.",
        "슈고페스타 시간입니다.",
        "습격 시간입니다.",
    ]
    for boss in BOSSES:
        phrases.extend((f"{boss} 젠 5분 전입니다.", f"{boss} 곧 출현합니다."))
    return phrases


def get_ffmpeg_path() -> str:
    result = subprocess.run(
        ["node", "-e", "process.stdout.write(require('ffmpeg-static'))"],
        cwd=PROJECT_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    path = result.stdout.strip()
    if not path:
        raise RuntimeError("ffmpeg-static executable was not found. Run npm install first.")
    return path


def get_file_name(phrase: str) -> str:
    digest = hashlib.sha256(phrase.encode("utf-8")).hexdigest()
    return f"{digest}.mp3"


def main() -> None:
    ffmpeg_path = get_ffmpeg_path()
    phrases = get_phrases()
    tts = TTS(model="supertonic-3", auto_download=True)
    voice_style = tts.get_voice_style(voice_name=VOICE_NAME)

    with tempfile.TemporaryDirectory(prefix="hwa-neural-voice-") as temporary:
        staging_directory = Path(temporary)

        for index, phrase in enumerate(phrases, start=1):
            audio, _ = tts.synthesize(
                text=phrase,
                voice_style=voice_style,
                total_steps=10,
                speed=1.0,
                lang="ko",
                verbose=False,
            )

            wave_path = staging_directory / "voice.wav"
            mp3_path = staging_directory / get_file_name(phrase)
            tts.save_audio(audio, str(wave_path))
            subprocess.run(
                [
                    ffmpeg_path,
                    "-y",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-i",
                    str(wave_path),
                    "-af",
                    "loudnorm=I=-18:TP=-2:LRA=7",
                    "-ac",
                    "1",
                    "-ar",
                    "24000",
                    "-b:a",
                    "64k",
                    str(mp3_path),
                ],
                check=True,
            )
            print(f"[{index:02d}/{len(phrases)}] Generated: {phrase}")

        OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
        for phrase in phrases:
            file_name = get_file_name(phrase)
            shutil.copy2(staging_directory / file_name, OUTPUT_DIRECTORY / file_name)

    print(f"Generated {len(phrases)} Korean neural female voice assets ({VOICE_NAME}).")


if __name__ == "__main__":
    main()
