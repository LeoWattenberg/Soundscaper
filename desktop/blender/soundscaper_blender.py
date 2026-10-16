# SPDX-License-Identifier: AGPL-3.0-only
"""Import Soundscaper WAV bundles and receive desktop updates in Blender 4.2+."""

bl_info = {
    "name": "Soundscaper track list and live sync",
    "author": "Soundscaper contributors",
    "version": (1, 0, 0),
    "blender": (4, 2, 0),
    "location": "File > Import; Sequencer > Add",
    "description": "Import audio tracks and receive local Soundscaper desktop edits",
    "category": "Import-Export",
}

import json
import math
from pathlib import Path, PurePosixPath
import queue
import re
import threading
import urllib.error
import urllib.request

import bpy
from bpy.app.handlers import persistent
from bpy.props import StringProperty
from bpy_extras.io_utils import ImportHelper

MAX_JSON_BYTES = 4 * 1024 * 1024
MAX_TRACKS = 128
PROJECT_KEY = "soundscaper_project_id"
TRACK_KEY = "soundscaper_track_id"
_live_session = None


def _text(value, name, limit=1024):
    if not isinstance(value, str) or not value or len(value) > limit or re.search(r"[\x00-\x1f\x7f]", value):
        raise ValueError(f"Invalid {name}")
    return value


def _integer(value, name, minimum=0, maximum=2**53 - 1):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError(f"Invalid {name}")
    return value


def _seconds(value, name):
    if type(value) not in (int, float) or not 0 <= value <= 1_000_000 or not math.isfinite(value):
        raise ValueError(f"Invalid {name}")
    return value


def _read_json(path):
    with path.open("rb") as source:
        data = source.read(MAX_JSON_BYTES + 1)
    return _decode_json(data)


def _decode_json(data):
    if len(data) > MAX_JSON_BYTES:
        raise ValueError("Soundscaper manifest exceeds the size limit")
    try:
        value = json.loads(data)
    except RecursionError as error:
        raise ValueError("Soundscaper JSON is nested too deeply") from error
    if not isinstance(value, dict):
        raise ValueError("Expected a Soundscaper JSON object")
    return value


def validate_manifest(manifest, root):
    """Validate the entire snapshot and contained files before changing the scene."""
    if not isinstance(manifest, dict) or type(manifest.get("schemaVersion")) is not int or manifest["schemaVersion"] != 1:
        raise ValueError("Unsupported Soundscaper manifest version")
    _text(manifest.get("projectId"), "project ID", 256)
    _text(manifest.get("projectName"), "project name")
    _integer(manifest.get("revision"), "revision")
    tracks = manifest.get("tracks")
    if not isinstance(tracks, list) or len(tracks) > MAX_TRACKS:
        raise ValueError("Soundscaper bundles support at most 128 tracks")
    root = Path(root).resolve()
    ids = set()
    for track in tracks:
        if not isinstance(track, dict):
            raise ValueError("Invalid Soundscaper track")
        track_id = _text(track.get("id"), "track ID", 256)
        if track_id in ids:
            raise ValueError("Duplicate Soundscaper track ID")
        ids.add(track_id)
        _text(track.get("name"), "track name")
        filename = _text(track.get("fileName"), "track filename", 4096)
        relative = PurePosixPath(filename)
        if relative.is_absolute() or ".." in relative.parts or "\\" in filename or ":" in filename:
            raise ValueError("Track path must stay inside its Soundscaper bundle")
        path = (root / filename).resolve()
        if not path.is_relative_to(root) or path.suffix.lower() != ".wav" or not path.is_file():
            raise ValueError("Track must reference an existing WAV inside its Soundscaper bundle")
        _seconds(track.get("startSeconds"), "track start")
        _seconds(track.get("durationSeconds"), "track duration")
        if type(track.get("mute")) is not bool:
            raise ValueError("Invalid track mute state")
    return manifest


def scene_strips(scene):
    editor = scene.sequence_editor or scene.sequence_editor_create()
    return editor.strips if hasattr(editor, "strips") else editor.sequences


def _set_time(strip, modern, legacy, value):
    setattr(strip, modern if hasattr(strip, modern) else legacy, value)


def _reload_sounds(scene, strips, changed):
    """Reload source lengths while preserving selection and strip identity."""
    selected = [(strip, strip.select) for strip in strips]
    try:
        for strip, _was_selected in selected:
            strip.select = strip in changed
        # sequencer_scene is required by current Blender; 4.2 uses scene.
        with bpy.context.temp_override(scene=scene, sequencer_scene=scene):
            bpy.ops.sequencer.reload(adjust_length=False)
    finally:
        for strip, was_selected in selected:
            strip.select = was_selected


