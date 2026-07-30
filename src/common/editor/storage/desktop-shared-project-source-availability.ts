/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	validateAudioEditorProjectV9,
	type AudioEditorProjectV9,
} from '../project-v9.ts';
import { collectProjectSourceIds } from '../retention.js';
import { SCAPE_ARCHIVE_LIMITS } from '../scape-archive-envelope.ts';
import { scapeAudioSourceLayout } from '../scape-archive-media.ts';
import { awaitScapeReadOperation, throwIfScapeAborted } from '../scape-abort.ts';
import {
	ScapeAudioChunkBudget,
	ScapeExpandedByteBudget,
} from '../scape-expanded-byte-budget.ts';
import {
	canonicalMediaContentBlob,
	digestMediaContent,
} from './media-content-digest.ts';

interface StoredSourceChunk {
	readonly index?: unknown;
	readonly frames?: unknown;
	readonly channels?: unknown;
}

export interface DesktopSharedProjectSourceAvailabilityStore {
	getSourceMetadata(sourceId: string): PromiseLike<unknown> | unknown;
	readSourceChunks(
		sourceId: string,
		options?: Readonly<{
			signal?: AbortSignal;
			migrateLegacyPcmOnAccess?: boolean;
		}>,
	): AsyncIterable<readonly Float32Array[] | StoredSourceChunk>;
	getMediaAssetMetadata(sourceId: string): PromiseLike<unknown> | unknown;
	loadMediaAsset(
		sourceId: string,
		options?: Readonly<{
			signal?: AbortSignal;
			backfillDigest?: boolean;
		}>,
	): PromiseLike<unknown> | unknown;
}

export type DesktopSharedProjectSourceAvailability = DesktopSharedProjectSourceAvailabilityStore;

export interface DesktopSharedProjectSourceAvailabilityOptions { readonly signal?: AbortSignal; }

type CapturedSource = CapturedAudioSource | CapturedVideoSource;

interface CapturedSourceBase {
	readonly id: string;
	readonly kind: 'audio' | 'video';
	readonly storageKey: string;
	readonly mimeType: string;
	readonly frameCount: number;
	readonly sampleRate: number;
}

interface CapturedAudioSource extends CapturedSourceBase {
	readonly kind: 'audio';
	readonly channelCount: number;
	readonly originalSampleRate: number;
	readonly sampleFormat: string;
	readonly chunkFrames: number;
}

interface CapturedVideoSource extends CapturedSourceBase {
	readonly kind: 'video';
	readonly width: number;
	readonly height: number;
	readonly frameRate: number;
	readonly videoCodec: string;
	readonly audioCodec: string | null;
	readonly hasAudio: boolean;
	readonly posterStorageKey: string | null;
	readonly thumbnailStorageKey: string | null;
}

interface AudioStorageSnapshot {
	readonly id: string;
	readonly storage: string;
	readonly sourceToken: string;
	readonly baseSourceId: string | null;
	readonly path: string | null;
	readonly committedAt: string;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
	readonly chunkFrames: number;
	readonly chunkCount: number;
}

interface VideoStorageSnapshot {
	readonly sourceId: string;
	readonly storage: string;
	readonly path: string | null;
	readonly committedAt: string;
	readonly mimeType: string;
	readonly size: number;
	readonly sha256: string | null;
}

type AvailabilityPlan = AudioAvailabilityPlan | VideoAvailabilityPlan;

interface AudioAvailabilityPlan {
	readonly kind: 'audio';
	readonly source: CapturedAudioSource;
	readonly expectedChunkCount: number;
	readonly storage: AudioStorageSnapshot;
}

interface VideoAvailabilityPlan {
	readonly kind: 'video';
	readonly source: CapturedVideoSource;
	readonly storage: VideoStorageSnapshot;
}

const MAXIMUM_SOURCE_TARGETS = SCAPE_ARCHIVE_LIMITS.maximumEntryCount - 2;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

/** A shared source has no explicitly bound, completely readable recipient-local payload. */
export class DesktopSharedProjectSourceUnavailableError extends Error {
	readonly projectId: string;
	readonly sourceId: string;
	readonly sourceKind: 'audio' | 'video';

	constructor(
		projectId: string,
		sourceId: string,
		sourceKind: 'audio' | 'video',
		cause?: unknown,
	) {
		super(
			`Recipient-local ${sourceKind} source ${sourceId} is unavailable for desktop shared project ${projectId}.`,
			cause === undefined ? undefined : { cause },
		);
		this.name = 'DesktopSharedProjectSourceUnavailableError';
		this.projectId = projectId;
		this.sourceId = sourceId;
		this.sourceKind = sourceKind;
	}
}

