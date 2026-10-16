# SPDX-License-Identifier: AGPL-3.0-only
"""Functional contract tests; the Node suite owns discovery and process lifetime."""

import contextlib
import copy
import http.server
import importlib.util
import json
import math
import pathlib
import sys
import tempfile
import threading
import time
import types
import wave


class Strip(dict):
    def __init__(self, name, filepath, channel, frame_start):
        super().__init__()
        self.name, self.channel, self.frame_start = name, channel, frame_start
        self.sound = types.SimpleNamespace(filepath=filepath, users=1)
        self.type, self.select, self.volume, self.pan, self.mute = "SOUND", False, 1.0, 0.0, False
        self.frame_final_start, self.frame_final_end = frame_start, frame_start + 24


class Strips(list):
    def new_sound(self, name, filepath, channel, frame_start):
        assert threading.current_thread() is threading.main_thread(), "Blender API called off-thread"
        strip = Strip(name, filepath, channel, frame_start)
        self.append(strip)
        return strip


class Scene(dict):
    def __init__(self, legacy=False):
        super().__init__()
        self.render = types.SimpleNamespace(fps=30, fps_base=1.001)
        self.frame_end = 250
        self.sequence_editor = types.SimpleNamespace(**{("sequences" if legacy else "strips"): Strips()})

    def sequence_editor_create(self):
        return self.sequence_editor


class Menu:
    callbacks = []

    @classmethod
    def append(cls, callback):
        cls.callbacks.append(callback)

    @classmethod
    def remove(cls, callback):
        cls.callbacks.remove(callback)


class Timers:
    callbacks = []

    def register(self, callback, **_kwargs):
        self.callbacks.append(callback)

    def unregister(self, callback):
        self.callbacks.remove(callback)

    def is_registered(self, callback):
        return callback in self.callbacks


def stub_bpy():
    bpy = types.ModuleType("bpy")
    bpy.props = types.ModuleType("bpy.props")
    bpy.props.StringProperty = lambda **_kwargs: None
    bpy.app = types.ModuleType("bpy.app")
    bpy.app.handlers = types.ModuleType("bpy.app.handlers")
    bpy.app.handlers.persistent = lambda callback: callback
    bpy.app.handlers.load_pre = []
    bpy.app.timers = Timers()
    bpy.types = types.SimpleNamespace(Operator=type("Operator", (), {}),
                                     TOPBAR_MT_file_import=type("ImportMenu", (Menu,), {"callbacks": []}),
                                     SEQUENCER_MT_add=type("AddMenu", (Menu,), {"callbacks": []}))
    bpy.utils = types.SimpleNamespace(register_class=lambda _cls: None, unregister_class=lambda _cls: None)

    def load(filepath, **_kwargs):
        assert threading.current_thread() is threading.main_thread(), "Blender API called off-thread"
        with wave.open(filepath) as audio:
            assert audio.getnframes() > 0
        return types.SimpleNamespace(filepath=filepath, users=0)

    bpy.data = types.SimpleNamespace(sounds=types.SimpleNamespace(load=load, remove=lambda _sound: None))
    bpy.path = types.SimpleNamespace(abspath=lambda path: path)
    bpy.context = types.SimpleNamespace(temp_override=lambda **_kwargs: contextlib.nullcontext())
    bpy.ops = types.SimpleNamespace(sequencer=types.SimpleNamespace(reload=lambda **_kwargs: {"FINISHED"}))
    extras = types.ModuleType("bpy_extras")
    utils = types.ModuleType("bpy_extras.io_utils")
    utils.ImportHelper = type("ImportHelper", (), {})
    for name, module in {"bpy": bpy, "bpy.props": bpy.props, "bpy.app": bpy.app,
                         "bpy.app.handlers": bpy.app.handlers, "bpy_extras": extras,
                         "bpy_extras.io_utils": utils}.items():
        sys.modules[name] = module
    return bpy


def write_wav(path, seconds=1):
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as audio:
        audio.setparams((1, 2, 48000, 0, "NONE", "not compressed"))
        audio.writeframes(b"\x00\x00" * int(seconds * 48000))


def snapshot(revision=1):
    return {"schemaVersion": 1, "projectId": "project-1", "projectName": "Session", "revision": revision,
            "tracks": [{"id": "track-1", "name": "Voice", "fileName": f"audio/{revision}/voice.wav",
                        "startSeconds": 0, "durationSeconds": 1, "mute": False}]}


def expect_invalid(callback):
    try:
        callback()
    except (ValueError, OSError):
        return
    raise AssertionError("Expected invalid data to be rejected")


