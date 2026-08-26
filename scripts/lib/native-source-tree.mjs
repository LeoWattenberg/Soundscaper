/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared traversal for the pinned native source closures. */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Walks a pinned native source tree without following links.
 *
 * An entry that is neither a regular file nor a real directory is returned as
 * irregular rather than skipped. A symbolic link names bytes outside the pinned
 * closure yet still reaches the compiler through its include path, so a closure
 * audit that ignored one would report green over source it never read.
 */
export function listNativeSourceTree(directory) {
	const files = [];
	const irregular = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isSymbolicLink()) irregular.push(path);
		else if (entry.isDirectory()) {
			const nested = listNativeSourceTree(path);
			files.push(...nested.files);
			irregular.push(...nested.irregular);
		} else if (entry.isFile() && statSync(path).isFile()) files.push(path);
		else irregular.push(path);
	}
	return { files, irregular };
}
