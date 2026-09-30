/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bounded checkpoint manifest reads shared by the durable record generations. */

import { readBoundedRegularFile } from './bounded-regular-file.ts';

export async function readNativeCheckpointManifestBytes(
	path: string,
	maximumBytes: number,
): Promise<Buffer | null> {
	const result = await readBoundedRegularFile(path, maximumBytes, {
		allowEmpty: true,
		failureMode: 'preserve',
	});
	if (result.status === 'available') return Buffer.from(result.bytes);
	if (result.reason === 'missing') return null;
	throw new Error(result.reason === 'limit' || result.reason === 'invalid'
		? 'A checkpoint manifest is not one bounded regular file.'
		: 'A checkpoint manifest changed during inspection.');
}
