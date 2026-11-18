# First install the tools once: pip install openwakeword onnxruntime sounddevice
"""Try a wake-word file with your microphone.

Run:  python test_mic.py path/to/model.onnx
Say the phrase. The live score goes from 0 (no) to 1 (yes); 0.5 or more prints DETECTED,
the same rule the Odyssync app uses. Press Ctrl+C to stop.
"""

from pathlib import Path
import sys

import numpy as np
import openwakeword
from openwakeword.model import Model
from openwakeword.utils import download_models
import sounddevice as sd

SAMPLE_RATE = 16000  # 16 kHz
CHUNK = 1280  # 80 ms of sound per check
THRESHOLD = 0.5
FEATURE_FILES = ("melspectrogram.onnx", "embedding_model.onnx")


def main():
    if len(sys.argv) != 2:
        print("Usage: python test_mic.py path/to/model.onnx")
        return 2
    path = Path(sys.argv[1])
    if not path.is_file():
        print(f"File not found: {path}")
        return 1

    resources = Path(openwakeword.__file__).parent / "resources" / "models"
    if not all((resources / name).is_file() for name in FEATURE_FILES):
        print("Downloading openWakeWord's shared listening files (one time only)...")
        # A name that matches no ready-made wake word fetches only the shared files.
        download_models(model_names=["shared-feature-files-only"])

    model = Model(wakeword_models=[str(path)], inference_framework="onnx")
    name = path.stem
    print(f"Listening for '{name}'. Say it! (Ctrl+C to stop)")

    try:
        with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="int16", blocksize=CHUNK) as stream:
            while True:
                audio, _overflowed = stream.read(CHUNK)
                score = float(model.predict(np.asarray(audio).reshape(-1))[name])
                bar = "#" * int(score * 40)
                if score >= THRESHOLD:
                    print(f"\rscore {score:.3f} {bar:<40} DETECTED")
                else:
                    print(f"\rscore {score:.3f} {bar:<40}         ", end="", flush=True)
    except KeyboardInterrupt:
        print("\nStopped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
