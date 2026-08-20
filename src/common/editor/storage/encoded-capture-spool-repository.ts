/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	mediaAssetChunkKey,
	mediaAssetChunkRecord,
	type MediaAssetChunkRead,
	type MediaAssetChunkRecord,
} from './media-asset-chunk-records.ts';
import { restoreEncodedCaptureAcknowledgedPrefix } from './framescaper-capture-spool-prefix-repair.ts';
import {
	normalizeEncodedCaptureSpoolCreateRequest,
	putEncodedCaptureSpoolWhenCurrent,
	type CreateEncodedCaptureSpoolRequest,
} from './encoded-capture-spool-create.ts';
import { prepareEncodedCaptureSpoolTail, recoverEncodedCaptureSpoolTail } from './encoded-capture-spool-tail-cleanup.ts';
import {
	appendEncodedCaptureSpool,
	assertNoPendingEncodedCaptureAppend,
	ENCODED_CAPTURE_APPEND_MAXIMUM_CHUNK_BYTES,
	ENCODED_CAPTURE_APPEND_MAXIMUM_PACKET_BYTES,
	reconcileEncodedCaptureAppend,
	recoverEncodedCaptureAppendBeforeLoad,
	recoverEncodedCaptureAppendWhileLocked,
	type EncodedCaptureAcknowledgedPrefix,
} from './encoded-capture-spool-append.ts';
import { withCaptureSpoolOperationLock } from './capture-spool-operation-lock.ts';

export type { CreateEncodedCaptureSpoolRequest } from './encoded-capture-spool-create.ts';
const KEY_PREFIX = 'framescaper-encoded-capture-spool-v1:';
const MAXIMUM_PACKET_CHUNKS = 16;
const MAXIMUM_PACKETS = 1_000_000;

export const ENCODED_CAPTURE_MAXIMUM_CHUNK_BYTES = ENCODED_CAPTURE_APPEND_MAXIMUM_CHUNK_BYTES;
export const ENCODED_CAPTURE_MAXIMUM_PACKET_BYTES = ENCODED_CAPTURE_APPEND_MAXIMUM_PACKET_BYTES;

export type EncodedCaptureSpoolState = 'capturing' | 'sealed' | 'adopted' | 'deleting';

export interface EncodedCaptureSpoolRecord {
	readonly version: 1;
	readonly projectId: string;
	readonly sessionId: string;
	readonly streamId: string;
	readonly spoolId: string;
	readonly spoolToken: string;
	readonly sourceId: string;
	readonly mimeType: string;
	readonly state: EncodedCaptureSpoolState;
	readonly packetCount: number;
	readonly chunkCount: number;
	readonly byteLength: number;
	readonly firstPtsMicroseconds: number | null;
	readonly lastPtsEndMicroseconds: number | null;
	readonly adoptedMediaId: string | null;
	readonly createdAt: number;
	readonly updatedAt: number;
}

export interface EncodedCapturePacket {
	readonly sequence: number;
	readonly ptsMicroseconds: number;
	readonly durationMicroseconds: number;
	readonly payload: Blob;
}

export interface EncodedCaptureAppendAcknowledgement {
	readonly spool: EncodedCaptureSpoolRecord;
	readonly sequence: number;
	readonly firstChunkIndex: number;
	readonly chunkCount: number;
	readonly byteLength: number;
}

export interface EncodedCaptureSpoolChunk {
	readonly index: number;
	readonly packetSequence: number;
	readonly packetChunkIndex: number;
	readonly packetChunkCount: number;
	readonly ptsMicroseconds: number;
	readonly durationMicroseconds: number;
	readonly payload: Blob;
	readonly sha256: string;
}

export interface EncodedCaptureAssetIdentity {
	readonly sourceId: string;
	readonly mediaChunkToken: string;
	readonly mimeType: string;
	readonly byteLength: number;
	readonly chunkCount: number;
}

export interface EncodedCaptureAdoption {
	readonly spool: EncodedCaptureSpoolRecord;
	readonly assetIdentity: EncodedCaptureAssetIdentity;
}

