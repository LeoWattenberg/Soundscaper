#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Fixed authored-title chooser, retaining the reviewed native scene X11 key driver."""
import ctypes
import sys
import time
import os
import re
import json
import subprocess
from pathlib import Path

from motionscaper_authored_chooser_policy import validate_arguments, validate_owner, validate_window
selection = validate_arguments(sys.argv[1:])
owned, mode = selection["owned"], selection["mode"]
selected_path, dialog_title = selection["selected_path"], selection["dialog_title"]
saving = True
x11 = ctypes.CDLL("libX11.so.6")
xtst = ctypes.CDLL("libXtst.so.6")
ptr = ctypes.c_void_p
window = ctypes.c_ulong
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XOpenDisplay.restype = ptr
x11.XDefaultRootWindow.argtypes = [ptr]
x11.XDefaultRootWindow.restype = window
x11.XQueryTree.argtypes = [ptr, window, ctypes.POINTER(window), ctypes.POINTER(window), ctypes.POINTER(ctypes.POINTER(window)), ctypes.POINTER(ctypes.c_uint)]
x11.XFetchName.argtypes = [ptr, window, ctypes.POINTER(ptr)]
x11.XFree.argtypes = [ptr]
x11.XRaiseWindow.argtypes = [ptr, window]
x11.XSetInputFocus.argtypes = [ptr, window, ctypes.c_int, ctypes.c_ulong]
x11.XKeysymToKeycode.argtypes = [ptr, ctypes.c_ulong]
x11.XKeysymToKeycode.restype = ctypes.c_uint
x11.XFlush.argtypes = [ptr]
x11.XCloseDisplay.argtypes = [ptr]
xtst.XTestFakeKeyEvent.argtypes = [ptr, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
class XError(ctypes.Structure):
    _fields_ = [("type", ctypes.c_int), ("display", ptr), ("resource", window),
                ("serial", ctypes.c_ulong), ("error_code", ctypes.c_ubyte),
                ("request_code", ctypes.c_ubyte), ("minor_code", ctypes.c_ubyte)]

class XWindowAttributes(ctypes.Structure):
    _fields_ = [("x", ctypes.c_int), ("y", ctypes.c_int), ("width", ctypes.c_int), ("height", ctypes.c_int),
                ("border_width", ctypes.c_int), ("depth", ctypes.c_int), ("visual", ptr), ("root", window),
                ("window_class", ctypes.c_int), ("bit_gravity", ctypes.c_int), ("win_gravity", ctypes.c_int),
                ("backing_store", ctypes.c_int), ("backing_planes", ctypes.c_ulong), ("backing_pixel", ctypes.c_ulong),
                ("save_under", ctypes.c_int), ("colormap", ctypes.c_ulong), ("map_installed", ctypes.c_int),
                ("map_state", ctypes.c_int), ("all_event_masks", ctypes.c_long), ("your_event_mask", ctypes.c_long),
                ("do_not_propagate_mask", ctypes.c_long), ("override_redirect", ctypes.c_int), ("screen", ptr)]

x11.XGetWindowAttributes.argtypes = [ptr, window, ctypes.POINTER(XWindowAttributes)]
errors = []
error_callback = ctypes.CFUNCTYPE(ctypes.c_int, ptr, ctypes.POINTER(XError))

@error_callback
def handle_error(_display, event):
    # The chooser can disappear between XQueryTree and XFetchName during polling.
    if event.contents.error_code != 3:
        errors.append(event.contents.error_code)
    return 0

x11.XSetErrorHandler.argtypes = [error_callback]
x11.XSetErrorHandler(handle_error)
display = x11.XOpenDisplay(None)
if not display:
    raise SystemExit("Packaged native chooser qualification requires an X11 display.")

def find_dialog(current, depth=0):
    if depth > 8:
        return None
    name = ptr()
    if x11.XFetchName(display, current, ctypes.byref(name)) and name.value:
        value = ctypes.string_at(name.value).decode("utf-8", errors="replace")
        x11.XFree(name)
        if value == dialog_title:
            attributes = XWindowAttributes()
            if x11.XGetWindowAttributes(display, current, ctypes.byref(attributes)) and attributes.map_state == 2:
                return current
    root, parent = window(), window()
    children, count = ctypes.POINTER(window)(), ctypes.c_uint()
    if x11.XQueryTree(display, current, ctypes.byref(root), ctypes.byref(parent), ctypes.byref(children), ctypes.byref(count)):
        try:
            for index in range(count.value):
                found = find_dialog(children[index], depth + 1)
                if found:
                    return found
        finally:
            if children:
                x11.XFree(children)
    return None

def key(symbol, pressed):
    code = x11.XKeysymToKeycode(display, symbol)
    if not code or not xtst.XTestFakeKeyEvent(display, code, int(pressed), 2):
        raise RuntimeError("Native chooser key could not be sent.")

def chord(symbol):
    key(0xFFE3, True)
    key(symbol, True)
    key(symbol, False)
    key(0xFFE3, False)

def owned_window_pid(target):
    validate_owner(selection["owner_pid"], selection["owner_start"])
    result = subprocess.run(["/usr/bin/xprop", "-id", str(int(target)), "_NET_WM_PID"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5, check=True)
    match = re.fullmatch(r"_NET_WM_PID\(CARDINAL\) = ([1-9][0-9]*)\n", result.stdout.decode("ascii"))
    if not match or int(match[1]) != selection["owner_pid"]:
        raise RuntimeError("Native dialog does not belong to the launched application.")
    return int(match[1])

def observe_owned_dialog(stage, target):
    # This process receives DISPLAY only from its fresh private xvfb-run parent.
    # Observe without changing key delivery or the original disappearance bound.
    if mode not in {"save-project", "export"}:
        return
    prefix = "gtk-save-" if mode == "save-project" else "gtk-export-"
    evidence = {"stage": stage, "display": os.environ.get("DISPLAY"), "target": int(target), "caption": dialog_title, "monotonic": time.monotonic()}
    attributes = XWindowAttributes()
    if x11.XGetWindowAttributes(display, target, ctypes.byref(attributes)):
        evidence["geometry"] = {k: getattr(attributes, k) for k in ("x", "y", "width", "height", "map_state")}
    x11.XGetInputFocus.argtypes = [ptr, ctypes.POINTER(window), ctypes.POINTER(ctypes.c_int)]
    focus, revert = window(), ctypes.c_int()
    x11.XGetInputFocus(display, ctypes.byref(focus), ctypes.byref(revert))
    evidence["focus"] = {"window": int(focus.value), "revert": int(revert.value)}
    evidence["commands"] = []
    for command in (["/usr/bin/xprop", "-id", str(int(target)), "WM_NAME", "_NET_WM_NAME", "_NET_WM_PID"],
                    ["/usr/bin/import", "-window", "root", str(Path(owned) / (prefix + stage + ".png"))]):
        try:
            result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10, check=False)
            evidence["commands"].append({"argv": command, "code": result.returncode, "stdout": result.stdout[:16384].decode("utf-8", errors="replace"), "stderr": result.stderr[:16384].decode("utf-8", errors="replace")})
        except Exception as error:
            evidence["commands"].append({"argv": command, "error": str(error)})
    with (Path(owned) / (prefix + stage + ".json")).open("x") as stream:
        json.dump(evidence, stream, indent=2)
        stream.write("\n")

try:
    deadline = time.monotonic() + 15
    target = None
    while time.monotonic() < deadline and not target:
        target = find_dialog(x11.XDefaultRootWindow(display))
        if not target:
            time.sleep(0.05)
    if not target:
        raise RuntimeError("The real native Motionscaper file chooser did not open.")
    owned_window_pid(target)
    x11.XRaiseWindow(display, target)
    x11.XSetInputFocus(display, target, 1, 0)
    x11.XFlush(display)
    observe_owned_dialog("before", target)
    if mode == "cancel-export":
        key(0xFF1B, True)
        key(0xFF1B, False)
        x11.XFlush(display)
    else:
        time.sleep(0.2)
        chord(ord("l"))
        x11.XFlush(display)
        time.sleep(0.2)
        chord(ord("a"))
        x11.XFlush(display)
        time.sleep(0.1)
        for character in selected_path:
            shifted = character.isupper() or character == "_"
            if shifted:
                key(0xFFE1, True)
            symbol = ord("-" if character == "_" else character.lower())
            key(symbol, True)
            key(symbol, False)
            if shifted:
                key(0xFFE1, False)
        x11.XFlush(display)
        time.sleep(0.6)
        if mode in {"save-project", "export"}:
            # Exact native Save button observed in the owned private GTK dialog.
            # Refuse a different layout instead of guessing or adding a fallback.
            attributes = XWindowAttributes()
            if not x11.XGetWindowAttributes(display, target, ctypes.byref(attributes)) or (attributes.width, attributes.height, attributes.map_state) != (1124, 822, 2):
                raise RuntimeError("Observed Save dialog layout changed.")
            focus, revert = window(), ctypes.c_int()
            x11.XGetInputFocus(display, ctypes.byref(focus), ctypes.byref(revert))
            validate_window(selection["owner_pid"], owned_window_pid(target), target, focus.value,
                            find_dialog(x11.XDefaultRootWindow(display)), attributes.width, attributes.height, attributes.map_state)
            x11.XTranslateCoordinates.argtypes = [ptr, window, window, ctypes.c_int, ctypes.c_int, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(window)]
            origin_x, origin_y, child = ctypes.c_int(), ctypes.c_int(), window()
            if not x11.XTranslateCoordinates(display, target, x11.XDefaultRootWindow(display), 0, 0, ctypes.byref(origin_x), ctypes.byref(origin_y), ctypes.byref(child)):
                raise RuntimeError("Cannot resolve owned Save button coordinates.")
            observe_owned_dialog("ready", target)
            xtst.XTestFakeMotionEvent.argtypes = [ptr, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
            xtst.XTestFakeButtonEvent.argtypes = [ptr, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
            if not xtst.XTestFakeMotionEvent(display, -1, origin_x.value + 1075, origin_y.value + 799, 2):
                raise RuntimeError("Cannot target the observed native Save button.")
            if not xtst.XTestFakeButtonEvent(display, 1, True, 2) or not xtst.XTestFakeButtonEvent(display, 1, False, 2):
                raise RuntimeError("Native Save button event could not be sent.")
        else:
            # Keep the existing Open/export mnemonic behavior unchanged.
            key(0xFFE9, True)
            key(ord("s" if saving else "o"), True)
            key(ord("s" if saving else "o"), False)
            key(0xFFE9, False)
        x11.XFlush(display)
    deadline = time.monotonic() + 5
    while find_dialog(x11.XDefaultRootWindow(display)):
        if time.monotonic() >= deadline:
            observe_owned_dialog("failed", target)
            raise RuntimeError("Native file chooser remained open after selection.")
        time.sleep(0.05)
    if errors:
        raise RuntimeError("Native chooser X11 request failed: " + str(errors))
    print("MOTIONSCAPER_NATIVE_FILE_CHOOSER_SELECTED")
finally:
    x11.XCloseDisplay(display)
