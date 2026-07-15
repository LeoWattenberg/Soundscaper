; SPDX-License-Identifier: GPL-2.0-or-later
; Soundscaper browser initialization for Audacity's Nyquist runtime.

(setf *breakenable* t)
(load "nyinit.lsp" :verbose nil)

;; Audacity plug-ins use _ for optional, plug-in-provided translations.
(defun underscore (txt) txt)
(defun _(txt &aux newtxt)
  (when (boundp '*locale*)
    (when (not (listp *locale*))
      (error "bad argument type" *locale*))
    (let* ((cc (get '*audacity* 'language))
           (translations (second (assoc cc *locale* :test 'string-equal))))
      (if translations
        (let ((translation (second (assoc txt translations :test 'string=))))
          (if translation
            (if (stringp translation)
              (setf newtxt translation)
              (error "bad argument type" translation))))
        (setf *locale* '*unbound*))))
  (if newtxt newtxt (underscore txt)))

;; Audacity's plug-ins use this safe string helper from its desktop support.
;; Keep the helper without loading AUD-DO or any desktop/file primitives.
(defmacro string-append (str &rest strs)
  `(setf ,str (strcat ,str ,@strs)))

;; AUD-DO, desktop file helpers, and device playback are intentionally absent.
