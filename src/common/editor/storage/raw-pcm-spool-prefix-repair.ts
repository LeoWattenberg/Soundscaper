/* SPDX-License-Identifier: AGPL-3.0-only */

import type { RawPcmSpoolRecord } from './raw-pcm-spool-repository.ts';

/** Restore the one unacknowledged raw-audio append allowed by spool recovery. */
export async function restoreRawPcmAcknowledgedPrefix(
	current: RawPcmSpoolRecord,
	acknowledged: RawPcmSpoolRecord,
	ports: Readonly<{
		replace: () => Promise<boolean>;
		load: () => Promise<RawPcmSpoolRecord | null>;
		deleteTail: () => Promise<void>;
	}>,
): Promise<RawPcmSpoolRecord> {
	assertRawPcmAcknowledgedPrefix(current, acknowledged);
	if (!await ports.replace()) {
		const observed = await ports.load();
		if (!observed || JSON.stringify(observed) !== JSON.stringify(acknowledged)) {
			throw new Error('Raw PCM ownership changed before acknowledged-prefix repair.');
		}
	}
	await ports.deleteTail();
	return acknowledged;
}

function assertRawPcmAcknowledgedPrefix(
	current: RawPcmSpoolRecord,
	acknowledged: RawPcmSpoolRecord,
): void {
	if (current.state !== 'capturing' || acknowledged.state !== 'capturing'
		|| current.chunkCount !== acknowledged.chunkCount + 1
		|| current.frameCount <= acknowledged.frameCount
		|| JSON.stringify(current.data) !== JSON.stringify(acknowledged.data)) {
		throw new Error('Raw PCM prefix repair does not describe exactly one unacknowledged chunk.');
	}
}
