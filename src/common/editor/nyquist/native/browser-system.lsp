; SPDX-License-Identifier: BSD-2-Clause
; Browser-safe replacement for Nyquist's desktop system.lsp.

(if (not (boundp '*default-sf-format*))
  (setf *default-sf-format* snd-head-wave))
(if (not (boundp '*default-sound-file*))
  (setf *default-sound-file* ""))
(if (not (boundp '*default-sf-dir*))
  (setf *default-sf-dir* ""))
(if (not (boundp '*default-sf-mode*))
  (setf *default-sf-mode* snd-mode-pcm))
(if (not (boundp '*default-sf-bits*))
  (setf *default-sf-bits* 16))
(if (not (boundp '*default-plot-file*))
  (setf *default-plot-file* ""))

(setf *file-separator* #\/)
(setf *runtime-path* "/runtime/")

(defun current-path () "/runtime/")
(defun full-name-p (filename) nil)
(defun relative-path-p (filename) t)
(defun play-file (name) (error "Audio-device access is disabled in the browser" name))
(defmacro play (expr) expr)
