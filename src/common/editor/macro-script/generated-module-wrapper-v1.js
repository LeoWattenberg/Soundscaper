/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Coverage source for the fixed half of a generated macro module.
 *
 * This module is never loaded directly. Runtime coverage maps the fixed
 * wrapper, prelude import and boot call here while leaving the program authored
 * by the user deliberately unmapped.
 */
const __macroMain = async (_sound) => {
	"use strict";
	// The author-owned program occupies this deliberately unmapped line.
};
import './sandbox-prelude.js';
globalThis.__macroBoot(__macroMain);
