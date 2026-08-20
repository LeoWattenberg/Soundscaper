/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	captureSpoolAppendIntentKey,
	loadCaptureSpoolAppendIntent,
	prepareCaptureSpoolAppendIntent,
	removeCaptureSpoolAppendIntent,
	type CaptureSpoolAppendIntent,
	type CaptureSpoolAppendIntentValues,
} from './capture-spool-append-intent-repository.ts';
import {
	mediaAssetChunkKey,
	type MediaAssetChunkRecord,
} from './media-asset-chunk-records.ts';
import type {
	EncodedCaptureAppendAcknowledgement,
	EncodedCapturePacket,
	EncodedCaptureSpoolChunkPort,
	EncodedCaptureSpoolRecord,
} from './encoded-capture-spool-repository.ts';
import { withCaptureSpoolOperationLock } from './capture-spool-operation-lock.ts';

const MAXIMUM_PACKET_CHUNKS = 16;
const MAXIMUM_PACKETS = 1_000_000;
export const ENCODED_CAPTURE_APPEND_MAXIMUM_CHUNK_BYTES = 4 * 1024 * 1024;
export const ENCODED_CAPTURE_APPEND_MAXIMUM_PACKET_BYTES =
	ENCODED_CAPTURE_APPEND_MAXIMUM_CHUNK_BYTES * MAXIMUM_PACKET_CHUNKS;

interface StoredCaptureChunk extends MediaAssetChunkRecord {
	readonly captureSpoolVersion: 1;
	readonly captureSpoolId: string;
	readonly packetSequence: number;
	readonly packetChunkIndex: number;
	readonly packetChunkCount: number;
	readonly packetPtsMicroseconds: number;
	readonly packetDurationMicroseconds: number;
	readonly payloadSha256: string;
}

type EncodedAppendValues = CaptureSpoolAppendIntentValues;

export interface EncodedCaptureAcknowledgedPrefix {
	readonly packetCount: number;
	readonly chunkCount: number;
	readonly byteLength: number;
	readonly firstPtsMicroseconds: number | null;
	readonly lastPtsEndMicroseconds: number | null;
}

export async function appendEncodedCaptureSpool(
	values: EncodedAppendValues,
	chunks: Pick<EncodedCaptureSpoolChunkPort, 'write' | 'deleteTailOwned'>,
	expected: EncodedCaptureSpoolRecord,
	packetValue: EncodedCapturePacket,
	metadataKey: string,
	normalizeRecord: (value: unknown) => EncodedCaptureSpoolRecord,
	now: () => number,
	digest: (payload: Blob) => Promise<string>,
): Promise<EncodedCaptureAppendAcknowledgement> {
	return withCaptureSpoolOperationLock(identity(expected), () => appendEncodedCaptureSpoolLocked(
		values, chunks, expected, packetValue, metadataKey, normalizeRecord, now, digest,
	));
}

