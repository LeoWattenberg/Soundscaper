/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact staging, destination and atomic-publication authority for delivery. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { createBoundedByteChunk } from '../platform/bounded-transfer.ts';
import type { MediaByteWriterPort } from '../platform/media-stream-port.ts';
import {
	SoundscaperDeliveryContractError,
	assertSoundscaperDeliveryCurrentV1,
	type SoundscaperDeliveryCurrentAuthorityV1,
	type SoundscaperDeliveryDescriptionV1,
	type SoundscaperDeliveryPublicationV1,
	type SoundscaperDeliveryResultV1,
} from '../soundscaper-delivery-contract-v1.ts';

export interface SoundscaperDeliveryDestinationV1 {
	readonly destinationGrantId: string;
	readonly fileName: string;
	readonly writer: MediaByteWriterPort;
}

/**
 * A caller-owned, single-use project-revision fence. Commit must atomically
 * revalidate all four authorities and commit, or reject before publication.
 * Once it commits it must resolve; post-commit metadata is not an admission.
 */
export interface SoundscaperDeliveryPublicationFenceV1 {
	readonly authority: SoundscaperDeliveryCurrentAuthorityV1;
	readonly destinationGrantId: string;
	readonly fileName: string;
	commit(request: Readonly<{
		readonly description: SoundscaperDeliveryDescriptionV1;
		readonly result: SoundscaperDeliveryResultV1;
		readonly destination: SoundscaperDeliveryDestinationV1;
		readonly signal: AbortSignal;
	}>): PromiseLike<void> | void;
}

export function validateSoundscaperDeliveryDestinationV1(
	value: unknown,
	description: SoundscaperDeliveryDescriptionV1,
): SoundscaperDeliveryDestinationV1 {
	const row = exactRecord(value, ['destinationGrantId', 'fileName', 'writer'], 'delivery destination');
	const destinationGrantId = ownValue(row, 'destinationGrantId', 'delivery destination');
	if (destinationGrantId !== description.destinationGrantId) {
		throw contractError('The Soundscaper delivery destination grant does not match its description.');
	}
	const fileName = deliveryFileName(ownValue(row, 'fileName', 'delivery destination'));
	const writer = assertWriter(ownValue(row, 'writer', 'delivery destination'));
	return Object.freeze({ destinationGrantId, fileName, writer });
}

export function assertSoundscaperDeliveryPublicationDestinationV1(
	result: SoundscaperDeliveryResultV1,
	destination: SoundscaperDeliveryDestinationV1,
): void {
	if (result.publication.fileName !== destination.fileName) {
		throw contractError('The Soundscaper delivery publication file name does not match its destination.');
	}
}

export function validateSoundscaperDeliveryPublicationFenceV1(
	value: unknown,
	description: SoundscaperDeliveryDescriptionV1,
	result: SoundscaperDeliveryResultV1,
	destination: SoundscaperDeliveryDestinationV1,
): Readonly<Pick<SoundscaperDeliveryPublicationFenceV1, 'commit'>> {
	const row = exactRecord(
		value,
		['authority', 'destinationGrantId', 'fileName', 'commit'],
		'delivery publication fence',
	);
	const authority = ownValue(row, 'authority', 'publication fence');
	assertSoundscaperDeliveryCurrentV1(description, authority);
	if (ownValue(row, 'destinationGrantId', 'publication fence') !== destination.destinationGrantId) {
		throw contractError('The Soundscaper delivery fence destination grant does not match the destination.');
	}
	if (ownValue(row, 'fileName', 'publication fence') !== result.publication.fileName) {
		throw contractError('The Soundscaper delivery fence file name does not match the publication.');
	}
	const commit = ownValue(row, 'commit', 'publication fence');
	if (typeof commit !== 'function') {
		throw new TypeError('The Soundscaper delivery publication fence requires an atomic commit operation.');
	}
	let consumed = false;
	return Object.freeze({
		commit: (request) => {
			if (consumed) throw new Error('The Soundscaper delivery publication fence was already consumed.');
			consumed = true;
			return Reflect.apply(commit, value, [request]) as PromiseLike<void> | void;
		},
	});
}