export function desktopSharedProjectHasSourceReferences(project: AudioEditorProjectV9): boolean {
	return collectProjectSourceIds(project).size > 0;
}

/**
 * Proves a point-in-time, read-only recipient-local outcome for every durable
 * exact-V9 source reference. The prior local revision binds otherwise opaque
 * storage keys to this project; this operation neither copies nor relinks data.
 */
export async function verifyDesktopSharedProjectSourceAvailability(
	project: unknown,
	priorLocalProject: unknown,
	store: DesktopSharedProjectSourceAvailabilityStore,
	options: DesktopSharedProjectSourceAvailabilityOptions = {},
): Promise<void> {
	const signal = options.signal;
	throwIfScapeAborted(signal);
	validateAudioEditorProjectV9(project);
	const current = project as AudioEditorProjectV9;
	const sources = captureReachableSources(current);
	if (!sources.length) return;
	if (sources.length > MAXIMUM_SOURCE_TARGETS) {
		throw new RangeError('Desktop shared project source references exceed the portable source-count limit.');
	}
	assertPriorBindings(current.id, sources, priorLocalProject);
	const storageSources = uniqueStorageBindings(sources);
	assertAvailabilityStore(store, storageSources);

	const audioChunkBudget = new ScapeAudioChunkBudget();
	const expandedByteBudget = new ScapeExpandedByteBudget(SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes);
	const audioChunkCounts = new Map<string, number>();
	for (const source of storageSources) {
		if (source.kind !== 'audio') continue;
		const layout = scapeAudioSourceLayout(source);
		audioChunkBudget.consumeMany(layout.chunkCount, source.id);
		expandedByteBudget.consume(layout.archiveBytes, source.id);
		audioChunkCounts.set(source.id, layout.chunkCount);
	}

	const plans: AvailabilityPlan[] = [];
	for (const source of storageSources) {
		throwIfScapeAborted(signal);
		if (source.kind === 'audio') {
			const storage = await sourceRead(source, current.id, signal, async () => {
				const metadata = await awaitScapeReadOperation(
					() => store.getSourceMetadata(source.storageKey),
					signal,
				);
				return captureAudioStorage(source, metadata);
			});
			plans.push(Object.freeze({
				kind: 'audio',
				source,
				expectedChunkCount: audioChunkCounts.get(source.id) ?? 0,
				storage,
			}));
			continue;
		}
		const storage = await sourceRead(source, current.id, signal, async () => {
			const metadata = await awaitScapeReadOperation(
				() => store.getMediaAssetMetadata(source.storageKey),
				signal,
			);
			return captureVideoStorage(source, metadata);
		});
		expandedByteBudget.consume(storage.size, source.id);
		plans.push(Object.freeze({ kind: 'video', source, storage }));
	}

	for (const plan of plans) {
		throwIfScapeAborted(signal);
		if (plan.kind === 'audio') await verifyAudio(plan, current.id, store, signal);
		else await verifyVideo(plan, current.id, store, signal);
	}
}

function captureReachableSources(project: AudioEditorProjectV9): readonly CapturedSource[] {
	const sourceById = new Map(project.sources.map((source) => [String(source.id), source]));
	const captured: CapturedSource[] = [];
	for (const sourceId of collectProjectSourceIds(project)) {
		const source = sourceById.get(sourceId);
		if (!source) throw new ReferenceError(`Desktop shared project source ${sourceId} is missing.`);
		captured.push(captureSource(source));
	}
	return Object.freeze(captured);
}

function captureSource(source: Readonly<Record<string, unknown>>): CapturedSource {
	const base = {
		id: source.id as string,
		kind: source.kind as 'audio' | 'video',
		storageKey: source.storageKey as string,
		mimeType: source.mimeType as string,
		frameCount: source.frameCount as number,
		sampleRate: source.sampleRate as number,
	};
	if (base.kind === 'audio') {
		return Object.freeze({
			...base,
			kind: 'audio',
			channelCount: source.channelCount as number,
			originalSampleRate: source.originalSampleRate as number,
			sampleFormat: source.sampleFormat as string,
			chunkFrames: source.chunkFrames as number,
		});
	}
	return Object.freeze({
		...base,
		kind: 'video',
		width: source.width as number,
		height: source.height as number,
		frameRate: source.frameRate as number,
		videoCodec: source.videoCodec as string,
		audioCodec: source.audioCodec as string | null,
		hasAudio: source.hasAudio as boolean,
		posterStorageKey: source.posterStorageKey as string | null,
		thumbnailStorageKey: source.thumbnailStorageKey as string | null,
	});
}

