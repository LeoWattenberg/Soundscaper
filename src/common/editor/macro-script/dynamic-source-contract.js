/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const TEXT_ENCODER = new TextEncoder();

export const MACRO_SANDBOX_SOURCE_URL_PREFIX = 'soundscaper-macro://module-v1/';
export const MACRO_MODULE_RECIPE_PREFIX = `const __macroMain = async (sound) => {
"use strict";
`;
export const MACRO_MODULE_RECIPE_CLOSE = '\n};\n';
export const MACRO_MODULE_RECIPE_BOOT = '\nglobalThis.__macroBoot(__macroMain);\n';
export const MACRO_MODULE_SOURCE_URL_PREFIX = '//# sourceURL=';

/** Build the exact, versioned module body executed by the macro worker. */
export function buildAttestedMacroSandboxModule(preludeSource, program) {
	const recipeSha256 = sourceSha256(macroModuleRecipeSource(preludeSource));
	const programSha256 = sourceSha256(program);
	const sourceURL = `${MACRO_SANDBOX_SOURCE_URL_PREFIX}${recipeSha256}/${programSha256}.mjs`;
	return `${MACRO_MODULE_RECIPE_PREFIX}${program}${MACRO_MODULE_RECIPE_CLOSE}${preludeSource}`
		+ `${MACRO_MODULE_RECIPE_BOOT}${MACRO_MODULE_SOURCE_URL_PREFIX}${sourceURL}\n`;
}

/** Bytes hashed into the fixed half of a macro module's two-part identity. */
export function macroModuleRecipeSource(preludeSource) {
	return `${MACRO_MODULE_RECIPE_PREFIX}${MACRO_MODULE_RECIPE_CLOSE}${preludeSource}`
		+ MACRO_MODULE_RECIPE_BOOT;
}

function sourceSha256(source) {
	return bytesToHex(sha256(TEXT_ENCODER.encode(source)));
}
