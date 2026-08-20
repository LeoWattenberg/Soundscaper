/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeFramescaperCaptureSessionManifest,
	type FramescaperCaptureSessionManifestV1,
	type FramescaperCaptureStreamManifestV1,
} from '../framescaper-capture-session-manifest.ts';
import {
	FramescaperCaptureCreationAdmissionRepository,
	framescaperCaptureCreationGlobalPrefix,
	framescaperCaptureCreationJournalKey,
	framescaperCaptureCreationProjectPrefix,
} from './framescaper-capture-creation-admission.ts';

const MANIFEST_KEY_PREFIX = 'framescaper-capture-session-manifest-v1:';
const PUBLICATION_FENCE_KEY_PREFIX = 'framescaper-capture-session-creation-fence-v1:';
const MAXIMUM_CAPTURE_CREATIONS = 4_096;
export const FRAMESCAPER_CAPTURE_CREATION_LEASE_MILLISECONDS = 60_000;

interface CaptureCreationStreamBaseV1 {
	readonly streamId: string;
	readonly spoolId: string;
	readonly spoolToken: string;
	readonly sourceId: string;
	readonly required: boolean;
}

export interface FramescaperEncodedCaptureCreationStreamV1 extends CaptureCreationStreamBaseV1 {
	readonly kind: 'encoded-media';
	readonly role: 'camera' | 'display';
	readonly mimeType: string;
}

export interface FramescaperRawPcmCaptureCreationStreamV1 extends CaptureCreationStreamBaseV1 {
	readonly kind: 'raw-pcm';
	readonly role: 'microphone' | 'system-audio';
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly chunkFrames: number;
}

export type FramescaperCaptureCreationStreamV1 =
	FramescaperEncodedCaptureCreationStreamV1 | FramescaperRawPcmCaptureCreationStreamV1;

/** Exact, separately versioned ownership for spools created before a session manifest exists. */
export interface FramescaperCaptureSessionCreationV1 {
	readonly version: 1;
	readonly kind: 'framescaper-capture-session-creation';
	readonly state: 'creating' | 'cleanup-pending';
	readonly sessionId: string;
	readonly generation: number;
	readonly projectFence: FramescaperCaptureSessionManifestV1['projectFence'];
	readonly origin: FramescaperCaptureSessionManifestV1['origin'];
	readonly monotonicOriginMicroseconds: number;
	readonly streams: readonly FramescaperCaptureCreationStreamV1[];
	readonly createdAt: number;
	readonly leaseExpiresAt: number;
}

export interface FramescaperCaptureManifestKeyValuePort {
	get(key: string): PromiseLike<unknown> | unknown;
	putIfAbsent(key: string, value: unknown): PromiseLike<boolean> | boolean;
	putIfAbsentWhenCurrent?(
		fenceKey: string, expectedFence: unknown, key: string, value: unknown,
	): PromiseLike<boolean> | boolean;
	putIfAbsentAndUpdate?(
		key: string, value: unknown, inventoryKey: string,
		expectedInventory: unknown | undefined, nextInventory: unknown,
	): PromiseLike<boolean> | boolean;
	replaceIfCurrent(key: string, expected: unknown, replacement: unknown): PromiseLike<boolean> | boolean;
	deleteIfCurrent(key: string, expected: unknown): PromiseLike<boolean> | boolean;
	listByPrefix(prefix: string): PromiseLike<readonly Readonly<{
		readonly key: string; readonly value: unknown;
	}>[]> | readonly Readonly<{ readonly key: string; readonly value: unknown }>[];
}

/** Owns the global retry journal and the same-key publication fence for each partial creation. */
export class FramescaperCaptureSessionCreationRepository {
	readonly #values: FramescaperCaptureManifestKeyValuePort;
	readonly #admissions: FramescaperCaptureCreationAdmissionRepository;

	constructor(values: FramescaperCaptureManifestKeyValuePort) {
		this.#values = values;
		this.#admissions = new FramescaperCaptureCreationAdmissionRepository(values);
	}