function uniqueStorageBindings(sources: readonly CapturedSource[]): readonly CapturedSource[] {
	const ownerByKey = new Map<string, CapturedSource>();
	const unique: CapturedSource[] = [];
	for (const source of sources) {
		const domainKey = `${source.kind}\u0000${source.storageKey}`;
		const owner = ownerByKey.get(domainKey);
		if (owner) {
			if (!sameStorageBinding(owner, source)) {
				throw new RangeError(`Desktop shared project sources ${owner.id} and ${source.id} conflict for one storage key.`);
			}
			continue;
		}
		ownerByKey.set(domainKey, source);
		unique.push(source);
	}
	return Object.freeze(unique);
}

function sameStorageBinding(left: CapturedSource, right: CapturedSource): boolean {
	if (left.kind !== right.kind) return false;
	const leftRecord = left as unknown as Readonly<Record<string, unknown>>;
	const rightRecord = right as unknown as Readonly<Record<string, unknown>>;
	const leftKeys = Object.keys(leftRecord).filter((key) => key !== 'id');
	const rightKeys = Object.keys(rightRecord).filter((key) => key !== 'id');
	return leftKeys.length === rightKeys.length
		&& leftKeys.every((key) => Object.is(leftRecord[key], rightRecord[key]));
}

function assertPriorBindings(
	projectId: string,
	sources: readonly CapturedSource[],
	priorLocalProject: unknown,
): void {
	const unavailable = (source: CapturedSource, cause?: unknown): never => {
		throw new DesktopSharedProjectSourceUnavailableError(projectId, source.id, source.kind, cause);
	};
	if (priorLocalProject == null) unavailable(sources[0] as CapturedSource);
	try {
		validateAudioEditorProjectV9(priorLocalProject);
	} catch (cause) {
		unavailable(sources[0] as CapturedSource, cause);
	}
	const prior = priorLocalProject as AudioEditorProjectV9;
	if (prior.id !== projectId) unavailable(sources[0] as CapturedSource);
	const priorById = new Map(prior.sources.map((source) => [String(source.id), captureSource(source)]));
	for (const source of sources) {
		const bound = priorById.get(source.id);
		if (!bound || !sameRecord(source, bound)) unavailable(source);
	}
}

function assertAvailabilityStore(
	store: DesktopSharedProjectSourceAvailabilityStore,
	sources: readonly CapturedSource[],
): void {
	if (!store || typeof store !== 'object') {
		throw new TypeError('Desktop shared project source availability is required.');
	}
	if (sources.some(({ kind }) => kind === 'audio')) {
		if (typeof store.getSourceMetadata !== 'function' || typeof store.readSourceChunks !== 'function') {
			throw new TypeError('Desktop shared project audio availability is incomplete.');
		}
	}
	if (sources.some(({ kind }) => kind === 'video')) {
		if (typeof store.getMediaAssetMetadata !== 'function' || typeof store.loadMediaAsset !== 'function') {
			throw new TypeError('Desktop shared project video availability is incomplete.');
		}
	}
}

function captureAudioStorage(source: CapturedAudioSource, value: unknown): AudioStorageSnapshot {
	const metadata = sourceMetadata(value, source, 'audio');
	const snapshot = Object.freeze({
		id: requiredString(metadata, 'id'),
		storage: requiredString(metadata, 'storage'),
		sourceToken: requiredString(metadata, 'sourceToken'),
		baseSourceId: optionalString(metadata, 'baseSourceId'),
		path: optionalString(metadata, 'path'),
		committedAt: requiredString(metadata, 'committedAt'),
		frameCount: requiredSafeInteger(metadata, 'frameCount', 1),
		channelCount: requiredSafeInteger(metadata, 'channelCount', 1),
		sampleRate: requiredSafeInteger(metadata, 'sampleRate', 1),
		chunkFrames: requiredSafeInteger(metadata, 'chunkFrames', 1),
		chunkCount: requiredSafeInteger(metadata, 'chunkCount', 1),
	});
	const expectedChunkCount = Math.ceil(source.frameCount / source.chunkFrames);
	if (snapshot.id !== source.storageKey
		|| snapshot.frameCount !== source.frameCount
		|| snapshot.channelCount !== source.channelCount
		|| snapshot.sampleRate !== source.sampleRate
		|| snapshot.chunkFrames !== source.chunkFrames
		|| snapshot.chunkCount !== expectedChunkCount) {
		throw new Error(`Recipient-local audio source ${source.id} metadata does not match its project binding.`);
	}
	return snapshot;
}

