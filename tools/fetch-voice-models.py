"""Download the openWakeWord files the helper needs into sidecar/models/.

Pinned to the openWakeWord v0.5.1 release. Files already present are kept.
The ready-made wake words are licensed for non-commercial use only.
Run: python tools/fetch-voice-models.py
"""

from pathlib import Path
import urllib.request

RELEASE = "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/"
FILES = {  # saved name -> release file name
    "melspectrogram.onnx": "melspectrogram.onnx",
    "embedding_model.onnx": "embedding_model.onnx",
    "hey_jarvis.onnx": "hey_jarvis_v0.1.onnx",
    "alexa.onnx": "alexa_v0.1.onnx",
    "hey_mycroft.onnx": "hey_mycroft_v0.1.onnx",
    "hey_rhasspy.onnx": "hey_rhasspy_v0.1.onnx",
}
MODELS = Path(__file__).resolve().parents[1] / "sidecar" / "models"


def main():
    MODELS.mkdir(parents=True, exist_ok=True)
    for name, remote in FILES.items():
        target = MODELS / name
        if target.is_file() and target.stat().st_size > 0:
            print("have", name)
            continue
        partial = target.with_suffix(".part")
        with urllib.request.urlopen(RELEASE + remote, timeout=60) as response:
            partial.write_bytes(response.read())
        partial.replace(target)
        print("got ", name, target.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
