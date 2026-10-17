#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Select one smoke-owned path in the real Electron GTK open dialog on X11."""
import ctypes
import re
import sys
import time

if len(sys.argv) != 2 or not re.fullmatch(r"/[A-Za-z0-9_./-]+/saved\.mscape", sys.argv[1]):
    raise SystemExit("Expected one smoke-owned ASCII saved.mscape path.")
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
        if value == "Connect saved Motionscaper composition":
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

try:
    deadline = time.monotonic() + 15
    target = None
    while time.monotonic() < deadline and not target:
        target = find_dialog(x11.XDefaultRootWindow(display))
        if not target:
            time.sleep(0.05)
    if not target:
        raise RuntimeError("The real native Motionscaper file chooser did not open.")
    x11.XRaiseWindow(display, target)
    x11.XSetInputFocus(display, target, 1, 0)
    x11.XFlush(display)
    time.sleep(0.2)
    chord(ord("l"))
    x11.XFlush(display)
    time.sleep(0.2)
    chord(ord("a"))
    x11.XFlush(display)
    time.sleep(0.1)
    for character in sys.argv[1]:
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
    # GTK's explicit Open mnemonic confirms the location entry, whose Return
    # handling can defer to asynchronous filename completion.
    key(0xFFE9, True)
    key(ord("o"), True)
    key(ord("o"), False)
    key(0xFFE9, False)
    x11.XFlush(display)
    deadline = time.monotonic() + 5
    while find_dialog(x11.XDefaultRootWindow(display)):
        if time.monotonic() >= deadline:
            raise RuntimeError("Native file chooser remained open after selection.")
        time.sleep(0.05)
    if errors:
        raise RuntimeError("Native chooser X11 request failed: " + str(errors))
    print("MOTIONSCAPER_NATIVE_FILE_CHOOSER_SELECTED")
finally:
    x11.XCloseDisplay(display)
