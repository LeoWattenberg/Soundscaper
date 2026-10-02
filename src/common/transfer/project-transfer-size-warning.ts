/* SPDX-License-Identifier: AGPL-3.0-only */

import { confirmFileSizeWarning, type FileSizeWarningOptions } from '../editor/controller/shared/file-size-warning.ts';
import { envelopeFor, expectProjectTransferKind, type ProjectTransferChannel } from './project-transfer-handshake-channel.ts';
import { PROJECT_TRANSFER_DEFAULT_TOTAL_BYTES, PROJECT_TRANSFER_MAX_ENTRY_BYTES, projectTransferError, type ProjectTransferEntry,
	type ProjectTransferSizeOfferMessage } from './project-transfer-handshake-wire.ts';

/** Request a numeric, operation-owned admission before posting any archive payload. */
export async function negotiateTransferSizeOffer(
	channel: ProjectTransferChannel, sessionId: string, entries: readonly ProjectTransferEntry[],
	peerMaximumBytes: number, options: FileSizeWarningOptions,
): Promise<void> {
	let totalBytes = 0, maxEntryBytes = 1;
	for (const entry of entries) {
		totalBytes += entry.byteLength; maxEntryBytes = Math.max(maxEntryBytes, entry.byteLength);
		if (!Number.isSafeInteger(totalBytes)) throw projectTransferError('PAYLOAD_TOO_LARGE', 'The transfer exceeds the safe byte range.');
	}
	const warningOptions = { ...options, signal: channel.signal };
	await confirmFileSizeWarning(maxEntryBytes, Math.min(peerMaximumBytes, PROJECT_TRANSFER_MAX_ENTRY_BYTES), 'Project transfer archive', warningOptions);
	await confirmFileSizeWarning(totalBytes, PROJECT_TRANSFER_DEFAULT_TOTAL_BYTES, 'Project transfer archives', warningOptions);
	if (maxEntryBytes <= peerMaximumBytes && totalBytes <= PROJECT_TRANSFER_DEFAULT_TOTAL_BYTES) return;
	channel.send({ ...envelopeFor(sessionId), kind: 'size-offer', maxEntryBytes, totalBytes });
	const accepted = await expectProjectTransferKind(channel, 'size-accept');
	if (accepted.maxEntryBytes !== maxEntryBytes || accepted.totalBytes !== totalBytes) {
		throw projectTransferError('INVALID_FIELD', 'The peer changed the offered transfer size admission.');
	}
}

/** The receiver decides on metadata before permitting the sender to deliver bytes. */
export async function acceptTransferSizeOffer(
	channel: ProjectTransferChannel, sessionId: string, offer: ProjectTransferSizeOfferMessage,
	maximumBytes: number, options: FileSizeWarningOptions,
): Promise<number> {
	const warningOptions = { ...options, signal: channel.signal };
	const admittedBytes = await confirmFileSizeWarning(offer.maxEntryBytes, maximumBytes, 'Project transfer archive', warningOptions);
	await confirmFileSizeWarning(offer.totalBytes, PROJECT_TRANSFER_DEFAULT_TOTAL_BYTES, 'Project transfer archives', warningOptions);
	channel.send({ ...envelopeFor(sessionId), kind: 'size-accept', maxEntryBytes: offer.maxEntryBytes, totalBytes: offer.totalBytes });
	return admittedBytes;
}
