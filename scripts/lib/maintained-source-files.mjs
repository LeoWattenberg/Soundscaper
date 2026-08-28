/* SPDX-License-Identifier: AGPL-3.0-only */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { isMaintainedSourceFile } from './maintained-source-policy.mjs';

const IGNORED_DIRECTORY_NAMES = new Set(['node_modules', 'test-results']);

/** Collect maintained sources recursively, including nested native source trees. */
export function collectMaintainedSourceFiles(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		if (entry.isDirectory() && IGNORED_DIRECTORY_NAMES.has(entry.name)) return [];
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return collectMaintainedSourceFiles(path);
		return entry.isFile() && isMaintainedSourceFile(entry.name) ? [path] : [];
	});
}