async function appendEncodedCaptureSpoolLocked(
	values: EncodedAppendValues,
	chunks: Pick<EncodedCaptureSpoolChunkPort, 'write' | 'deleteTailOwned'>,
	expected: EncodedCaptureSpoolRecord,
	packetValue: EncodedCapturePacket,
	metadataKey: string,
	normalizeRecord: (value: unknown) => EncodedCaptureSpoolRecord,
	now: () => number,
	digest: (payload: Blob) => Promise<string>,
): Promise<EncodedCaptureAppendAcknowledgement> {
	const packet = normalizePacket(packetValue, expected);
	const firstChunkIndex = expected.chunkCount;
	const packetChunkCount = Math.ceil(packet.payload.size / ENCODED_CAPTURE_APPEND_MAXIMUM_CHUNK_BYTES);
	const next = Object.freeze({
		...expected,
		packetCount: exactSum(expected.packetCount, 1, 'encoded capture packetCount'),
		chunkCount: exactSum(expected.chunkCount, packetChunkCount, 'encoded capture chunkCount'),
		byteLength: exactSum(expected.byteLength, packet.payload.size, 'encoded capture byteLength'),
		firstPtsMicroseconds: expected.firstPtsMicroseconds ?? packet.ptsMicroseconds,
		lastPtsEndMicroseconds: exactSum(
			packet.ptsMicroseconds, packet.durationMicroseconds, 'encoded capture packet end',
		),
		updatedAt: timestamp(now(), 'encoded capture update time'),
	});
	await assertNoPendingEncodedCaptureAppend(values, expected, normalizeRecord);
	if (typeof values.replaceIfCurrentWhenCurrent !== 'function') {
		throw new Error('Encoded capture append commit requires an atomic exact intent fence.');
	}
	const intent = await prepareCaptureSpoolAppendIntent(
		values, identity(expected), firstChunkIndex, metadataKey, expected, expected, next, normalizeRecord,
	);
	for (let packetChunkIndex = 0; packetChunkIndex < packetChunkCount; packetChunkIndex += 1) {
		const start = packetChunkIndex * ENCODED_CAPTURE_APPEND_MAXIMUM_CHUNK_BYTES;
		const payload = packet.payload.slice(start, start + ENCODED_CAPTURE_APPEND_MAXIMUM_CHUNK_BYTES);
		const index = exactSum(firstChunkIndex, packetChunkIndex, 'encoded capture chunk index');
		const chunk: StoredCaptureChunk = {
			key: mediaAssetChunkKey(expected.spoolToken, index),
			sourceId: expected.sourceId,
			mediaChunkToken: expected.spoolToken,
			index,
			payload,
			byteLength: payload.size,
			createdAt: timestamp(now(), 'encoded capture chunk creation time'),
			captureSpoolVersion: 1,
			captureSpoolId: expected.spoolId,
			packetSequence: packet.sequence,
			packetChunkIndex,
			packetChunkCount,
			packetPtsMicroseconds: packet.ptsMicroseconds,
			packetDurationMicroseconds: packet.durationMicroseconds,
			payloadSha256: await digest(payload),
		};
		await chunks.write(chunk);
	}
	await replaceAppendMetadata(values, intent, metadataKey, expected, next, normalizeRecord);
	return Object.freeze({
		spool: next,
		sequence: packet.sequence,
		firstChunkIndex,
		chunkCount: packetChunkCount,
		byteLength: packet.payload.size,
	});
}

/** Clean a stopped pre-write append, but retain a metadata-committed intent for manifest reconciliation. */
export async function recoverEncodedCaptureAppendBeforeLoad(
	values: CaptureSpoolAppendIntentValues,
	chunks: Pick<EncodedCaptureSpoolChunkPort, 'deleteTailOwned'>,
	observed: EncodedCaptureSpoolRecord,
	metadataKey: string,
	normalizeRecord: (value: unknown) => EncodedCaptureSpoolRecord,
	recoverTail: (current: EncodedCaptureSpoolRecord) => Promise<void>,
): Promise<EncodedCaptureSpoolRecord | null> {
	return withCaptureSpoolOperationLock(identity(observed), async () => {
		const current = await recoverEncodedCaptureAppendWhileLocked(
			values, chunks, observed, metadataKey, normalizeRecord,
		);
		if (current) await recoverTail(current);
		return current;
	});
}

export async function recoverEncodedCaptureAppendWhileLocked(
	values: CaptureSpoolAppendIntentValues,
	chunks: Pick<EncodedCaptureSpoolChunkPort, 'deleteTailOwned'>,
	observed: EncodedCaptureSpoolRecord,
	metadataKey: string,
	normalizeRecord: (value: unknown) => EncodedCaptureSpoolRecord,
): Promise<EncodedCaptureSpoolRecord | null> {
	const value = await values.get(metadataKey);
	if (value === undefined || value === null) return null;
	const current = normalizeRecord(value);
	assertSameOwnership(observed, current);
	const intent = await validatedIntent(values, current, normalizeRecord);
	if (!intent || sameRecord(current, intent.next)) return current;
	if (!sameRecord(current, intent.previous)) {
		throw new Error('Encoded capture append intent disagrees with durable spool metadata.');
	}
	if (!await chunks.deleteTailOwned(current.spoolToken, current.sourceId, intent.firstIndex)) {
		throw new Error('Encoded capture partial append cleanup ownership changed.');
	}
	await removeCaptureSpoolAppendIntent(values, intent);
	return current;
}

