# SPDX-License-Identifier: AGPL-3.0-only
"""Bounded passive chooser evidence; never an input or qualification authority."""
import ctypes
import json
import sys
import time


class MotionChooserObservation:
    MAX_WINDOWS = 256
    MAX_CANDIDATES = 8
    MAX_DEPTH = 8
    MAX_RECORDS = 4
    MAX_RECORD_BYTES = 2048
    MAX_BYTES = 8192

    def __init__(self, x11, attributes_type, display_name, title):
        self.x11, self.attributes_type = x11, attributes_type
        self.display_name, self.title = (display_name or "")[:128], title
        self.display = None
        self.records = self.bytes = 0
        self.errors = []
        try:
            ptr, window = ctypes.c_void_p, ctypes.c_ulong
            x11.XGetInputFocus.argtypes = [ptr, ctypes.POINTER(window), ctypes.POINTER(ctypes.c_int)]
            x11.XInternAtom.argtypes = [ptr, ctypes.c_char_p, ctypes.c_int]
            x11.XInternAtom.restype = ctypes.c_ulong
            x11.XGetWindowProperty.argtypes = [ptr, window, ctypes.c_ulong, ctypes.c_long, ctypes.c_long,
                ctypes.c_int, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_int),
                ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ptr)]
            self.display = x11.XOpenDisplay(None)
            if not self.display:
                self._error("passive-display-unavailable")
        except Exception as error:
            self._error(error)

    def _error(self, error):
        if len(self.errors) < 8:
            self.errors.append(str(error)[:96])

    def owns_display(self, display):
        return bool(self.display) and display == self.display

    def x_error(self, event):
        # The caller routes only this passive connection's errors here.
        self._error("X11 error " + str(event.error_code))

    def _pid(self, window):
        value = ctypes.c_void_p()
        try:
            atom = self.x11.XInternAtom(self.display, b"_NET_WM_PID", True)
            if not atom:
                return {"status": "unavailable", "reason": "not-reported"}
            actual, form = ctypes.c_ulong(), ctypes.c_int()
            count, remaining = ctypes.c_ulong(), ctypes.c_ulong()
            status = self.x11.XGetWindowProperty(self.display, window, atom, 0, 1, False, 6,
                ctypes.byref(actual), ctypes.byref(form), ctypes.byref(count), ctypes.byref(remaining), ctypes.byref(value))
            if status != 0:
                return {"status": "unavailable", "reason": "read-failed"}
            if not actual.value:
                return {"status": "unavailable", "reason": "not-reported"}
            if actual.value != 6 or form.value != 32 or count.value != 1 or remaining.value or not value.value:
                return {"status": "unavailable", "reason": "invalid"}
            pid = ctypes.cast(value, ctypes.POINTER(ctypes.c_ulong))[0]
            return {"status": "available", "pid": pid} if 0 < pid <= 0x7fffffff else {"status": "unavailable", "reason": "invalid"}
        except Exception as error:
            self._error(error)
            return {"status": "unavailable", "reason": "read-failed"}
        finally:
            if value.value:
                self.x11.XFree(value)

    def _window(self, window):
        attributes = self.attributes_type()
        if not self.x11.XGetWindowAttributes(self.display, window, ctypes.byref(attributes)):
            return None
        return {"window": int(window), "mapState": attributes.map_state, "ownerPid": self._pid(window)}

    def _candidates(self):
        result = {"windows": [], "examinedWindows": 0, "truncated": False}

        def visit(window, depth):
            if depth > self.MAX_DEPTH or result["examinedWindows"] >= self.MAX_WINDOWS or len(result["windows"]) >= self.MAX_CANDIDATES:
                result["truncated"] = True
                return
            result["examinedWindows"] += 1
            name = ctypes.c_void_p()
            try:
                if self.x11.XFetchName(self.display, window, ctypes.byref(name)) and name.value:
                    if ctypes.string_at(name.value).decode("utf-8", errors="replace") == self.title:
                        observed = self._window(window)
                        if observed and observed["mapState"] == 2:
                            result["windows"].append(observed)
            finally:
                if name.value:
                    self.x11.XFree(name)
            root, parent = ctypes.c_ulong(), ctypes.c_ulong()
            children, count = ctypes.POINTER(ctypes.c_ulong)(), ctypes.c_uint()
            try:
                if self.x11.XQueryTree(self.display, window, ctypes.byref(root), ctypes.byref(parent), ctypes.byref(children), ctypes.byref(count)):
                    for index in range(min(count.value, self.MAX_WINDOWS)):
                        if result["examinedWindows"] >= self.MAX_WINDOWS or len(result["windows"]) >= self.MAX_CANDIDATES:
                            result["truncated"] = True
                            break
                        visit(children[index], depth + 1)
                    if count.value > self.MAX_WINDOWS:
                        result["truncated"] = True
            finally:
                if children:
                    self.x11.XFree(children)

        visit(self.x11.XDefaultRootWindow(self.display), 0)
        return result

    def record(self, stage, target):
        try:
            self._record(stage, target)
        except Exception:
            pass  # Even failure to construct evidence cannot mask the driver.

    def _record(self, stage, target):
        if self.records >= self.MAX_RECORDS:
            return
        self.records += 1
        record = {"stage": stage[:32], "display": self.display_name, "monotonicSeconds": time.monotonic(),
            "targetWindow": int(target), "target": None,
            "focusedWindow": {"status": "unavailable", "reason": "passive-display-unavailable"},
            "sameTitle": {"windows": [], "examinedWindows": 0, "truncated": False}, "errors": []}
        try:
            if self.display:
                record["target"] = self._window(target)
                record["sameTitle"] = self._candidates()
                focus, revert = ctypes.c_ulong(), ctypes.c_int()
                if self.x11.XGetInputFocus(self.display, ctypes.byref(focus), ctypes.byref(revert)):
                    record["focusedWindow"] = {"status": "available", "window": focus.value, "revert": revert.value}
                else:
                    record["focusedWindow"] = {"status": "unavailable", "reason": "read-failed"}
        except Exception as error:
            self._error(error)
            record["focusedWindow"] = {"status": "unavailable", "reason": "read-failed"}
        try:
            record["errors"] = list(self.errors)
            line = "MOTIONSCAPER_CHOOSER_OBSERVATION " + json.dumps(record, separators=(",", ":")) + "\n"
            if len(line.encode("utf-8")) > self.MAX_RECORD_BYTES:
                record = {"stage": stage[:32], "targetWindow": int(target), "truncated": True, "errors": ["observation-record-byte-limit"]}
                line = "MOTIONSCAPER_CHOOSER_OBSERVATION " + json.dumps(record, separators=(",", ":")) + "\n"
            size = len(line.encode("utf-8"))
            if self.bytes + size <= self.MAX_BYTES:
                self.bytes += size
                sys.stderr.write(line)
                sys.stderr.flush()
        except Exception:
            pass  # Evidence loss cannot change the original driver's outcome.

    def close(self):
        try:
            if self.display:
                self.x11.XCloseDisplay(self.display)
        except Exception:
            pass
