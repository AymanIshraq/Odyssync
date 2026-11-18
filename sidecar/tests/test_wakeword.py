"""Wake-word listener with fake openWakeWord, microphone and clock (no real libraries)."""
import asyncio
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import types
import unittest
from unittest.mock import patch

from sidecar.wakeword import WakeWordListener, score_chunks
from sidecar.win32_daemon import receive_commands


class Box:
    def __init__(self):
        self.events = []
        self.changed = threading.Condition()

    def put(self, event):
        with self.changed:
            self.events.append(event)
            self.changed.notify_all()

    def wait_for(self, predicate, seconds=2):
        with self.changed:
            self.changed.wait_for(lambda: any(predicate(e) for e in self.events), seconds)
        return [e for e in self.events if predicate(e)]


class Chunk:
    def __init__(self, score):
        self.score = score

    def reshape(self, *_shape):
        return self


class FakeModel:
    created = []

    def __init__(self, wakeword_models, melspec_model_path, embedding_model_path, inference_framework):
        self.path = wakeword_models[0]
        self.kwargs = (melspec_model_path, embedding_model_path, inference_framework)
        self.resets = 0
        FakeModel.created.append(self)

    def predict(self, chunk):
        return {Path(self.path).stem: chunk.score}

    def reset(self):
        self.resets += 1


class FakeStream:
    scores = []

    def __init__(self, samplerate, channels, dtype, blocksize):
        self.settings = (samplerate, channels, dtype, blocksize)
        self.queue = list(FakeStream.scores)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self, frames):
        time.sleep(0.002)
        return Chunk(self.queue.pop(0) if self.queue else 0.0), False


class Clock:
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        self.now += 0.08  # each chunk is 80 ms
        return self.now


def fake_libraries(model=FakeModel, stream=FakeStream):
    return patch.dict(sys.modules, {"openwakeword": types.SimpleNamespace(Model=model),
                                    "sounddevice": types.SimpleNamespace(InputStream=stream)})


class WakeWordTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.app = Path(temp.name, "app")
        self.user = Path(temp.name, "user")
        self.app.mkdir()
        self.user.mkdir()
        for name in ("melspectrogram.onnx", "embedding_model.onnx", "hey_jarvis.onnx", "hey_odyssync.onnx"):
            (self.app / name).write_bytes(b"x")
        for name in ("hey_buddy.onnx", "hey_jarvis.onnx", "notes.txt"):
            (self.user / name).write_bytes(b"x")
        self.box = Box()
        self.listener = WakeWordListener(self.box, self.app, self.user, clock=Clock())
        self.addCleanup(self.listener.stop)
        FakeModel.created = []
        FakeStream.scores = []

    def statuses(self):
        return [e for e in self.box.events if e["type"] == "WAKE_WORD_STATUS"]

    def test_lists_app_and_user_models_with_names(self):
        self.assertEqual(self.listener.list_models(), [
            {"id": "hey_jarvis", "name": "Hey Jarvis", "source": "app"},
            {"id": "hey_odyssync", "name": "Hey Odyssync", "source": "app"},
            {"id": "user:hey_buddy", "name": "Hey Buddy", "source": "user"},
            {"id": "user:hey_jarvis", "name": "Hey Jarvis", "source": "user"},
        ])

    def test_missing_user_folder_lists_app_models_only(self):
        listener = WakeWordListener(self.box, self.app, self.user / "absent")
        self.assertEqual([m["id"] for m in listener.list_models()], ["hey_jarvis", "hey_odyssync"])

    def test_threshold_and_cooldown(self):
        model = FakeModel([str(self.app / "hey_jarvis.onnx")], "m", "e", "onnx")
        # 0.49 ignored; 0.5 fires; next 2 s (25 chunks of 80 ms) stay quiet; then fires again.
        scores = [0.49, 0.5] + [0.9] * 24 + [0.1, 0.9]
        self.listener.detect(model, [Chunk(s) for s in scores], "hey_jarvis", threading.Event())
        self.assertEqual(self.box.events, [{"type": "WAKE_WORD", "model": "hey_jarvis"}] * 2)
        self.assertEqual(model.resets, 2)

    def test_score_chunks_yields_best_score(self):
        model = types.SimpleNamespace(predict=lambda chunk: {"a": 0.2, "b": chunk})
        self.assertEqual(list(score_chunks(model, [0.1, 0.7])), [0.2, 0.7])

    def test_enable_detect_and_disable(self):
        FakeStream.scores = [0.0, 0.8]
        with fake_libraries():
            self.listener.set(True, "user:hey_buddy")
            wakes = self.box.wait_for(lambda e: e["type"] == "WAKE_WORD")
            self.listener.set(False)
        self.assertEqual(self.statuses(), [{"type": "WAKE_WORD_STATUS", "enabled": True, "model": "user:hey_buddy"},
                                           {"type": "WAKE_WORD_STATUS", "enabled": False}])
        self.assertEqual(wakes, [{"type": "WAKE_WORD", "model": "user:hey_buddy"}])
        model = FakeModel.created[0]
        self.assertEqual(Path(model.path), self.user / "hey_buddy.onnx")
        self.assertEqual(model.kwargs, (str(self.app / "melspectrogram.onnx"),
                                        str(self.app / "embedding_model.onnx"), "onnx"))
        self.assertIsNone(self.listener.thread)

    def test_switching_model_stops_the_old_listener(self):
        with fake_libraries():
            self.listener.set(True, "hey_jarvis")
            first = self.listener.thread
            self.box.wait_for(lambda e: e.get("model") == "hey_jarvis")
            self.listener.set(True, "hey_odyssync")
            self.box.wait_for(lambda e: e.get("model") == "hey_odyssync")
        self.assertFalse(first.is_alive())
        self.assertEqual([e.get("model") for e in self.statuses()], ["hey_jarvis", "hey_odyssync"])
        self.assertEqual([Path(m.path).stem for m in FakeModel.created], ["hey_jarvis", "hey_odyssync"])

    def test_stop_is_silent(self):
        with fake_libraries():
            self.listener.set(True, "hey_jarvis")
            self.box.wait_for(lambda e: e.get("enabled"))
            self.listener.stop()
        self.assertEqual(len(self.statuses()), 1)
        self.assertIsNone(self.listener.thread)

    def assert_fails(self, sentence_part, **libraries):
        with fake_libraries(**libraries), self.assertLogs("sidecar.wakeword", "WARNING"):
            self.listener.set(True, "hey_jarvis")
            status = self.box.wait_for(lambda e: e["type"] == "WAKE_WORD_STATUS")
        self.assertEqual(status[0]["enabled"], False)
        self.assertIn(sentence_part, status[0]["error"])
        self.assertEqual(len(self.box.events), 1)

    def test_missing_model(self):
        with self.assertLogs("sidecar.wakeword", "WARNING"):
            self.listener.set(True, "hey_nobody")
        self.assertEqual(self.box.events, [{"type": "WAKE_WORD_STATUS", "enabled": False,
                                            "error": "The wake word 'hey_nobody' is not installed."}])

    def test_missing_feature_files(self):
        (self.app / "embedding_model.onnx").unlink()
        self.assert_fails("embedding_model.onnx")

    def test_missing_library(self):
        with patch.dict(sys.modules, {"openwakeword": None}), self.assertLogs("sidecar.wakeword", "WARNING"):
            self.listener.set(True, "hey_jarvis")
            status = self.box.wait_for(lambda e: e["type"] == "WAKE_WORD_STATUS")
        self.assertIn("openWakeWord", status[0]["error"])

    def test_broken_model_file(self):
        def broken(**_):
            raise RuntimeError("bad onnx")
        self.assert_fails("could not be loaded", model=broken)

    def test_no_microphone(self):
        def no_mic(**_):
            raise OSError("PortAudio library not found")
        self.assert_fails("No microphone", stream=no_mic)


class CommandRoutingTests(unittest.TestCase):
    def test_list_and_set_commands(self):
        class Socket:
            def __init__(self, messages):
                self.messages = messages

            def __aiter__(self):
                return self

            async def __anext__(self):
                if not self.messages:
                    raise StopAsyncIteration
                return json.dumps(self.messages.pop(0))

        class Wake:
            calls = []

            def list_models(self):
                return [{"id": "hey_jarvis", "name": "Hey Jarvis", "source": "app"}]

            def set(self, enabled, model=None):
                self.calls.append((enabled, model))

        box, wake = Box(), Wake()
        socket = Socket([{"type": "LIST_WAKE_WORDS"},
                         {"type": "SET_WAKE_WORD", "enabled": True, "model": "hey_jarvis"},
                         {"type": "SET_WAKE_WORD", "enabled": False},
                         {"type": "SET_WAKE_WORD", "enabled": "yes"}])
        with self.assertLogs("sidecar.win32_daemon", "WARNING"):
            asyncio.run(receive_commands(socket, set(), outbox=box, wake=wake))
        self.assertEqual(box.events, [{"type": "WAKE_WORDS", "models": [
            {"id": "hey_jarvis", "name": "Hey Jarvis", "source": "app"}]}])
        self.assertEqual(wake.calls, [(True, "hey_jarvis"), (False, None)])


if __name__ == "__main__":
    unittest.main()
