/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact loader policy shared by isolated plug-in and Vamp peers. */

import { resolve } from 'node:path';

export function professionalPeerLoaderArgumentsValid(value: readonly string[]): boolean {
	return Array.isArray(value) && value.length === 3 && value[0] === '--inhibit-cache'
		&& value[1] === '--library-path' && typeof value[2] === 'string'
		&& value[2].length >= 1 && value[2].length <= 32_768 && !value[2].includes('\0')
		&& value[2].split(':').length <= 48 && value[2].split(':').every((path) => (
			path.length >= 1 && resolve(path) === path
		));
}