	async loadCreation(
		projectIdValue: string,
		sessionIdValue: string,
	): Promise<FramescaperCaptureSessionCreationV1 | null> {
		const projectId = stableId(projectIdValue, 'Framescaper capture creation projectId');
		const sessionId = stableId(sessionIdValue, 'Framescaper capture creation sessionId');
		const value = await this.#values.get(framescaperCaptureCreationJournalKey(projectId, sessionId));
		if (value === undefined || value === null) return null;
		const creation = normalizeFramescaperCaptureSessionCreation(value);
		if (creation.projectFence.projectId !== projectId || creation.sessionId !== sessionId) {
			throw new Error('Framescaper capture creation key ownership changed.');
		}
		return creation;
	}

	async listProjectCreations(
		projectIdValue: string,
	): Promise<readonly FramescaperCaptureSessionCreationV1[]> {
		const projectId = stableId(projectIdValue, 'Framescaper capture creation projectId');
		const creations = (await this.#values.listByPrefix(creationProjectPrefix(projectId))).map(({ key, value }) => {
			const creation = normalizeFramescaperCaptureSessionCreation(value);
			if (creation.projectFence.projectId !== projectId
				|| key !== framescaperCaptureCreationJournalKey(projectId, creation.sessionId)) {
				throw new Error('Framescaper capture creation inventory contains foreign project ownership.');
			}
			return creation;
		});
		return Object.freeze(creations.sort((left, right) => left.sessionId.localeCompare(right.sessionId)));
	}

	async listCreations(): Promise<readonly FramescaperCaptureSessionCreationV1[]> {
		const values = await this.#values.listByPrefix(framescaperCaptureCreationGlobalPrefix());
		if (values.length > MAXIMUM_CAPTURE_CREATIONS) {
			throw new RangeError('Framescaper capture creation inventory exceeds its global bound.');
		}
		const creations = values.map(({ key, value }) => {
			const creation = normalizeFramescaperCaptureSessionCreation(value);
			if (key !== framescaperCaptureCreationJournalKey(
				creation.projectFence.projectId, creation.sessionId,
			)) {
				throw new Error('Framescaper capture creation inventory key ownership changed.');
			}
			return creation;
		});
		const identities = new Set(creations.map((creation) => (
			`${creation.projectFence.projectId}\u0000${creation.sessionId}`
		)));
		if (identities.size !== creations.length) {
			throw new Error('Framescaper capture creation inventory contains conflicting ownership.');
		}
		await this.#admissions.assertAdmitted(creations.map((creation) => ({
			projectId: creation.projectFence.projectId,
			sessionId: creation.sessionId,
		})));
		return Object.freeze(creations.sort((left, right) => (
			left.projectFence.projectId.localeCompare(right.projectFence.projectId)
				|| left.sessionId.localeCompare(right.sessionId)
		)));
	}

	async createCreation(value: unknown): Promise<FramescaperCaptureSessionCreationV1> {
		const creation = normalizeFramescaperCaptureSessionCreation(value);
		if (creation.state !== 'creating') {
			throw new Error('A Framescaper capture creation must begin in its creating state.');
		}
		await this.#admissions.reserve({
			projectId: creation.projectFence.projectId,
			sessionId: creation.sessionId,
		}, creation);
		const createFence = this.#values.putIfAbsentWhenCurrent;
		if (typeof createFence !== 'function') {
			throw new TypeError('Framescaper capture creation requires an atomic publication fence.');
		}
		const journalKey = framescaperCaptureCreationJournalKey(
			creation.projectFence.projectId, creation.sessionId,
		);
		const fenceKey = creationFenceKey(creation.projectFence.projectId, creation.sessionId);
		try {
			if (await createFence.call(this.#values, journalKey, creation, fenceKey, creation)) return creation;
		} catch (error) {
			if (sameCreationValue(await this.#values.get(journalKey), creation)
				&& sameCreationValue(await this.#values.get(fenceKey), creation)) return creation;
			throw error;
		}
		if (sameCreationValue(await this.#values.get(journalKey), creation)
			&& sameCreationValue(await this.#values.get(fenceKey), creation)) return creation;
		throw new Error(`Framescaper capture creation ${creation.sessionId} could not reserve its publication fence.`);
	}

	async publishCreation(
		expectedValue: unknown,
		value: unknown,
	): Promise<FramescaperCaptureSessionManifestV1> {
		const expected = normalizeFramescaperCaptureSessionCreation(expectedValue);
		const manifest = normalizeFramescaperCaptureSessionManifest(value);
		assertInitialCreationManifest(expected, manifest);
		if (expected.state !== 'creating') {
			throw new Error('Only a currently creating Framescaper capture can publish its manifest.');
		}
		const current = await this.loadCreation(expected.projectFence.projectId, expected.sessionId);
		if (!sameCreation(current, expected)) {
			throw new Error('Framescaper capture creation ownership changed before manifest publication.');
		}
		const publish = this.#values.putIfAbsentWhenCurrent;
		if (typeof publish !== 'function') {
			throw new TypeError('Framescaper capture manifest publication requires an atomic creation fence.');
		}
		const fenceKey = creationFenceKey(expected.projectFence.projectId, expected.sessionId);
		const manifestKey = framescaperCaptureManifestKey(expected.projectFence.projectId, expected.sessionId);
		let published = false;
		try { published = await publish.call(this.#values, fenceKey, expected, manifestKey, manifest); }
		catch (error) {
			const observed = await this.#values.get(manifestKey);
			if (observed !== undefined && observed !== null) {
				const currentManifest = normalizeFramescaperCaptureSessionManifest(observed);
				if (JSON.stringify(currentManifest) === JSON.stringify(manifest)) return currentManifest;
			}
			throw error;
		}
		if (!published) {
			const observed = await this.#values.get(manifestKey);
			if (observed !== undefined && observed !== null) {
				const currentManifest = normalizeFramescaperCaptureSessionManifest(observed);
				if (JSON.stringify(currentManifest) === JSON.stringify(manifest)) return currentManifest;
			}
			throw new Error('Framescaper capture creation lost its manifest-publication fence.');
		}
		return manifest;
	}

	async replaceCreation(
		expectedValue: unknown,
		nextValue: unknown,
	): Promise<FramescaperCaptureSessionCreationV1> {
		const expected = normalizeFramescaperCaptureSessionCreation(expectedValue);
		const next = normalizeFramescaperCaptureSessionCreation(nextValue);
		assertCreationTransition(expected, next);
		const fenceKey = creationFenceKey(expected.projectFence.projectId, expected.sessionId);
		const fenceValue = await this.#values.get(fenceKey);
		if (fenceValue !== undefined && fenceValue !== null) {
			if (!hasFramescaperCaptureCreationKind(fenceValue)) {
				throw new Error('The Framescaper capture creation was already published.');
			}
			const fence = normalizeFramescaperCaptureSessionCreation(fenceValue);
			if (!sameCreation(fence, next)) {
				if (!sameCreation(fence, expected)) {
					throw new Error('The Framescaper capture creation publication fence changed before replacement.');
				}
				try {
					if (!await this.#values.replaceIfCurrent(fenceKey, fence, next)) {
						throw new Error('The Framescaper capture creation publication fence changed before replacement.');
					}
				} catch (error) {
					if (!sameCreationValue(await this.#values.get(fenceKey), next)) throw error;
				}
			}
		}
		const key = framescaperCaptureCreationJournalKey(expected.projectFence.projectId, expected.sessionId);
		if (!await this.#values.replaceIfCurrent(key, expected, next)
			&& !sameCreation(await this.loadCreation(
				expected.projectFence.projectId, expected.sessionId,
			), next)) {
			throw new Error('The Framescaper capture creation changed before replacement.');
		}
		return next;
	}

	async removeCreation(expectedValue: unknown): Promise<void> {
		const expected = normalizeFramescaperCaptureSessionCreation(expectedValue);
		const fenceKey = creationFenceKey(expected.projectFence.projectId, expected.sessionId);
		const fenceValue = await this.#values.get(fenceKey);
		if (fenceValue !== undefined && fenceValue !== null) {
			if (hasFramescaperCaptureCreationKind(fenceValue)) {
				const fence = normalizeFramescaperCaptureSessionCreation(fenceValue);
				if (!sameCreation(fence, expected)) {
					const manifestValue = await this.#values.get(framescaperCaptureManifestKey(
						expected.projectFence.projectId, expected.sessionId,
					));
					if (expected.state !== 'creating' || fence.state !== 'cleanup-pending'
						|| manifestValue === undefined || manifestValue === null) {
						throw new Error('The Framescaper capture creation publication fence changed before removal.');
					}
					assertCreationTransition(expected, fence);
					assertCreationMatchesManifest(
						expected, normalizeFramescaperCaptureSessionManifest(manifestValue),
					);
				}
				if (!await this.#values.deleteIfCurrent(fenceKey, fence)) {
					throw new Error('The Framescaper capture creation publication fence changed before removal.');
				}
			} else assertCreationMatchesManifest(
				expected,
				normalizeFramescaperCaptureSessionManifest(fenceValue),
			);
		}
		const key = framescaperCaptureCreationJournalKey(expected.projectFence.projectId, expected.sessionId);
		const currentValue = await this.#values.get(key);
		if (currentValue !== undefined && currentValue !== null) {
			const current = normalizeFramescaperCaptureSessionCreation(currentValue);
			if (!sameCreation(current, expected) || !await this.#values.deleteIfCurrent(key, current)) {
				throw new Error('The Framescaper capture creation changed before removal.');
			}
		}
		await this.#admissions.release({
			projectId: expected.projectFence.projectId,
			sessionId: expected.sessionId,
		});
	}
}

export function normalizeFramescaperCaptureSessionCreation(
	value: unknown,
): FramescaperCaptureSessionCreationV1 {
	const record = dataRecord(value, 'Framescaper capture creation', [
		'version', 'kind', 'state', 'sessionId', 'generation', 'projectFence', 'origin',
		'monotonicOriginMicroseconds', 'streams', 'createdAt', 'leaseExpiresAt',
	]);
	if (record.version !== 1 || record.kind !== 'framescaper-capture-session-creation'
		|| (record.state !== 'creating' && record.state !== 'cleanup-pending')) {
		throw new TypeError('Framescaper capture creation version, state, or streams are invalid.');
	}
	const streams = dataArray(record.streams, 'Framescaper capture creation streams');
	const chunkFrames = new Map<string, number>();
	const candidateStreams = streams.map((value) => {
		const stream = dataRecord(value, 'Framescaper capture creation stream');
		assertAllowedKeys(stream, stream.kind === 'encoded-media'
			? ['kind', 'role', 'required', 'streamId', 'spoolId', 'spoolToken', 'sourceId', 'mimeType']
			: ['kind', 'role', 'required', 'streamId', 'spoolId', 'spoolToken', 'sourceId',
				'sampleRate', 'channelCount', 'chunkFrames']);
		if (stream.kind === 'raw-pcm') chunkFrames.set(
			stableId(stream.streamId, 'Framescaper capture creation streamId'),
			positiveInteger(stream.chunkFrames, 'Framescaper capture creation chunkFrames'),
		);
		return creationManifestStream(stream);
	});
	const createdAt = nonNegativeInteger(record.createdAt, 'Framescaper capture creation time');
	const leaseExpiresAt = nonNegativeInteger(record.leaseExpiresAt, 'Framescaper capture creation lease expiration');
	if (leaseExpiresAt !== exactSum(
		createdAt,
		FRAMESCAPER_CAPTURE_CREATION_LEASE_MILLISECONDS,
		'Framescaper capture creation lease expiration',
	)) throw new RangeError('Framescaper capture creation lease duration is invalid.');
	const manifest = normalizeFramescaperCaptureSessionManifest({
		version: 1, sessionId: record.sessionId, generation: record.generation,
		state: 'capturing', recoveryDecision: null,
		projectFence: record.projectFence, origin: record.origin,
		clock: { monotonicOriginMicroseconds: record.monotonicOriginMicroseconds, pauseSpans: [] },
		streams: candidateStreams, createdAt, updatedAt: createdAt,
	});
	return Object.freeze({
		version: 1, kind: 'framescaper-capture-session-creation', state: record.state,
		sessionId: manifest.sessionId, generation: manifest.generation,
		projectFence: manifest.projectFence, origin: manifest.origin,
		monotonicOriginMicroseconds: manifest.clock.monotonicOriginMicroseconds,
		streams: Object.freeze(manifest.streams.map((stream): FramescaperCaptureCreationStreamV1 => (
			stream.storage.kind === 'encoded-media' ? Object.freeze({
				kind: 'encoded-media', role: stream.role as 'camera' | 'display', required: stream.required,
				streamId: stream.streamId, spoolId: stream.storage.spoolId,
				spoolToken: stream.storage.spoolToken, sourceId: stream.storage.sourceId,
				mimeType: stream.storage.mimeType,
			}) : Object.freeze({
				kind: 'raw-pcm', role: stream.role as 'microphone' | 'system-audio', required: stream.required,
				streamId: stream.streamId, spoolId: stream.storage.spoolId,
				spoolToken: stream.storage.spoolToken, sourceId: stream.storage.sourceId,
				sampleRate: stream.storage.sampleRate, channelCount: stream.storage.channelCount,
				chunkFrames: chunkFrames.get(stream.streamId)!,
			})
		))),
		createdAt, leaseExpiresAt,
	});
}

export function hasFramescaperCaptureCreationKind(value: unknown): boolean {
	return Boolean(value && typeof value === 'object'
		&& Object.getOwnPropertyDescriptor(value, 'kind')?.value === 'framescaper-capture-session-creation');
}

export function framescaperCaptureManifestKey(projectId: string, sessionId: string): string {
	return `${framescaperCaptureManifestProjectPrefix(projectId)}${encodeURIComponent(sessionId)}`;
}

export function framescaperCaptureManifestProjectPrefix(projectId: string): string {
	return `${MANIFEST_KEY_PREFIX}${encodeURIComponent(projectId)}:`;
}

function assertCreationTransition(
	expected: FramescaperCaptureSessionCreationV1,
	next: FramescaperCaptureSessionCreationV1,
): void {
	if (JSON.stringify({ ...expected, state: null }) !== JSON.stringify({ ...next, state: null })
		|| (expected.state !== next.state
			&& (expected.state !== 'creating' || next.state !== 'cleanup-pending'))) {
		throw new Error('Framescaper capture creation ownership or state changed backward.');
	}
}

function assertCreationMatchesManifest(
	creation: FramescaperCaptureSessionCreationV1,
	manifest: FramescaperCaptureSessionManifestV1,
): void {
	const contract = (stream: FramescaperCaptureCreationStreamV1 | FramescaperCaptureStreamManifestV1) => {
		const storage = 'storage' in stream ? stream.storage : stream;
		return storage.kind === 'encoded-media' ? {
			kind: storage.kind, streamId: stream.streamId, role: stream.role, required: stream.required,
			spoolId: storage.spoolId, spoolToken: storage.spoolToken,
			sourceId: storage.sourceId, mimeType: storage.mimeType,
		} : {
			kind: storage.kind, streamId: stream.streamId, role: stream.role, required: stream.required,
			spoolId: storage.spoolId, spoolToken: storage.spoolToken,
			sourceId: storage.sourceId, sampleRate: storage.sampleRate, channelCount: storage.channelCount,
		};
	};
	const expected = {
		sessionId: creation.sessionId, generation: creation.generation,
		projectFence: creation.projectFence, origin: creation.origin,
		monotonicOriginMicroseconds: creation.monotonicOriginMicroseconds,
		createdAt: creation.createdAt,
		streams: creation.streams.map(contract),
	};
	const observed = {
		sessionId: manifest.sessionId, generation: manifest.generation,
		projectFence: manifest.projectFence, origin: manifest.origin,
		monotonicOriginMicroseconds: manifest.clock.monotonicOriginMicroseconds,
		createdAt: manifest.createdAt,
		streams: manifest.streams.map(contract),
	};
	if (JSON.stringify(expected) !== JSON.stringify(observed)) {
		throw new Error('Framescaper capture creation manifest ownership changed.');
	}
}

function assertInitialCreationManifest(
	creation: FramescaperCaptureSessionCreationV1,
	manifest: FramescaperCaptureSessionManifestV1,
): void {
	const expected = normalizeFramescaperCaptureSessionManifest({
		version: 1,
		sessionId: creation.sessionId,
		generation: creation.generation,
		state: 'capturing',
		recoveryDecision: null,
		projectFence: creation.projectFence,
		origin: creation.origin,
		clock: { monotonicOriginMicroseconds: creation.monotonicOriginMicroseconds, pauseSpans: [] },
		streams: creation.streams.map(creationManifestStream),
		createdAt: creation.createdAt,
		updatedAt: creation.createdAt,
	});
	if (JSON.stringify(expected) !== JSON.stringify(manifest)) {
		throw new Error('Framescaper capture creation requires its exact initial manifest.');
	}
}


function creationManifestStream(
	value: FramescaperCaptureCreationStreamV1 | Readonly<Record<string, unknown>>,
): unknown {
	const stream = value as unknown as Readonly<Record<string, unknown>>;
	const base = {
		streamId: stream.streamId, role: stream.role, required: stream.required, playability: 'unknown',
		timing: { firstPresentationMicroseconds: null, lastPresentationEndMicroseconds: null },
	};
	if (stream.kind === 'encoded-media') return {
		...base,
		storage: { kind: 'encoded-media', spoolId: stream.spoolId, spoolToken: stream.spoolToken,
			sourceId: stream.sourceId, mimeType: stream.mimeType,
			packetCount: 0, chunkCount: 0, byteLength: 0 },
	};
	if (stream.kind === 'raw-pcm') return {
		...base,
		storage: { kind: 'raw-pcm', spoolId: stream.spoolId, spoolToken: stream.spoolToken,
			sourceId: stream.sourceId, sampleRate: stream.sampleRate,
			channelCount: stream.channelCount, frameCount: 0, chunkCount: 0 },
	};
	throw new TypeError('Framescaper capture creation stream kind is invalid.');
}

function sameCreation(
	left: FramescaperCaptureSessionCreationV1 | null,
	right: FramescaperCaptureSessionCreationV1,
): boolean {
	return left !== null && JSON.stringify(left) === JSON.stringify(right);
}

function sameCreationValue(
	value: unknown,
	expected: FramescaperCaptureSessionCreationV1,
): boolean {
	if (value === undefined || value === null) return false;
	return sameCreation(normalizeFramescaperCaptureSessionCreation(value), expected);
}

export function framescaperCaptureCreationFenceKey(projectId: string, sessionId: string): string {
	return creationFenceKey(projectId, sessionId);
}

function creationFenceKey(projectId: string, sessionId: string): string {
	return `${PUBLICATION_FENCE_KEY_PREFIX}${encodeURIComponent(projectId)}:${encodeURIComponent(sessionId)}`;
}

function creationProjectPrefix(projectId: string): string {
	return framescaperCaptureCreationProjectPrefix(projectId);
}

function dataRecord(value: unknown, name: string, allowedKeys?: readonly string[]): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a closed data record.`);
	}
	const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of Reflect.ownKeys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${String(key)} must be an enumerable data property.`);
		}
		result[key] = descriptor.value;
	}
	if (allowedKeys) assertAllowedKeys(result, allowedKeys);
	return Object.freeze(result);
}

function dataArray(value: unknown, name: string): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError(`${name} must be a closed data array.`);
	}
	const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
	if (!Number.isSafeInteger(length) || Number(length) < 0
		|| Reflect.ownKeys(value).length !== Number(length) + 1) {
		throw new TypeError(`${name} must be a dense closed data array.`);
	}
	const result: unknown[] = [];
	for (let index = 0; index < Number(length); index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}[${String(index)}] must be an enumerable data property.`);
		}
		result.push(descriptor.value);
	}
	return Object.freeze(result);
}

function assertAllowedKeys(record: Readonly<Record<string, unknown>>, allowedKeys: readonly string[]): void {
	const allowed = new Set(allowedKeys);
	if (Object.keys(record).length !== allowedKeys.length
		|| Object.keys(record).some((key) => !allowed.has(key))
		|| allowedKeys.some((key) => !Object.hasOwn(record, key))) {
		throw new TypeError('Framescaper capture creation has an invalid closed shape.');
	}
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

function positiveInteger(value: unknown, name: string): number {
	const integer = nonNegativeInteger(value, name);
	if (integer < 1) throw new RangeError(`${name} must be positive.`);
	return integer;
}

function exactSum(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} exceeds the safe integer range.`);
	return result;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()
		|| value !== value.normalize('NFC') || value.length > 256
		|| /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}