export interface EncodedCaptureSpoolKeyValuePort {
	get(key: string): PromiseLike<unknown> | unknown;
	putIfAbsent(key: string, value: unknown): PromiseLike<boolean> | boolean;
	putIfAbsentWhenCurrent?(
		fenceKey: string, expectedFence: unknown, key: string, value: unknown,
	): PromiseLike<boolean> | boolean;
	replaceIfCurrentWhenCurrent?(
		fenceKey: string, expectedFence: unknown,
		key: string, expected: unknown, replacement: unknown,
	): PromiseLike<boolean> | boolean;
	replaceIfCurrentAndPutIfAbsent?(
		key: string, expected: unknown, replacement: unknown, intentKey: string, intent: unknown,
	): PromiseLike<boolean> | boolean;
	replaceIfCurrent(
		key: string,
		expected: unknown,
		replacement: unknown,
	): PromiseLike<boolean> | boolean;
	deleteIfCurrent(key: string, expected: unknown): PromiseLike<boolean> | boolean;
	listByPrefix(prefix: string): PromiseLike<readonly Readonly<{ readonly value: unknown }>[]> |
		readonly Readonly<{ readonly value: unknown }>[];
}

export interface EncodedCaptureSpoolChunkPort {
	write(record: MediaAssetChunkRecord): PromiseLike<void> | void;
	chunks(token: string): AsyncIterable<MediaAssetChunkRead>;
	deleteOwned(token: string, sourceId: string): PromiseLike<boolean> | boolean;
	deleteTailOwned(token: string, sourceId: string, firstIndex: number): PromiseLike<boolean> | boolean;
}

interface EncodedCaptureSpoolOptions {
	readonly now?: () => number;
	readonly createId?: () => string;
	readonly digest?: (payload: Blob) => Promise<string>;
}
/** CAS-fenced prefixes; failed-acknowledgement tails remain unreadable and exactly owned. */
export class EncodedCaptureSpoolRepository {
	readonly #values: EncodedCaptureSpoolKeyValuePort;
	readonly #chunks: EncodedCaptureSpoolChunkPort;
	readonly #now: () => number;
	readonly #createId: () => string;
	readonly #digest: (payload: Blob) => Promise<string>;

	constructor(
		values: EncodedCaptureSpoolKeyValuePort,
		chunks: EncodedCaptureSpoolChunkPort,
		options: EncodedCaptureSpoolOptions = {},
	) {
		this.#values = values;
		this.#chunks = chunks;
		this.#now = options.now ?? Date.now;
		this.#createId = options.createId ?? createId;
		this.#digest = options.digest ?? digestBlob;
	}