def apply_manifest(scene, manifest, root):
    """Reconcile our project tracks; unrelated strips and Blender mix settings survive."""
    manifest = validate_manifest(manifest, root)
    root = Path(root).resolve()
    strips = scene_strips(scene)
    project_id = manifest["projectId"]
    managed = [strip for strip in strips if strip.get(PROJECT_KEY) == project_id and strip.type == "SOUND"]
    existing = {strip.get(TRACK_KEY): strip for strip in managed}
    wanted = {track["id"] for track in manifest["tracks"]}
    retained = [strip for strip in strips if strip not in managed or strip.get(TRACK_KEY) in wanted]
    channels = {strip.channel for strip in retained}
    free = [channel for channel in range(1, 129) if channel not in channels]
    additions = [track for track in manifest["tracks"] if track["id"] not in existing]
    if len(additions) > len(free):
        raise ValueError("Not enough free Blender channels; move or remove strips before importing")
    fps = scene.render.fps / scene.render.fps_base
    if not math.isfinite(fps) or fps <= 0:
        raise ValueError("Invalid Blender frame rate")
    for track in manifest["tracks"]:
        if (track["startSeconds"] + track["durationSeconds"]) * fps + 1 > 1_048_574:
            raise ValueError("Soundscaper track exceeds Blender's timeline frame limit")

    loaded, changed, old_sounds = {}, [], []
    try:
        # Decode new WAVs before any destructive reconciliation.
        for track in manifest["tracks"]:
            strip = existing.get(track["id"])
            filepath = str(root / track["fileName"])
            if strip is None or strip.sound is None or str(Path(bpy.path.abspath(strip.sound.filepath)).resolve()) != filepath:
                loaded[track["id"]] = bpy.data.sounds.load(filepath, check_existing=False)
        for track in manifest["tracks"]:
            strip = existing.get(track["id"])
            start = 1 + round(track["startSeconds"] * fps)
            if strip is None:
                strip = strips.new_sound(name=track["name"], filepath=str(root / track["fileName"]),
                                         channel=free.pop(0), frame_start=start)
                strip[PROJECT_KEY], strip[TRACK_KEY] = project_id, track["id"]
                existing[track["id"]] = strip
            if track["id"] in loaded:
                old_sounds.append(strip.sound)
                strip.sound = loaded[track["id"]]
                changed.append(strip)
        if changed:
            _reload_sounds(scene, strips, changed)
        for track in manifest["tracks"]:
            strip = existing[track["id"]]
            start = 1 + round(track["startSeconds"] * fps)
            duration = max(1, round(track["durationSeconds"] * fps))
            strip.name, strip.mute = track["name"], track["mute"]
            _set_time(strip, "content_start", "frame_start", start)
            _set_time(strip, "left_handle", "frame_final_start", start)
            _set_time(strip, "right_handle", "frame_final_end", start + duration)
            scene.frame_end = max(scene.frame_end, start + duration - 1)
        for strip in managed:
            if strip.get(TRACK_KEY) not in wanted:
                old_sounds.append(strip.sound)
                strips.remove(strip)
    finally:
        for sound in old_sounds + list(loaded.values()):
            if sound is None:
                continue
            try:
                if sound.users == 0:
                    bpy.data.sounds.remove(sound)
            except ReferenceError:
                pass
    return manifest["revision"]


def read_connection(root):
    connection = _read_json(Path(root) / "live.json")
    if type(connection.get("schemaVersion")) is not int or connection["schemaVersion"] != 1 or connection.get("host") != "127.0.0.1":
        raise ValueError("Live sync requires a version 1 loopback connection")
    _integer(connection.get("port"), "live port", 1, 65535)
    token = _text(connection.get("token"), "live token", 256)
    if not re.fullmatch(r"[A-Za-z0-9_-]{32,256}", token):
        raise ValueError("Invalid Soundscaper live token")
    return connection


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class LiveSession:
    def __init__(self, scene, root, manifest, connection):
        self.scene, self.root, self.project_id = scene, root, manifest["projectId"]
        self.revision, self.connection = manifest["revision"], connection
        self.updates, self.stopped, self.last_error = queue.Queue(maxsize=1), threading.Event(), None
        self.thread = threading.Thread(target=self.poll, name="Soundscaper live sync", daemon=True)

    def enqueue(self, update):
        try:
            self.updates.put_nowait(update)
        except queue.Full:
            try:
                self.updates.get_nowait()
            except queue.Empty:
                pass
            try:
                self.updates.put_nowait(update)
            except queue.Full:
                pass

    def poll(self):
        # Networking and JSON validation only. All bpy access stays in live_timer.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        connection = self.connection
        while not self.stopped.is_set():
            try:
                request = urllib.request.Request(
                    f"http://127.0.0.1:{connection['port']}/snapshot?after={self.revision}",
                    headers={"Authorization": "Bearer " + connection["token"]},
                )
                with opener.open(request, timeout=2) as response:
                    if response.status == 200:
                        manifest = validate_manifest(_decode_json(response.read(MAX_JSON_BYTES + 1)), self.root)
                        if manifest["projectId"] != self.project_id:
                            raise ValueError("Live connection changed Soundscaper project")
                        if manifest["revision"] > self.revision:
                            self.enqueue((manifest, None))
                    elif response.status != 204:
                        raise ValueError("Unexpected Soundscaper live response")
            except (OSError, ValueError, urllib.error.URLError) as error:
                self.enqueue((None, str(error)))
            self.stopped.wait(0.25)


