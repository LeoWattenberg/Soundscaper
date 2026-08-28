/* SPDX-License-Identifier: AGPL-3.0-only */

import { extname } from 'node:path';

export const MAINTAINED_SOURCE_ROOTS = Object.freeze([
	'desktop', 'native', 'scripts', 'src', 'tests',
]);

const MAINTAINED_SOURCE_EXTENSIONS = new Set([
	'.c', '.cc', '.cjs', '.cmake', '.cpp', '.css', '.cts', '.cxx',
	'.h', '.hh', '.hpp', '.hxx', '.inc', '.js', '.jsx', '.m', '.mjs', '.mm',
	'.mts', '.ts', '.tsx',
]);
const MAINTAINED_SOURCE_NAMES = new Set(['CMakeLists.txt']);

export function isMaintainedSourceFile(name) {
	return MAINTAINED_SOURCE_NAMES.has(name) || MAINTAINED_SOURCE_EXTENSIONS.has(extname(name));
}
