; SPDX-License-Identifier: BSD-2-Clause
; Fileless subset of the upstream Nyquist 3.16 initialization sequence.

(expand 5)
(load "xlinit.lsp" :verbose nil)
(setf *gc-flag* nil)
(load "misc.lsp" :verbose nil)
(load "evalenv.lsp" :verbose nil)
(load "printrec.lsp" :verbose nil)
(load "sndfnint.lsp" :verbose nil)
(load "seqfnint.lsp" :verbose nil)
(load "velocity.lsp" :verbose nil)
(if (not (load "system.lsp" :verbose nil))
  (error "Nyquist could not load the browser runtime"))
(load "nyquist.lsp" :verbose nil)
;; nyquist.lsp's 64-bit probe wraps on wasm32 and leaves NY:ALL at zero.
(setf NY:ALL 2130706432)
(load "nyqmisc.lsp" :verbose nil)
(load "stk.lsp" :verbose nil)
(load "envelopes.lsp" :verbose nil)
(load "equalizer.lsp" :verbose nil)
(load "xm.lsp" :verbose nil)
(load "sal.lsp" :verbose nil)
