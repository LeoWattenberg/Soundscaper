/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EncodedCaptureSpoolRecord } from './encoded-capture-spool-repository.ts';

/** Validate the only backward CAS allowed by capture storage: one unacknowledged append. */
function assertEncodedCaptureAcknowledgedPrefix(
	current: EncodedCaptureSpoolRecord,
	acknowledged: EncodedCaptureSpoolRecord,
): void {
	if (current.state !== 'capturing' || acknowledged.state !== 'capturing'
		|| current.packetCount !== acknowledged.packetCount + 1
		|| current.chunkCount <= acknowledged.chunkCount || current.byteLength <= acknowledged.byteLength
		|| current.updatedAt < acknowledged.updatedAt) {
		throw new Error('Encoded capture prefix repair does not describe exactly one unacknowledged packet.');
	}
}

export async function restoreEncodedCaptureAcknowledgedPrefix(
	current: EncodedCaptureSpoolRecord,
	acknowledged: EncodedCaptureSpoolRecord,
	ports: Readonly<{
		replace: () => Promise<boolean>;
		load: () => Promise<EncodedCaptureSpoolRecord | null>;
		deleteTail: () => Promise<boolean>;
	}>,
): Promise<EncodedCaptureSpoolRecord> {
	assertEncodedCaptureAcknowledgedPrefix(current, acknowledged);
	if (!await ports.replace()) {
		const observed = await ports.load();
		if (!observed || JSON.stringify(observed) !== JSON.stringify(acknowledged)) {
			throw new Error('Encoded capture ownership changed before acknowledged-prefix repair.');
		}
	}
	if (!await ports.deleteTail()) {
		throw new Error('Encoded capture tail ownership changed before acknowledged-prefix repair.');
	}
	return acknowledged;
}