function captureVideoStorage(source: CapturedVideoSource, value: unknown): VideoStorageSnapshot {
	const metadata = sourceMetadata(value, source, 'video');
	const sha256 = optionalString(metadata, 'sha256');
	if (sha256 !== null && !SHA256_PATTERN.test(sha256)) {
		throw new TypeError(`Recipient-local video source ${source.id} has an invalid SHA-256.`);
	}
	const snapshot = Object.freeze({
		sourceId: requiredString(metadata, 'sourceId'),
		storage: requiredString(metadata, 'storage'),
		path: optionalString(metadata, 'path'),
		committedAt: requiredString(metadata, 'committedAt'),
		mimeType: requiredString(metadata, 'mimeType'),
		size: requiredSafeInteger(metadata, 'size', 1),
		sha256,
	});
	if (snapshot.sourceId !== source.storageKey || snapshot.mimeType !== source.mimeType) {
		throw new Error(`Recipient-local video source ${source.id} metadata does not match its project binding.`);
	}
	return snapshot;
}

function sourceMetadata(
	value: unknown,
	source: CapturedSource,
	kind: 'audio' | 'video',
): Record<PropertyKey, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`Recipient-local ${kind} source ${source.id} metadata is missing.`);
	}
	return value as Record<PropertyKey, unknown>;
}

async function verifyAudio(
	plan: AudioAvailabilityPlan,
	projectId: string,
	store: DesktopSharedProjectSourceAvailabilityStore,
	signal?: AbortSignal,
): Promise<void> {
	await sourceRead(plan.source, projectId, signal, async () => {
		const iterable = store.readSourceChunks(plan.source.storageKey, {
			signal,
			migrateLegacyPcmOnAccess: false,
		});
		if (!iterable || typeof iterable[Symbol.asyncIterator] !== 'function') {
			throw new TypeError('Recipient-local PCM must be an async iterable.');
		}
		const iterator = iterable[Symbol.asyncIterator]();
		let primary: unknown;
		let failed = false;
		try {
			for (let index = 0; index < plan.expectedChunkCount; index += 1) {
				const next = await awaitScapeReadOperation(() => iterator.next(), signal);
				throwIfScapeAborted(signal);
				if (next.done) throw new Error(`Recipient-local PCM for ${plan.source.id} ended early.`);
				assertAudioChunk(plan.source, next.value, index);
			}
			const extra = await awaitScapeReadOperation(() => iterator.next(), signal);
			throwIfScapeAborted(signal);
			if (!extra.done) throw new Error(`Recipient-local PCM for ${plan.source.id} has extra chunks.`);
		} catch (error) {
			failed = true;
			primary = error;
			throw error;
		} finally {
			await closeAudioIterator(iterator, failed, primary, signal);
		}
		const current = await awaitScapeReadOperation(
			() => store.getSourceMetadata(plan.source.storageKey),
			signal,
		);
		if (!sameRecord(plan.storage, captureAudioStorage(plan.source, current))) {
			throw new Error(`Recipient-local audio source ${plan.source.id} changed during admission.`);
		}
	});
}

async function closeAudioIterator(
	iterator: AsyncIterator<readonly Float32Array[] | StoredSourceChunk>,
	verificationFailed: boolean,
	primary: unknown,
	signal?: AbortSignal,
): Promise<void> {
	let cleanup: Promise<unknown>;
	try {
		cleanup = Promise.resolve(iterator.return?.());
	} catch (cleanupError) {
		if (signal?.aborted) return;
		throw iteratorCleanupError(verificationFailed, primary, cleanupError);
	}
	if (signal?.aborted) {
		void cleanup.catch(() => undefined);
		return;
	}
	try {
		await awaitScapeReadOperation(() => cleanup, signal);
	} catch (cleanupError) {
		if (signal?.aborted) {
			void cleanup.catch(() => undefined);
			return;
		}
		throw iteratorCleanupError(verificationFailed, primary, cleanupError);
	}
}

function iteratorCleanupError(
	verificationFailed: boolean,
	primary: unknown,
	cleanupError: unknown,
): unknown {
	if (!verificationFailed) return cleanupError;
	return new AggregateError(
		[primary, cleanupError],
		'Recipient-local PCM verification and iterator cleanup both failed.',
	);
}