def validation(addon, root):
    base = snapshot()
    assert addon.validate_manifest(base, root)["tracks"][0]["id"] == "track-1"
    expect_invalid(lambda: addon._decode_json(b"[" * 100000 + b"0" + b"]" * 100000))
    for field, value in [("schemaVersion", 2), ("revision", True), ("revision", -1),
                         ("projectId", ""), ("tracks", {}), ("tracks", [base["tracks"][0]] * 129)]:
        invalid = copy.deepcopy(base)
        invalid[field] = value
        expect_invalid(lambda: addon.validate_manifest(invalid, root))
    for field, value in [("fileName", "../outside.wav"), ("fileName", "/tmp/outside.wav"),
                         ("fileName", "C:\\outside.wav"), ("fileName", "audio/1/voice.mp3"),
                         ("fileName", "audio/1/missing.wav"), ("durationSeconds", float("nan")),
                         ("startSeconds", -1), ("durationSeconds", 10**1000),
                         ("mute", 1), ("id", ""), ("name", "unsafe\nname")]:
        invalid = copy.deepcopy(base)
        invalid["tracks"][0][field] = value
        expect_invalid(lambda: addon.validate_manifest(invalid, root))
    invalid = copy.deepcopy(base)
    invalid["tracks"].append(copy.deepcopy(invalid["tracks"][0]))
    expect_invalid(lambda: addon.validate_manifest(invalid, root))
    outside = root.parent / "outside.wav"
    write_wav(outside)
    try:
        (root / "escape.wav").symlink_to(outside)
    except OSError:
        return  # Windows may require elevated privileges to create test symlinks.
    invalid = copy.deepcopy(base)
    invalid["tracks"][0]["fileName"] = "escape.wav"
    expect_invalid(lambda: addon.validate_manifest(invalid, root))


def reconcile(addon, root, scene=None):
    scene = Scene() if scene is None else scene
    strips = addon.scene_strips(scene)
    unrelated = strips.new_sound("Unrelated", str(root / "audio/1/voice.wav"), 1, 10)
    addon.apply_manifest(scene, snapshot(), root)
    imported = next(strip for strip in strips if strip != unrelated)
    identity = imported.as_pointer() if hasattr(imported, "as_pointer") else id(imported)
    assert imported.channel == 2
    imported.volume, imported.pan = 0.4, 0.3
    update = snapshot(2)
    update["tracks"][0].update(name="New voice", startSeconds=2, durationSeconds=2, mute=True)
    write_wav(root / "audio/2/voice.wav", 2)
    addon.apply_manifest(scene, update, root)
    updated = next(strip for strip in strips if strip != unrelated)
    assert (updated.as_pointer() if hasattr(updated, "as_pointer") else id(updated)) == identity
    assert math.isclose(imported.volume, 0.4, rel_tol=1e-6) and math.isclose(imported.pan, 0.3, rel_tol=1e-6)
    assert imported.channel == 2
    assert imported.name == "New voice" and imported.mute
    assert pathlib.Path(imported.sound.filepath) == root / "audio/2/voice.wav"
    fps = scene.render.fps / scene.render.fps_base
    assert imported.frame_final_start == 1 + round(2 * fps)
    assert imported.frame_final_end == imported.frame_final_start + round(2 * fps)
    if hasattr(imported, "frame_duration"):
        assert abs(imported.frame_duration - round(2 * fps)) <= 1
    imported.sound = None  # A Blender user can unlink the original sound data-block.
    addon.apply_manifest(scene, update, root)
    assert pathlib.Path(imported.sound.filepath) == root / "audio/2/voice.wav"
    imported.sound = None
    addon.apply_manifest(scene, {**snapshot(3), "tracks": []}, root)
    assert list(strips) == [unrelated]


def channels(addon, root):
    scene = Scene()
    for channel in range(1, 129):
        scene.sequence_editor.strips.new_sound(str(channel), str(root / "audio/1/voice.wav"), channel, 1)
    before = list(scene.sequence_editor.strips)
    expect_invalid(lambda: addon.apply_manifest(scene, snapshot(), root))
    assert scene.sequence_editor.strips == before


def connection(addon, root):
    valid = {"schemaVersion": 1, "host": "127.0.0.1", "port": 40001, "token": "a" * 64}
    for field, value in [("host", "localhost"), ("host", "example.com"), ("port", True),
                         ("port", 0), ("port", 65536), ("token", "a\r\nb"), ("schemaVersion", 2)]:
        path = root / "live.json"
        path.write_text(json.dumps({**valid, field: value}), encoding="utf-8")
        expect_invalid(lambda: addon.read_connection(root))
    (root / "live.json").write_text(json.dumps(valid), encoding="utf-8")
    assert addon.read_connection(root) == valid
    assert addon.NoRedirect().redirect_request(None, None, 302, "", {}, "https://example.com") is None