export async function reconcileEncodedCaptureAppend(
	values: CaptureSpoolAppendIntentValues,
	observed: EncodedCaptureSpoolRecord,
	prefix: EncodedCaptureAcknowledgedPrefix,
	metadataKey: string,
	normalizeRecord: (value: unknown) => EncodedCaptureSpoolRecord,
	rollback: (
		current: EncodedCaptureSpoolRecord, previous: EncodedCaptureSpoolRecord,
	) => Promise<EncodedCaptureSpoolRecord>,
): Promise<EncodedCaptureSpoolRecord> {
	const decision = await withCaptureSpoolOperationLock(identity(observed), async () => {
		const value = await values.get(metadataKey);
		if (value == null) throw new Error('Encoded capture spool disappeared during append reconciliation.');
		const current = normalizeRecord(value);
		assertSameOwnership(observed, current);
		const intent = await validatedIntent(values, current, normalizeRecord);
		if (!intent) {
			if (!prefixMatches(current, prefix)) {
				throw new Error('Encoded capture spool does not match its durable manifest prefix.');
			}
			return Object.freeze({ current, previous: null });
		}
		if (!sameRecord(current, intent.next)) {
			throw new Error('Encoded capture append intent was not cleaned before manifest reconciliation.');
		}
		if (prefixMatches(intent.next, prefix)) {
			await removeCaptureSpoolAppendIntent(values, intent);
			return Object.freeze({ current, previous: null });
		}
		if (prefixMatches(intent.previous, prefix)) {
			return Object.freeze({ current, previous: intent.previous });
		}
		throw new Error('Encoded capture manifest is outside the exact append-intent transition.');
	});
	if (!decision.previous) return decision.current;
	const restored = await rollback(decision.current, decision.previous);
	if (!sameRecord(restored, decision.previous)) throw new Error('Encoded capture append rollback changed evidence.');
	return restored;
}

export async function assertNoPendingEncodedCaptureAppend(
	values: CaptureSpoolAppendIntentValues,
	current: EncodedCaptureSpoolRecord,
	normalizeRecord: (value: unknown) => EncodedCaptureSpoolRecord,
): Promise<void> {
	const intent = await validatedIntent(values, current, normalizeRecord);
	if (!intent) return;
	throw new Error('An encoded capture append remains pending durable manifest reconciliation.');
}

async function replaceAppendMetadata(
	values: EncodedAppendValues,
	intent: CaptureSpoolAppendIntent<EncodedCaptureSpoolRecord>,
	key: string,
	expected: EncodedCaptureSpoolRecord,
	next: EncodedCaptureSpoolRecord,
	normalizeRecord: (value: unknown) => EncodedCaptureSpoolRecord,
): Promise<void> {
	const replace = values.replaceIfCurrentWhenCurrent!;
	try {
		if (await replace.call(
			values, captureSpoolAppendIntentKey(intent), intent, key, expected, next,
		)) return;
	} catch (error) {
		if (await metadataCommitObserved(values, intent, key, next, normalizeRecord)) return;
		throw error;
	}
	if (await metadataCommitObserved(values, intent, key, next, normalizeRecord)) return;
	throw new Error('Encoded capture ownership changed after its packet became an inventoried removable tail.');
}

async function metadataCommitObserved(
	values: EncodedAppendValues,
	intent: CaptureSpoolAppendIntent<EncodedCaptureSpoolRecord>,
	key: string,
	next: EncodedCaptureSpoolRecord,
	normalizeRecord: (value: unknown) => EncodedCaptureSpoolRecord,
): Promise<boolean> {
	if (!sameObservedRecord(await values.get(key), next, normalizeRecord)) return false;
	const observed = await loadCaptureSpoolAppendIntent(values, identity(next), normalizeRecord);
	return observed !== null && sameRecord(observed.previous, intent.previous)
		&& sameRecord(observed.next, intent.next) && observed.operationId === intent.operationId;
}

