"""Wake word: listen on the microphone, offline, for one chosen phrase.

openWakeWord only answers "was that the phrase, yes or no". Audio stays in
memory one 80 ms chunk at a time; nothing is stored, written or sent.
"""

import logging
import os
from pathlib import Path
import sys
import threading
import time

log = logging.getLogger(__name__)
SAMPLE_RATE = 16000
CHUNK_SAMPLES = 1280  # 80 ms
THRESHOLD = 0.5
COOLDOWN_SECONDS = 2.0
FEATURE_FILES = ("melspectrogram.onnx", "embedding_model.onnx")


def default_app_models_dir():
    """sidecar/models from source, or the copy bundled inside the frozen helper."""
    base = getattr(sys, "_MEIPASS", None) or Path(__file__).resolve().parents[1]
    return Path(base) / "sidecar" / "models"


def default_user_models_dir():
    appdata = os.environ.get("APPDATA")
    if sys.platform == "win32" and appdata:
        return Path(appdata) / "Odyssync" / "wakewords"
    return Path.home() / ".odyssync" / "wakewords"


def friendly_name(stem):
    return " ".join(word.capitalize() for word in stem.replace("-", "_").split("_") if word)


def score_chunks(model, chunks):
    """Feed 80 ms chunks to an openWakeWord model; yield the best score for each."""
    for chunk in chunks:
        scores = model.predict(chunk)
        yield max(scores.values(), default=0.0)


class WakeWordListener:
    def __init__(self, outbox, app_models_dir=None, user_models_dir=None, clock=time.monotonic):
        self.outbox = outbox
        self.app_models_dir = Path(app_models_dir or default_app_models_dir())
        self.user_models_dir = Path(user_models_dir or default_user_models_dir())
        self.clock = clock
        self.lock = threading.Lock()
        self.thread = None
        self.stopping = None
        self.model_id = None

    def list_models(self):
        """[{id, name, source}]; user files get a 'user:' id so both can coexist."""
        return [{key: model[key] for key in ("id", "name", "source")} for model in self._models()]

    def _models(self):
        models = []
        for folder, source in ((self.app_models_dir, "app"), (self.user_models_dir, "user")):
            try:
                files = sorted(folder.glob("*.onnx"))
            except OSError:
                files = []
            for path in files:
                if source == "app" and path.name in FEATURE_FILES:
                    continue
                models.append({"id": ("user:" if source == "user" else "") + path.stem,
                               "name": friendly_name(path.stem), "source": source, "path": path})
        return models

    def set(self, enabled, model_id=None):
        with self.lock:
            self._stop_locked()
            if not enabled:
                self.outbox.put({"type": "WAKE_WORD_STATUS", "enabled": False})
                return
            models = self._models()
            model_id = model_id or self.model_id or (models[0]["id"] if models else None)
            match = next((model for model in models if model["id"] == model_id), None)
            if match is None:
                self._fail(None, "No wake words are installed." if model_id is None
                           else f"The wake word '{model_id}' is not installed.")
                return
            self.model_id = model_id
            self.stopping = threading.Event()
            self.thread = threading.Thread(target=self._run, args=(model_id, match["path"], self.stopping),
                                           name="wake-word", daemon=True)
            self.thread.start()

    def stop(self):
        """Session end: stop listening without reporting to a closed bridge."""
        with self.lock:
            self._stop_locked()

    def _stop_locked(self):
        if self.stopping is not None:
            self.stopping.set()
        if self.thread is not None and self.thread is not threading.current_thread():
            self.thread.join(timeout=2)
        self.thread = None
        self.stopping = None

    def _fail(self, stopping, sentence):
        log.warning("Wake word off: %s", sentence)
        if stopping is None or not stopping.is_set():
            self.outbox.put({"type": "WAKE_WORD_STATUS", "enabled": False, "error": sentence})

    def _run(self, model_id, path, stopping):
        try:
            from openwakeword import Model
        except Exception:
            return self._fail(stopping, "The wake-word library (openWakeWord) is missing from this helper.")
        missing = [name for name in FEATURE_FILES if not (self.app_models_dir / name).is_file()]
        if missing:
            return self._fail(stopping, "The wake-word sound files are missing: " + ", ".join(missing) + ".")
        try:
            model = Model(wakeword_models=[str(path)],
                          melspec_model_path=str(self.app_models_dir / "melspectrogram.onnx"),
                          embedding_model_path=str(self.app_models_dir / "embedding_model.onnx"),
                          inference_framework="onnx")
        except Exception as error:
            return self._fail(stopping, f"The wake word '{model_id}' could not be loaded ({error}).")
        try:
            import sounddevice
            stream = sounddevice.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="int16",
                                             blocksize=CHUNK_SAMPLES)
        except Exception as error:
            return self._fail(stopping, f"No microphone could be opened for the wake word ({error}).")
        try:
            with stream:
                if stopping.is_set():
                    return
                self.outbox.put({"type": "WAKE_WORD_STATUS", "enabled": True, "model": model_id})
                log.info("Wake word listening: %s", model_id)
                self.detect(model, self._chunks(stream, stopping), model_id, stopping)
        except Exception as error:
            self._fail(stopping, f"The microphone stopped working for the wake word ({error}).")

    @staticmethod
    def _chunks(stream, stopping):
        while not stopping.is_set():
            data, _overflowed = stream.read(CHUNK_SAMPLES)
            yield data.reshape(-1)

    def detect(self, model, chunks, model_id, stopping):
        """Report WAKE_WORD when a chunk scores at least THRESHOLD, then rest 2 s."""
        quiet_until = None
        for score in score_chunks(model, chunks):
            if stopping.is_set():
                return
            now = self.clock()
            if quiet_until is not None and now < quiet_until:
                continue
            if score >= THRESHOLD:
                self.outbox.put({"type": "WAKE_WORD", "model": model_id})
                quiet_until = now + COOLDOWN_SECONDS
                reset = getattr(model, "reset", None)
                if callable(reset):
                    reset()