export function createSoundscaperDeliveryPublicationGuardV1(destination: MediaByteWriterPort) {
	type State = 'open' | 'host-abort-attempted' | 'host-commit-attempted' | 'publication-claimed';
	let state: State = 'open';
	let destinationAborted = false;
	let writePending = false;
	let stagedBytes = 0;
	let nextChunkSequence = 0;
	let finalChunkSeen = false;
	let claimedPublication: SoundscaperDeliveryPublicationV1 | null = null;
	const digest = sha256.create();
	const writer: MediaByteWriterPort = Object.freeze({
		maximumChunkBytes: destination.maximumChunkBytes,
		get bytesWritten() { return destination.bytesWritten; },
		write: async (request: Parameters<MediaByteWriterPort['write']>[0]) => {
			if (state !== 'open' || writePending) closedWriter();
			assertSignal(request?.signal);
			request.signal.throwIfAborted();
			const chunk = ownedStagingChunk(request?.chunk, destination.maximumChunkBytes);
			if (chunk.sequence !== nextChunkSequence) {
				throw new RangeError('Soundscaper delivery byte-chunk sequences must be contiguous and begin at zero.');
			}
			if (finalChunkSeen) throw new Error('The staging writer already received its final byte chunk.');
			writePending = true;
			try {
				await destination.write({ signal: request.signal, chunk });
				// Digest only settled writes: a failed write may be retried at the
				// same sequence, and hashing before settlement counts the bytes
				// twice — refusing the very publication the retry then stages.
				digest.update(chunk.bytes);
				stagedBytes += chunk.byteLength;
				nextChunkSequence += 1;
				finalChunkSeen = chunk.final;
			} finally {
				writePending = false;
			}
		},
		commit: async () => {
			if (state !== 'open' || writePending) closedWriter();
			state = 'host-commit-attempted';
			throw new Error('A Soundscaper render job host must not commit its destination.');
		},
		abort: async (request: Parameters<MediaByteWriterPort['abort']>[0]) => {
			if (state === 'host-abort-attempted') return;
			if (state !== 'open' || writePending) closedWriter();
			state = 'host-abort-attempted';
			await destination.abort(request);
			destinationAborted = true;
		},
	});
	return Object.freeze({
		writer,
		aborted: () => destinationAborted,
		claimPublication: (publication: SoundscaperDeliveryPublicationV1) => {
			if (state !== 'open' || writePending) closedWriter();
			state = 'publication-claimed';
			if (!finalChunkSeen) throw contractError('The staged delivery has no final byte chunk.');
			if (stagedBytes !== publication.byteLength || destination.bytesWritten !== publication.byteLength) {
				throw contractError('The staged delivery byte count disagrees with its publication witness.');
			}
			if (bytesToHex(digest.digest()) !== publication.sha256) {
				throw contractError('The staged delivery digest disagrees with its publication witness.');
			}
			claimedPublication = publication;
		},
		assertPublicationReady: () => {
			if (state !== 'publication-claimed' || claimedPublication === null) {
				throw new Error('The Soundscaper delivery publication was not admitted.');
			}
			assertWriter(destination);
			if (destination.bytesWritten !== claimedPublication.byteLength) {
				throw contractError('The staged delivery changed after publication admission.');
			}
		},
	});
}

function ownedStagingChunk(value: unknown, maximumChunkBytes: number) {
	if (!value || typeof value !== 'object') throw new TypeError('A bounded byte chunk is required.');
	const row = value as Record<string, unknown>;
	const kind = ownValue(row, 'kind', 'staging byte chunk');
	const bytes = ownValue(row, 'bytes', 'staging byte chunk');
	const sequence = ownValue(row, 'sequence', 'staging byte chunk');
	const maximumByteLength = ownValue(row, 'maximumByteLength', 'staging byte chunk');
	const byteLength = ownValue(row, 'byteLength', 'staging byte chunk');
	const final = ownValue(row, 'final', 'staging byte chunk');
	if (kind !== 'bytes' || !(bytes instanceof Uint8Array)
		|| !Number.isSafeInteger(sequence) || Number(sequence) < 0
		|| !Number.isSafeInteger(maximumByteLength) || Number(maximumByteLength) < 1
		|| Number(maximumByteLength) > maximumChunkBytes
		|| byteLength !== bytes.byteLength || typeof final !== 'boolean') {
		throw new TypeError('A bounded byte chunk is required.');
	}
	// `Buffer.slice()` aliases its input, and a typed-array subclass may replace
	// `slice`; construction by the intrinsic Uint8Array owns an exact copy.
	return createBoundedByteChunk(new Uint8Array(bytes), {
		sequence: Number(sequence), maximumByteLength: Number(maximumByteLength), final,
	});
}

function exactRecord(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`A ${label} is required.`);
	const row = value as Record<string, unknown>;
	const prototype = Object.getPrototypeOf(row) as unknown;
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`The ${label} must be plain data.`);
	const keys = Reflect.ownKeys(row);
	if (keys.length !== fields.length || keys.some(
		(key) => typeof key !== 'string' || !fields.includes(key),
	)) throw new TypeError(`The ${label} has missing or unsupported fields.`);
	return row;
}

function ownValue(row: Record<string, unknown>, field: string, label: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(row, field);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`The Soundscaper ${label}.${field} must be an own data property.`);
	}
	return descriptor.value;
}

function assertWriter(value: unknown): MediaByteWriterPort {
	if (!value || typeof value !== 'object') throw new TypeError('A delivery destination writer is required.');
	const writer = value as MediaByteWriterPort;
	if (!Number.isSafeInteger(writer.maximumChunkBytes) || writer.maximumChunkBytes < 1
		|| !Number.isSafeInteger(writer.bytesWritten) || writer.bytesWritten < 0
		|| typeof writer.write !== 'function' || typeof writer.commit !== 'function'
		|| typeof writer.abort !== 'function') throw new TypeError('The delivery destination writer is invalid.');
	return writer;
}

function deliveryFileName(value: unknown): string {
	if (typeof value !== 'string' || value.length === 0 || value !== value.trim()
		|| new TextEncoder().encode(value).byteLength > 1_024
		|| value === '.' || value === '..' || /[/\\]/u.test(value)) {
		throw new TypeError('The Soundscaper delivery destination file name is invalid.');
	}
	return value;
}

function assertSignal(value: unknown): asserts value is AbortSignal {
	if (!value || typeof value !== 'object' || typeof (value as AbortSignal).throwIfAborted !== 'function') {
		throw new TypeError('A Soundscaper delivery operation requires an AbortSignal.');
	}
}

function closedWriter(): never {
	throw new Error('The Soundscaper delivery staging writer is closed.');
}

function contractError(message: string): SoundscaperDeliveryContractError {
	return new SoundscaperDeliveryContractError('malformed', message);
}