	async create(requestValue: CreateEncodedCaptureSpoolRequest): Promise<EncodedCaptureSpoolRecord> {
		const request = normalizeEncodedCaptureSpoolCreateRequest(requestValue);
		const now = timestamp(this.#now(), 'encoded capture creation time');
		const record = freezeRecord({
			version: 1,
			projectId: request.projectId,
			sessionId: request.sessionId,
			streamId: request.streamId,
			spoolId: request.spoolId,
			spoolToken: stableText(
				request.spoolToken ?? `framescaper-capture:${this.#createId()}`,
				'encoded capture spool token',
				512,
			),
			sourceId: request.sourceId,
			mimeType: request.mimeType,
			state: 'capturing',
			packetCount: 0,
			chunkCount: 0,
			byteLength: 0,
			firstPtsMicroseconds: null,
			lastPtsEndMicroseconds: null,
			adoptedMediaId: null,
			createdAt: now,
			updatedAt: now,
		});
		const key = spoolKey(record.projectId, record.spoolId);
		const inserted = request.creationFence
			? await putEncodedCaptureSpoolWhenCurrent(this.#values, request.creationFence, key, record)
			: await this.#values.putIfAbsent(key, record);
		if (!inserted) {
			throw new Error(`Encoded capture spool ${record.spoolId} already exists.`);
		}
		return record;
	}

	async load(projectIdValue: string, spoolIdValue: string): Promise<EncodedCaptureSpoolRecord | null> {
		const projectId = stableId(projectIdValue, 'encoded capture projectId');
		const spoolId = stableId(spoolIdValue, 'encoded capture spoolId');
		const value = await this.#values.get(spoolKey(projectId, spoolId));
		if (value === undefined || value === null) return null;
		let record: EncodedCaptureSpoolRecord | null = normalizeRecord(value);
		if (record.projectId !== projectId || record.spoolId !== spoolId) {
			throw new Error('Encoded capture spool key ownership changed.');
		}
		record = await recoverEncodedCaptureAppendBeforeLoad(
			this.#values, this.#chunks, record, spoolKey(projectId, spoolId), normalizeRecord,
			(current) => recoverEncodedCaptureSpoolTail(this.#values, this.#chunks, current),
		);
		if (!record) return null;
		return record;
	}

	async listAll(): Promise<readonly EncodedCaptureSpoolRecord[]> {
		const records: EncodedCaptureSpoolRecord[] = [];
		for (const { value } of await this.#values.listByPrefix(KEY_PREFIX)) {
			const observed = normalizeRecord(value);
			const record = await recoverEncodedCaptureAppendBeforeLoad(
				this.#values, this.#chunks, observed,
				spoolKey(observed.projectId, observed.spoolId), normalizeRecord,
				(current) => recoverEncodedCaptureSpoolTail(this.#values, this.#chunks, current),
			);
			if (!record) continue;
			records.push(record);
		}
		return Object.freeze(records.sort((left, right) => (
			left.projectId.localeCompare(right.projectId) || left.spoolId.localeCompare(right.spoolId)
		)));
	}

	async retainedMediaChunkTokens(): Promise<ReadonlySet<string>> {
		return new Set((await this.listAll()).map(({ spoolToken }) => spoolToken));
	}

	async append(
		expectedValue: EncodedCaptureSpoolRecord,
		packetValue: EncodedCapturePacket,
	): Promise<EncodedCaptureAppendAcknowledgement> {
		const expected = normalizeRecord(expectedValue);
		if (expected.state !== 'capturing') throw new Error('Only a capturing encoded spool can append packets.');
		return appendEncodedCaptureSpool(
			this.#values, this.#chunks, expected, packetValue,
			spoolKey(expected.projectId, expected.spoolId), normalizeRecord, this.#now, this.#digest,
		);
	}

	async reconcileAppend(
		currentValue: EncodedCaptureSpoolRecord,
		prefix: EncodedCaptureAcknowledgedPrefix,
	): Promise<EncodedCaptureSpoolRecord> {
		const current = normalizeRecord(currentValue);
		return reconcileEncodedCaptureAppend(
			this.#values, current, prefix, spoolKey(current.projectId, current.spoolId), normalizeRecord,
			(advanced, previous) => this.restoreAcknowledgedPrefix(advanced, previous),
		);
	}

	/** Restore the exact manifest-acknowledged prefix after its following manifest CAS is refused. */
	async restoreAcknowledgedPrefix(
		currentValue: EncodedCaptureSpoolRecord,
		acknowledgedValue: EncodedCaptureSpoolRecord,
	): Promise<EncodedCaptureSpoolRecord> {
		const current = normalizeRecord(currentValue);
		const acknowledged = normalizeRecord(acknowledgedValue);
		assertSameOwnership(current, acknowledged);
		const key = spoolKey(current.projectId, current.spoolId);
		return withCaptureSpoolOperationLock(operationIdentity(current), async () => {
			const restored = await restoreEncodedCaptureAcknowledgedPrefix(current, acknowledged, {
				replace: () => prepareEncodedCaptureSpoolTail(this.#values, key, current, acknowledged),
				load: async () => {
					const value = await this.#values.get(key);
					return value == null ? null : normalizeRecord(value);
				},
				deleteTail: () => recoverEncodedCaptureSpoolTail(
					this.#values, this.#chunks, acknowledged,
				).then(() => true),
			});
			const reconciled = await recoverEncodedCaptureAppendWhileLocked(
				this.#values, this.#chunks, restored, key, normalizeRecord,
			);
			if (!reconciled || !sameRecord(reconciled, restored)) {
				throw new Error('Encoded capture append intent changed after acknowledged-prefix repair.');
			}
			return reconciled;
		});
	}

	async seal(expectedValue: EncodedCaptureSpoolRecord): Promise<EncodedCaptureSpoolRecord> {
		const expected = normalizeRecord(expectedValue);
		if (expected.state === 'sealed') {
			await this.#assertCurrent(expected);
			return expected;
		}
		if (expected.state !== 'capturing') throw new Error('Only a capturing encoded spool can be sealed.');
		if (expected.packetCount < 1) throw new Error('An encoded capture spool requires one acknowledged packet before sealing.');
		const sealed = freezeRecord({
			...expected,
			state: 'sealed',
			updatedAt: timestamp(this.#now(), 'encoded capture seal time'),
		});
		if (!await this.#replace(expected, sealed)) throw new Error('Encoded capture spool ownership changed before sealing.');
		return sealed;
	}

	async adopt(
		expectedValue: EncodedCaptureSpoolRecord,
		mediaIdValue: string,
	): Promise<EncodedCaptureAdoption> {
		const expected = normalizeRecord(expectedValue);
		const mediaId = stableId(mediaIdValue, 'encoded capture adoption mediaId');
		if (expected.state !== 'sealed') throw new Error('Only a sealed encoded capture spool can be adopted.');
		if (expected.sourceId !== mediaId) throw new Error('Encoded capture adoption cannot change chunk ownership.');
		const adopted = freezeRecord({
			...expected,
			state: 'adopted',
			adoptedMediaId: mediaId,
			updatedAt: timestamp(this.#now(), 'encoded capture adoption time'),
		});
		if (!await this.#replace(expected, adopted)) throw new Error('Encoded capture spool ownership changed before adoption.');
		return Object.freeze({
			spool: adopted,
			assetIdentity: Object.freeze({
				sourceId: adopted.sourceId,
				mediaChunkToken: adopted.spoolToken,
				mimeType: adopted.mimeType,
				byteLength: adopted.byteLength,
				chunkCount: adopted.chunkCount,
			}),
		});
	}

	async *read(recordValue: EncodedCaptureSpoolRecord): AsyncGenerator<EncodedCaptureSpoolChunk> {
		const record = normalizeRecord(recordValue);
		if (record.state === 'deleting') throw new Error('A deleting encoded capture prefix is not readable.');
		await this.#assertCurrent(record);
		let index = 0;
		let packetSequence = 0;
		let packetChunkIndex = 0;
		let byteLength = 0;
		let firstPtsMicroseconds: number | null = null;
		let lastPtsEndMicroseconds: number | null = null;
		for await (const stored of this.#chunks.chunks(record.spoolToken)) {
			if (index >= record.chunkCount) break;
			const chunk = await normalizeStoredChunk(stored.value, record, index, this.#digest);
			if (chunk.packetSequence !== packetSequence || chunk.packetChunkIndex !== packetChunkIndex) {
				throw new Error('Encoded capture packet chunk order is invalid.');
			}
			firstPtsMicroseconds ??= chunk.ptsMicroseconds;
			lastPtsEndMicroseconds = exactSum(
				chunk.ptsMicroseconds, chunk.durationMicroseconds, 'encoded capture packet end',
			);
			byteLength = exactSum(byteLength, chunk.payload.size, 'encoded capture read byteLength');
			packetChunkIndex += 1;
			if (packetChunkIndex === chunk.packetChunkCount) {
				packetSequence += 1;
				packetChunkIndex = 0;
			}
			yield chunk;
			index += 1;
		}
		if (index !== record.chunkCount || packetSequence !== record.packetCount || packetChunkIndex !== 0
			|| byteLength !== record.byteLength || firstPtsMicroseconds !== record.firstPtsMicroseconds
			|| lastPtsEndMicroseconds !== record.lastPtsEndMicroseconds) {
			throw new Error('The acknowledged encoded capture prefix is incomplete or inconsistent.');
		}
		await this.#assertCurrent(record);
	}

	async delete(expectedValue: EncodedCaptureSpoolRecord): Promise<void> {
		let expected = normalizeRecord(expectedValue);
		if (expected.state === 'adopted') {
			throw new Error('Adopted encoded capture bytes must be released through the immutable media lifecycle.');
		}
		if (expected.state !== 'deleting') {
			const deleting = freezeRecord({
				...expected,
				state: 'deleting',
				updatedAt: timestamp(this.#now(), 'encoded capture deletion time'),
			});
			if (!await this.#replace(expected, deleting)) throw new Error('Encoded capture spool ownership changed before deletion.');
			expected = deleting;
		}
		if (!await this.#chunks.deleteOwned(expected.spoolToken, expected.sourceId)) {
			throw new Error('Encoded capture chunk ownership does not match its manifest.');
		}
		if (!await this.#values.deleteIfCurrent(spoolKey(expected.projectId, expected.spoolId), expected)) {
			throw new Error('Encoded capture spool ownership changed after byte deletion.');
		}
	}

	async releaseAdopted(expectedValue: EncodedCaptureSpoolRecord): Promise<void> {
		const expected = normalizeRecord(expectedValue);
		if (expected.state !== 'adopted' || expected.adoptedMediaId !== expected.sourceId) {
			throw new Error('Only an adopted encoded capture spool can release its manifest ownership.');
		}
		if (!await this.#values.deleteIfCurrent(spoolKey(expected.projectId, expected.spoolId), expected)) {
			throw new Error('Encoded capture spool ownership changed before adopted release.');
		}
	}

	async #assertCurrent(expected: EncodedCaptureSpoolRecord): Promise<void> {
		const current = await this.load(expected.projectId, expected.spoolId);
		if (!current || !sameRecord(current, expected)) throw new Error('Encoded capture spool ownership changed.');
	}

	async #replace(
		expected: EncodedCaptureSpoolRecord,
		next: EncodedCaptureSpoolRecord,
	): Promise<boolean> {
		return withCaptureSpoolOperationLock(operationIdentity(expected), async () => {
			const key = spoolKey(expected.projectId, expected.spoolId);
			const observed = await this.#values.get(key);
			if (observed == null || !sameRecord(normalizeRecord(observed), expected)) return false;
			await recoverEncodedCaptureSpoolTail(this.#values, this.#chunks, expected);
			await assertNoPendingEncodedCaptureAppend(this.#values, expected, normalizeRecord);
			assertSameOwnership(expected, next);
			return this.#values.replaceIfCurrent(key, expected, next);
		});
	}
}

function operationIdentity(record: EncodedCaptureSpoolRecord) {
	return Object.freeze({
		storageKind: 'encoded-media' as const, projectId: record.projectId,
		spoolId: record.spoolId, spoolToken: record.spoolToken,
	});
}

function normalizeRecord(value: unknown): EncodedCaptureSpoolRecord {
	const record = dataRecord(value, 'encoded capture spool record');
	const state = spoolState(record.state);
	const packetCount = boundedNonNegativeInteger(record.packetCount, MAXIMUM_PACKETS, 'encoded capture packetCount');
	const chunkCount = boundedNonNegativeInteger(
		record.chunkCount,
		MAXIMUM_PACKETS * MAXIMUM_PACKET_CHUNKS,
		'encoded capture chunkCount',
	);
	const byteLength = nonNegativeInteger(record.byteLength, 'encoded capture byteLength');
	const firstPtsMicroseconds = nullableNonNegativeInteger(record.firstPtsMicroseconds, 'encoded capture first PTS');
	const lastPtsEndMicroseconds = nullableNonNegativeInteger(record.lastPtsEndMicroseconds, 'encoded capture last packet end');
	if ((packetCount === 0) !== (chunkCount === 0) || (packetCount === 0) !== (byteLength === 0)
		|| (packetCount === 0) !== (firstPtsMicroseconds === null)
		|| (packetCount === 0) !== (lastPtsEndMicroseconds === null)
		|| (firstPtsMicroseconds !== null && lastPtsEndMicroseconds! <= firstPtsMicroseconds)) {
		throw new Error('Encoded capture acknowledged-prefix geometry is invalid.');
	}
	const sourceId = stableId(record.sourceId, 'encoded capture sourceId');
	const adoptedMediaId = record.adoptedMediaId === null
		? null
		: stableId(record.adoptedMediaId, 'encoded capture adopted mediaId');
	if ((state === 'adopted') !== (adoptedMediaId !== null)
		|| (adoptedMediaId !== null && adoptedMediaId !== sourceId)) {
		throw new Error('Encoded capture adoption ownership is invalid.');
	}
	const createdAt = timestamp(record.createdAt, 'encoded capture creation time');
	const updatedAt = timestamp(record.updatedAt, 'encoded capture update time');
	if (updatedAt < createdAt) throw new Error('Encoded capture timestamps move backward.');
	return freezeRecord({
		version: literalOne(record.version, 'encoded capture spool version'),
		projectId: stableId(record.projectId, 'encoded capture projectId'),
		sessionId: stableId(record.sessionId, 'encoded capture sessionId'),
		streamId: stableId(record.streamId, 'encoded capture streamId'),
		spoolId: stableId(record.spoolId, 'encoded capture spoolId'),
		spoolToken: stableText(record.spoolToken, 'encoded capture spool token', 512),
		sourceId,
		mimeType: mimeType(record.mimeType),
		state,
		packetCount,
		chunkCount,
		byteLength,
		firstPtsMicroseconds,
		lastPtsEndMicroseconds,
		adoptedMediaId,
		createdAt,
		updatedAt,
	});
}

async function normalizeStoredChunk(
	value: unknown,
	record: EncodedCaptureSpoolRecord,
	index: number,
	digest: (payload: Blob) => Promise<string>,
): Promise<EncodedCaptureSpoolChunk> {
	const base = mediaAssetChunkRecord(value);
	const stored = dataRecord(value, `encoded capture chunk ${String(index)}`);
	if (!base || base.key !== mediaAssetChunkKey(record.spoolToken, index)
		|| base.mediaChunkToken !== record.spoolToken || base.sourceId !== record.sourceId
		|| base.index !== index || base.byteLength < 1
		|| base.byteLength > ENCODED_CAPTURE_MAXIMUM_CHUNK_BYTES
		|| stored.captureSpoolVersion !== 1 || stored.captureSpoolId !== record.spoolId) {
		throw new Error(`Encoded capture chunk ${String(index)} ownership is invalid.`);
	}
	const packetSequence = boundedNonNegativeInteger(stored.packetSequence, record.packetCount - 1, 'encoded capture packet sequence');
	const packetChunkCount = boundedPositiveInteger(stored.packetChunkCount, MAXIMUM_PACKET_CHUNKS, 'encoded capture packet chunkCount');
	const packetChunkIndex = boundedNonNegativeInteger(stored.packetChunkIndex, packetChunkCount - 1, 'encoded capture packet chunk index');
	const sha256 = digestText(stored.payloadSha256);
	if (await digest(base.payload) !== sha256) throw new Error(`Encoded capture chunk ${String(index)} digest changed.`);
	return Object.freeze({
		index,
		packetSequence,
		packetChunkIndex,
		packetChunkCount,
		ptsMicroseconds: nonNegativeInteger(stored.packetPtsMicroseconds, 'encoded capture packet PTS'),
		durationMicroseconds: positiveInteger(stored.packetDurationMicroseconds, 'encoded capture packet duration'),
		payload: base.payload.slice(),
		sha256,
	});
}

function assertSameOwnership(left: EncodedCaptureSpoolRecord, right: EncodedCaptureSpoolRecord): void {
	for (const key of [
		'version', 'projectId', 'sessionId', 'streamId', 'spoolId', 'spoolToken', 'sourceId', 'mimeType', 'createdAt',
	] as const) {
		if (left[key] !== right[key]) throw new Error(`Encoded capture transition changed ${key}.`);
	}
}

function freezeRecord(value: EncodedCaptureSpoolRecord): EncodedCaptureSpoolRecord { return Object.freeze({ ...value }); }
function sameRecord(left: EncodedCaptureSpoolRecord, right: EncodedCaptureSpoolRecord): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function dataRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a data record.`);
	return value as Readonly<Record<string, unknown>>;
}
function spoolState(value: unknown): EncodedCaptureSpoolState {
	if (value !== 'capturing' && value !== 'sealed' && value !== 'adopted' && value !== 'deleting') {
		throw new TypeError('Encoded capture spool state is invalid.');
	}
	return value;
}
function literalOne(value: unknown, name: string): 1 { if (value !== 1) throw new Error(`${name} is invalid.`); return 1; }
function stableId(value: unknown, name: string): string { return stableText(value, name, 256); }
function stableText(value: unknown, name: string, maximumLength: number): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()
		|| value !== value.normalize('NFC') || value.length > maximumLength
		|| /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}
function mimeType(value: unknown): string { return stableText(value, 'encoded capture MIME type', 255); }

function digestText(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
		throw new TypeError('Encoded capture chunk SHA-256 is invalid.');
	}
	return value;
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

function nullableNonNegativeInteger(value: unknown, name: string): number | null {
	return value === null ? null : nonNegativeInteger(value, name);
}

function boundedPositiveInteger(value: unknown, maximum: number, name: string): number {
	const result = positiveInteger(value, name);
	if (result > maximum) throw new RangeError(`${name} exceeds its strict bound.`);
	return result;
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

function spoolKey(projectId: string, spoolId: string): string {
	return `${KEY_PREFIX}${encodeURIComponent(projectId)}:${encodeURIComponent(spoolId)}`;
}

async function digestBlob(payload: Blob): Promise<string> {
	const bytes = await payload.arrayBuffer();
	const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function createId(): string {
	return globalThis.crypto?.randomUUID?.()
		?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