def live(addon, root, bpy, scene=None):
    requests = []
    state = {"manifest": snapshot(), "redirect": False}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append((self.path, self.headers.get("Authorization")))
            if state["redirect"]:
                self.send_response(302)
                self.send_header("Location", "http://example.com/")
                self.end_headers()
                return
            after = int(self.path.split("after=")[1])
            body = json.dumps(state["manifest"]).encode()
            self.send_response(204 if after >= state["manifest"]["revision"] else 200)
            self.end_headers()
            if after < state["manifest"]["revision"]:
                self.wfile.write(body)

        def log_message(self, *_args):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    (root / "live.json").write_text(json.dumps({"schemaVersion": 1, "host": "127.0.0.1",
        "port": server.server_port, "token": "b" * 64}), encoding="utf-8")
    (root / "soundscaper.json").write_text(json.dumps(snapshot()), encoding="utf-8")
    scene = Scene() if scene is None else scene
    try:
        addon.start_live(scene, root / "soundscaper.json")
        imported = next(strip for strip in addon.scene_strips(scene) if strip.get(addon.TRACK_KEY) == "track-1")
        identity = imported.as_pointer() if hasattr(imported, "as_pointer") else id(imported)
        imported.volume = 0.7
        write_wav(root / "audio/2/voice.wav", 2)
        state["manifest"] = snapshot(2)
        state["manifest"]["tracks"][0]["durationSeconds"] = 2
        deadline = time.monotonic() + 5
        while addon._live_session.revision < 2 and time.monotonic() < deadline:
            addon.live_timer()
            time.sleep(0.03)
        assert addon._live_session.revision == 2
        updated = next(strip for strip in addon.scene_strips(scene) if strip.get(addon.TRACK_KEY) == "track-1")
        assert (updated.as_pointer() if hasattr(updated, "as_pointer") else id(updated)) == identity
        assert math.isclose(imported.volume, 0.7, rel_tol=1e-6)
        assert imported.sound.filepath.endswith("audio/2/voice.wav")
        assert requests and all(auth == "Bearer " + "b" * 64 for _, auth in requests)
        assert addon.live_timer() == 0.1
        addon.stop_live()
        assert addon._live_session is None and addon.live_timer() is None
    finally:
        addon.stop_live()
        server.shutdown()
        server.server_close()


def menus(addon, root, bpy):
    addon.register()
    assert len(bpy.types.TOPBAR_MT_file_import.callbacks) == 1
    assert len(bpy.types.SEQUENCER_MT_add.callbacks) == 1
    entries = []
    menu = types.SimpleNamespace(layout=types.SimpleNamespace(operator=lambda name, **kwargs: entries.append((name, kwargs))))
    bpy.types.TOPBAR_MT_file_import.callbacks[0](menu, None)
    bpy.types.SEQUENCER_MT_add.callbacks[0](menu, None)
    assert [entry[1]["text"] for entry in entries] == ["Soundscaper track list (.json)",
        "Start Soundscaper live sync", "Stop Soundscaper live sync"]
    addon.unregister()
    assert not bpy.types.TOPBAR_MT_file_import.callbacks and not bpy.types.SEQUENCER_MT_add.callbacks
    assert not bpy.app.handlers.load_pre


args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
addon_path, scenario = args[:2]
bpy = stub_bpy() if scenario not in {"real", "bundle"} else __import__("bpy")
spec = importlib.util.spec_from_file_location("soundscaper_blender", addon_path)
addon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(addon)
if scenario == "bundle":
    root = pathlib.Path(args[2])
    manifest = json.loads((root / "soundscaper.json").read_text(encoding="utf-8"))
    bpy.context.scene.render.fps, bpy.context.scene.render.fps_base = 30, 1.001
    addon.register()
    addon.apply_manifest(bpy.context.scene, manifest, root)
    strips = list(addon.scene_strips(bpy.context.scene))
    assert len(strips) == 2
    assert {strip.get(addon.TRACK_KEY): strip.mute for strip in strips} == {"voice": False, "music": True}
    for strip in strips:
        assert strip.frame_final_start == 1 and strip.frame_final_end == 31
        with wave.open(bpy.path.abspath(strip.sound.filepath)) as audio:
            assert audio.getsampwidth() == 3 and audio.getframerate() == 48000 and audio.getnframes() == 48000
    addon.unregister()
    sys.exit(0)
with tempfile.TemporaryDirectory() as temp:
    root = pathlib.Path(temp) / "bundle"
    write_wav(root / "audio/1/voice.wav")
    if scenario == "real":
        bpy.context.scene.render.fps, bpy.context.scene.render.fps_base = 30, 1.001
        addon.register()
        reconcile(addon, root, bpy.context.scene)
        live(addon, root, bpy, bpy.context.scene)
        addon.unregister()
    elif scenario == "legacy":
        reconcile(addon, root, Scene(legacy=True))
    elif scenario in {"live", "menus"}:
        globals()[scenario](addon, root, bpy)
    else:
        globals()[scenario](addon, root)