async function validatedIntent(
	values: Pick<CaptureSpoolAppendIntentValues, 'get'>,
	current: EncodedCaptureSpoolRecord,
	normalizeRecord: (value: unknown) => EncodedCaptureSpoolRecord,
): Promise<CaptureSpoolAppendIntent<EncodedCaptureSpoolRecord> | null> {
	const intent = await loadCaptureSpoolAppendIntent(values, identity(current), normalizeRecord);
	if (!intent) return null;
	assertSameOwnership(intent.previous, intent.next);
	assertSameOwnership(current, intent.previous);
	if (intent.firstIndex !== intent.previous.chunkCount
		|| intent.previous.state !== 'capturing' || intent.next.state !== 'capturing'
		|| intent.next.packetCount !== intent.previous.packetCount + 1
		|| intent.next.chunkCount <= intent.previous.chunkCount
		|| intent.next.chunkCount > intent.previous.chunkCount + MAXIMUM_PACKET_CHUNKS
		|| intent.next.byteLength <= intent.previous.byteLength
		|| intent.next.byteLength > intent.previous.byteLength + ENCODED_CAPTURE_APPEND_MAXIMUM_PACKET_BYTES
		|| intent.next.firstPtsMicroseconds === null || intent.next.lastPtsEndMicroseconds === null
		|| (intent.previous.packetCount > 0
			&& intent.next.firstPtsMicroseconds !== intent.previous.firstPtsMicroseconds)
		|| (intent.previous.lastPtsEndMicroseconds !== null
			&& intent.next.lastPtsEndMicroseconds <= intent.previous.lastPtsEndMicroseconds)) {
		throw new Error('Encoded capture append intent geometry is invalid.');
	}
	return intent;
}

function normalizePacket(value: EncodedCapturePacket, expected: EncodedCaptureSpoolRecord): EncodedCapturePacket {
	const sequence = boundedNonNegativeInteger(value?.sequence, MAXIMUM_PACKETS - 1, 'encoded capture packet sequence');
	if (sequence !== expected.packetCount) throw new Error('Encoded capture append requires the next contiguous packet sequence.');
	const ptsMicroseconds = nonNegativeInteger(value?.ptsMicroseconds, 'encoded capture packet PTS');
	const durationMicroseconds = positiveInteger(value?.durationMicroseconds, 'encoded capture packet duration');
	if (!(value?.payload instanceof Blob) || value.payload.size < 1
		|| value.payload.size > ENCODED_CAPTURE_APPEND_MAXIMUM_PACKET_BYTES) {
		throw new RangeError('Encoded capture packet payload exceeds its strict byte bound.');
	}
	if (expected.lastPtsEndMicroseconds !== null && ptsMicroseconds !== expected.lastPtsEndMicroseconds) {
		throw new Error('Encoded capture packet timestamps must be contiguous and monotonic.');
	}
	return Object.freeze({ sequence, ptsMicroseconds, durationMicroseconds, payload: value.payload.slice() });
}

function prefixMatches(record: EncodedCaptureSpoolRecord, prefix: EncodedCaptureAcknowledgedPrefix): boolean {
	return record.packetCount === prefix.packetCount && record.chunkCount === prefix.chunkCount
		&& record.byteLength === prefix.byteLength
		&& record.firstPtsMicroseconds === prefix.firstPtsMicroseconds
		&& record.lastPtsEndMicroseconds === prefix.lastPtsEndMicroseconds;
}
function identity(record: EncodedCaptureSpoolRecord) {
	return Object.freeze({
		storageKind: 'encoded-media' as const,
		projectId: record.projectId,
		spoolId: record.spoolId,
		spoolToken: record.spoolToken,
		sourceId: record.sourceId,
	});
}
function assertSameOwnership(left: EncodedCaptureSpoolRecord, right: EncodedCaptureSpoolRecord): void {
	for (const key of [
		'version', 'projectId', 'sessionId', 'streamId', 'spoolId', 'spoolToken', 'sourceId', 'mimeType', 'createdAt',
	] as const) if (left[key] !== right[key]) throw new Error(`Encoded capture append intent changed ${key}.`);
}
function sameObservedRecord(
	value: unknown,
	expected: EncodedCaptureSpoolRecord,
	normalizeRecord: (value: unknown) => EncodedCaptureSpoolRecord,
): boolean {
	if (value === undefined || value === null) return false;
	try { return sameRecord(normalizeRecord(value), expected); } catch { return false; }
}
function sameRecord(left: EncodedCaptureSpoolRecord, right: EncodedCaptureSpoolRecord): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}
function timestamp(value: unknown, name: string): number { return nonNegativeInteger(value, name); }
function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be positive.`);
	return Number(value);
}
function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}
function boundedNonNegativeInteger(value: unknown, maximum: number, name: string): number {
	const result = nonNegativeInteger(value, name);
	if (result > maximum) throw new RangeError(`${name} exceeds its strict bound.`);
	return result;
}
function exactSum(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} exceeds the safe integer range.`);
	return result;
}
