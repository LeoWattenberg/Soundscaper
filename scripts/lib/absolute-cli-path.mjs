/* SPDX-License-Identifier: AGPL-3.0-only */

import { posix, win32 } from 'node:path';

/** Normalize one absolute path received across a platform-specific CLI boundary. */
export function normalizeAbsoluteCliPath(value, label) {
	if (typeof value !== 'string' || value.includes('\0')) {
		throw new TypeError(`The ${label} must be an absolute path without NUL bytes.`);
	}
	const path = /^(?:[a-z]:[\\/]|\\\\)/iu.test(value) ? win32 : posix;
	if (!path.isAbsolute(value)) {
		throw new TypeError(`The ${label} must be an absolute path without NUL bytes.`);
	}
	return path.normalize(value);
}