function assertAudioChunk(source: CapturedAudioSource, value: unknown, index: number): void {
	const record = Array.isArray(value) ? null : value as StoredSourceChunk;
	const channels = Array.isArray(value) ? value : record?.channels;
	if (!Array.isArray(channels) || channels.length !== source.channelCount) {
		throw new Error(`Recipient-local PCM for ${source.id} has invalid channels.`);
	}
	const expectedFrames = Math.min(source.chunkFrames, source.frameCount - index * source.chunkFrames);
	for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(channels, String(channelIndex));
		if (!descriptor || !('value' in descriptor) || !(descriptor.value instanceof Float32Array)) {
			throw new Error(`Recipient-local PCM for ${source.id} has invalid channels.`);
		}
		if (descriptor.value.length !== expectedFrames) {
			throw new Error(`Recipient-local PCM for ${source.id} has noncanonical chunk geometry.`);
		}
	}
	if (record && record.index !== undefined && record.index !== index) {
		throw new Error(`Recipient-local PCM for ${source.id} has an unexpected chunk index.`);
	}
	if (record && record.frames !== undefined && record.frames !== expectedFrames) {
		throw new Error(`Recipient-local PCM for ${source.id} has an unexpected frame count.`);
	}
}

async function verifyVideo(
	plan: VideoAvailabilityPlan,
	projectId: string,
	store: DesktopSharedProjectSourceAvailabilityStore,
	signal?: AbortSignal,
): Promise<void> {
	await sourceRead(plan.source, projectId, signal, async () => {
		const loaded = await awaitScapeReadOperation(() => store.loadMediaAsset(plan.source.storageKey, {
			signal,
			backfillDigest: false,
		}), signal);
		if (loaded == null) throw new Error(`Recipient-local video source ${plan.source.id} body is missing.`);
		const blob = canonicalMediaContentBlob(loaded);
		if (blob.size !== plan.storage.size) {
			throw new Error(`Recipient-local video source ${plan.source.id} has an unexpected body size.`);
		}
		const digest = await digestMediaContent(blob, { signal });
		if (plan.storage.sha256 !== null && digest !== plan.storage.sha256) {
			throw new Error(`Recipient-local video source ${plan.source.id} failed SHA-256 verification.`);
		}
		const current = await awaitScapeReadOperation(
			() => store.getMediaAssetMetadata(plan.source.storageKey),
			signal,
		);
		if (!sameRecord(plan.storage, captureVideoStorage(plan.source, current))) {
			throw new Error(`Recipient-local video source ${plan.source.id} changed during admission.`);
		}
	});
}

async function sourceRead<Value>(
	source: CapturedSource,
	projectId: string,
	signal: AbortSignal | undefined,
	read: () => PromiseLike<Value> | Value,
): Promise<Value> {
	try {
		return await read();
	} catch (cause) {
		if (signal?.aborted) {
			if (signal.reason !== undefined) throw signal.reason;
			throwIfScapeAborted(signal);
		}
		if (cause instanceof DesktopSharedProjectSourceUnavailableError) throw cause;
		throw new DesktopSharedProjectSourceUnavailableError(projectId, source.id, source.kind, cause);
	}
}

function requiredString(record: Record<PropertyKey, unknown>, key: string): string {
	const value = ownDataValue(record, key, true);
	if (typeof value !== 'string' || !value) throw new TypeError(`Recipient-local metadata.${key} must be text.`);
	return value;
}

function optionalString(record: Record<PropertyKey, unknown>, key: string): string | null {
	const value = ownDataValue(record, key, false);
	if (value === undefined || value === null) return null;
	if (typeof value !== 'string' || !value) throw new TypeError(`Recipient-local metadata.${key} must be text.`);
	return value;
}

function requiredSafeInteger(record: Record<PropertyKey, unknown>, key: string, minimum: number): number {
	const value = ownDataValue(record, key, true);
	if (!Number.isSafeInteger(value) || Number(value) < minimum) {
		throw new RangeError(`Recipient-local metadata.${key} is invalid.`);
	}
	return Number(value);
}

function ownDataValue(
	record: Record<PropertyKey, unknown>,
	key: PropertyKey,
	required: boolean,
): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor) {
		if (!required) return undefined;
		throw new TypeError(`Recipient-local metadata.${String(key)} is missing.`);
	}
	if (!('value' in descriptor)) {
		throw new TypeError(`Recipient-local metadata.${String(key)} must be a data property.`);
	}
	return descriptor.value;
}

function sameRecord(left: object, right: object): boolean {
	const leftRecord = left as Readonly<Record<string, unknown>>;
	const rightRecord = right as Readonly<Record<string, unknown>>;
	const keys = Object.keys(leftRecord);
	if (keys.length !== Object.keys(rightRecord).length) return false;
	return keys.every((key) => Object.is(leftRecord[key], rightRecord[key]));
}