def live_timer():
    session = _live_session
    if session is None:
        return None
    try:
        manifest, error = session.updates.get_nowait()
    except queue.Empty:
        return 0.1
    try:
        if manifest is not None and manifest["revision"] > session.revision:
            session.revision = apply_manifest(session.scene, manifest, session.root)
            session.last_error = None
        elif error and error != session.last_error:
            print("Soundscaper live sync:", error)
            session.last_error = error
    except ReferenceError:
        stop_live()
        return None
    except (OSError, ValueError, RuntimeError) as failure:
        if str(failure) != session.last_error:
            print("Soundscaper live sync:", failure)
            session.last_error = str(failure)
    return 0.1


def start_live(scene, filepath):
    global _live_session
    path = Path(filepath).resolve()
    manifest = validate_manifest(_read_json(path), path.parent)
    connection = read_connection(path.parent)
    apply_manifest(scene, manifest, path.parent)
    stop_live()
    _live_session = LiveSession(scene, path.parent, manifest, connection)
    _live_session.thread.start()
    bpy.app.timers.register(live_timer, first_interval=0.1)


def stop_live():
    global _live_session
    session, _live_session = _live_session, None
    if session is not None:
        session.stopped.set()
    if bpy.app.timers.is_registered(live_timer):
        bpy.app.timers.unregister(live_timer)


@persistent
def stop_on_load(_unused):
    stop_live()


class SOUNDSCAPER_OT_import(bpy.types.Operator, ImportHelper):
    bl_idname = "soundscaper.import_tracks"
    bl_label = "Import Soundscaper track list"
    bl_options = {"REGISTER", "UNDO"}
    filename_ext = ".json"
    filter_glob: StringProperty(default="*.json", options={"HIDDEN"})

    def execute(self, context):
        try:
            path = Path(self.filepath).resolve()
            apply_manifest(context.scene, _read_json(path), path.parent)
        except (OSError, ValueError, RuntimeError) as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        return {"FINISHED"}


class SOUNDSCAPER_OT_start_live(bpy.types.Operator, ImportHelper):
    bl_idname = "soundscaper.start_live"
    bl_label = "Start Soundscaper live sync"
    filename_ext = ".json"
    filter_glob: StringProperty(default="*.json", options={"HIDDEN"})

    def execute(self, context):
        try:
            start_live(context.scene, self.filepath)
        except (OSError, ValueError, RuntimeError) as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        self.report({"INFO"}, "Receiving Soundscaper desktop edits")
        return {"FINISHED"}


class SOUNDSCAPER_OT_stop_live(bpy.types.Operator):
    bl_idname = "soundscaper.stop_live"
    bl_label = "Stop Soundscaper live sync"

    @classmethod
    def poll(cls, _context):
        return _live_session is not None

    def execute(self, _context):
        stop_live()
        return {"FINISHED"}


def import_menu(self, _context):
    self.layout.operator(SOUNDSCAPER_OT_import.bl_idname, text="Soundscaper track list (.json)")


def sequencer_menu(self, _context):
    self.layout.operator(SOUNDSCAPER_OT_start_live.bl_idname, text="Start Soundscaper live sync")
    self.layout.operator(SOUNDSCAPER_OT_stop_live.bl_idname, text="Stop Soundscaper live sync")


CLASSES = (SOUNDSCAPER_OT_import, SOUNDSCAPER_OT_start_live, SOUNDSCAPER_OT_stop_live)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.TOPBAR_MT_file_import.append(import_menu)
    bpy.types.SEQUENCER_MT_add.append(sequencer_menu)
    bpy.app.handlers.load_pre.append(stop_on_load)


def unregister():
    stop_live()
    bpy.app.handlers.load_pre.remove(stop_on_load)
    bpy.types.SEQUENCER_MT_add.remove(sequencer_menu)
    bpy.types.TOPBAR_MT_file_import.remove(import_menu)
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__":
    register()
