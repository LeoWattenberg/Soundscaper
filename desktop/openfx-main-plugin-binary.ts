/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact, bounded authentication for a user-selected OpenFX binary. */

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import {
	HELPER_RESOURCE_HARD_LIMITS,
	type HelperExecutableGrant,
} from './helper-contract.ts';

const HASH_CHUNK_BYTES = 16 * 1024 * 1024;

export async function authenticateFramescaperOpenFxPluginBinary(
	pathValue: string,
): Promise<HelperExecutableGrant> {
	const path = absolutePath(pathValue);
	const selected = await lstat(path);
	if (!selected.isFile() || selected.isSymbolicLink() || selected.size < 1
		|| selected.size > HELPER_RESOURCE_HARD_LIMITS.maximumInputBytes) {
		throw new Error('The selected OpenFX plug-in is not one bounded canonical file.');
	}
	const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const before = await handle.stat();
		if (!before.isFile() || before.size !== selected.size
			|| selected.dev !== before.dev || selected.ino !== before.ino) {
			throw new Error('The selected OpenFX plug-in is not one canonical file.');
		}
		const hash = createHash('sha256');
		let offset = 0;
		while (offset < before.size) {
			const bytes = Buffer.allocUnsafe(Math.min(HASH_CHUNK_BYTES, before.size - offset));
			const result = await handle.read(bytes, 0, bytes.byteLength, offset);
			if (result.bytesRead !== bytes.byteLength) {
				throw new Error('The selected OpenFX plug-in changed while it was authenticated.');
			}
			hash.update(bytes);
			offset += bytes.byteLength;
		}
		const after = await handle.stat();
		if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
			|| before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
			throw new Error('The selected OpenFX plug-in changed while it was authenticated.');
		}
		return Object.freeze({
			role: 'ofx-plugin' as const,
			path,
			bytes: before.size,
			sha256: hash.digest('hex'),
			identity: Object.freeze({ dev: before.dev, ino: before.ino }),
		});
	} finally { await handle.close(); }
}

export function sameFramescaperOpenFxPluginBinary(
	left: HelperExecutableGrant,
	right: HelperExecutableGrant,
): boolean {
	return left.path === right.path && left.bytes === right.bytes && left.sha256 === right.sha256
		&& left.identity.dev === right.identity.dev && left.identity.ino === right.identity.ino;
}

function absolutePath(value: unknown): string {
	if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')) {
		throw new TypeError('The OpenFX plug-in binary must be an absolute path.');
	}
	const normalized = resolve(value);
	if (normalized !== value) throw new TypeError('The OpenFX plug-in binary must be normalized.');
	return normalized;
}
