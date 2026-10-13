# SPDX-License-Identifier: AGPL-3.0-only
"""Pure admission for the fixed authored-title GTK qualification; no X11 side effects."""
import json
import os
import re
from pathlib import Path


def validate_arguments(arguments, environment=None):
    env = os.environ if environment is None else environment
    if len(arguments) != 3:
        raise ValueError("Expected owned directory, exact mode and filename.")
    owned, mode, name = arguments
    titles = {"save-project": "Save Motionscaper project", "export": "Export ProRes 4444", "cancel-export": "Export ProRes 4444"}
    if mode not in titles or name != ("saved.mscape" if mode == "save-project" else "output.mov"):
        raise ValueError("Unexpected authored chooser mode or filename.")
    directory = Path(owned)
    if not re.fullmatch(r"/[A-Za-z0-9_./-]+", owned) or str(directory.resolve()) != owned or not directory.is_dir():
        raise ValueError("Expected canonical owned output directory.")
    metadata = directory.stat()
    if metadata.st_uid != os.getuid() or metadata.st_mode & 0o777 != 0o700:
        raise ValueError("Authored output must remain private to its owner.")
    owner_path = directory / "chooser-owner.json"
    if owner_path.is_symlink() or owner_path.stat().st_size > 4096:
        raise ValueError("Invalid chooser owner record.")
    record = json.loads(owner_path.read_text())
    if not isinstance(record, dict) or set(record) != {"owner", "display"}:
        raise ValueError("Invalid chooser owner record.")
    owner = record["owner"]
    if not isinstance(owner, dict) or type(owner.get("pid")) is not int or owner["pid"] < 1 or not isinstance(owner.get("startTicks"), str):
        raise ValueError("Invalid chooser process identity.")
    display = record["display"]
    if not isinstance(display, str) or not re.fullmatch(r":\d+", display) or env.get("DISPLAY") != display or env.get("MOTIONSCAPER_QUALIFICATION_PRIVATE_DISPLAY") != display:
        raise ValueError("Chooser requires its explicitly owned private display.")
    validate_owner(owner["pid"], owner["startTicks"])
    selected = directory / name
    if selected.exists() or selected.is_symlink():
        raise ValueError("Authored destinations must be new; overwrite is not admitted.")
    return {"owned": owned, "mode": mode, "selected_path": str(selected), "dialog_title": titles[mode], "owner_pid": owner["pid"], "owner_start": owner["startTicks"]}


def validate_owner(pid, start_ticks):
    fields = Path("/proc", str(pid), "stat").read_text().rsplit(")", 1)[1].split()
    if fields[19] != start_ticks or fields[0] in {"Z", "X"}:
        raise ValueError("Chooser application identity is stale.")


def validate_window(owner_pid, actual_pid, target, focus, found, width, height, mapped):
    if actual_pid != owner_pid or target != focus or target != found:
        raise RuntimeError("Owned Save dialog lost its exact process/focus/caption.")
    if (width, height, mapped) != (1124, 822, 2):
        raise RuntimeError("Observed Save dialog layout changed.")
