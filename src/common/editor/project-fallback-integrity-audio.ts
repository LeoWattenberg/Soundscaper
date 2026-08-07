/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	aggregateScapeErrors,
	awaitScapeOperation,
	awaitScapeReadOperation,
} from './scape-abort.ts';
import {
	createScapeAudioExportChunkBudget,
	createScapeDigest,
	scapeAudioSourceLayout,
	scapeAudioSourceStream,
	scapeHex,
	type ScapeAudioSource,
} from './scape-archive-media.ts';
import type { ScapeProjectFallbackClaim } from './scape-project-assets.ts';
import {
	PROJECT_FEATURE_REQUIREMENTS_LIMITS,
	type ProjectFeatureFallback,
	type ProjectFeatureRequirement,
} from './project-feature-requirements.ts';
import { packPlanarFloat32 } from './wavpack/pcm.js';

export const PROJECT_AUDIO_FALLBACK_INTEGRITY_ERROR_CODE = 'PROJECT_AUDIO_FALLBACK_INTEGRITY' as const;

interface ProjectAudioFallbackIntegritySelectorBase {
	readonly requirementId: string;
	readonly featureId: string;
	readonly kind: 'audio';
	readonly sourceId: string;
	readonly sha256: string;
}

export type ProjectAudioFallbackIntegritySelector = ProjectAudioFallbackIntegritySelectorBase & (
	| Readonly<{ role: 'project-audio-mix-v1'; targetTrackId: null }>
	| Readonly<{ role: 'audio-track-render-v1'; targetTrackId: string }>
);

export interface ProjectAudioFallbackSource extends ScapeAudioSource {
	readonly kind?: 'audio' | 'video';
	readonly sampleRate?: number;
}

interface StoredSourceChunk {
	readonly index?: unknown;
	readonly frames?: unknown;
	readonly channels?: readonly Float32Array[];
}

export interface ProjectAudioFallbackStore {
	readSourceChunks(
		sourceId: string,
		options?: Readonly<{
			signal?: AbortSignal;
			migrateLegacyPcmOnAccess?: boolean;
		}>,
	): AsyncIterable<readonly Float32Array[] | StoredSourceChunk>;
	readSourceChunk?(
		sourceId: string,
		chunkIndex: number,
		options?: Readonly<{
			signal?: AbortSignal;
			migrateLegacyPcmOnAccess?: boolean;
		}>,
	): PromiseLike<unknown> | unknown;
}

export interface ProjectAudioFallbackChunkProvider {
	readonly channelCount: number;
	readonly frameCount: number;
	readonly chunkFrames: number;
	readonly sampleRate: number;
	readStorageChunk(
		chunkIndex: number,
		context?: Readonly<{ signal?: AbortSignal | null }>,
	): Promise<readonly Float32Array[]>;
}

export interface ProjectAudioFallbackVerificationTarget {
	readonly claim: ScapeProjectFallbackClaim;
	readonly source: ProjectAudioFallbackSource;
	readonly expectedBytes: number;
}

interface SelectedAudioVerificationOptions {
	readonly signal?: AbortSignal;
	readonly assertCurrent: () => void;
	readonly assertProviderCurrent?: () => void;
}

interface IteratorCleanupCapture {
	failure: unknown;
	failed: boolean;
}

interface CanonicalStoredChunk {
	readonly channels: readonly Float32Array[];
	readonly frameCount: number;
	readonly header: Uint8Array;
	readonly payload: Uint8Array;
}

class ProjectAudioFallbackIntegrityError extends Error {
	readonly code = PROJECT_AUDIO_FALLBACK_INTEGRITY_ERROR_CODE;

	constructor(message: string, cause?: unknown) {
		super(message, cause === undefined ? undefined : { cause });
		this.name = 'ProjectAudioFallbackIntegrityError';
	}
}

export function isProjectAudioFallbackIntegrityError(error: unknown): boolean {
	return Boolean(error && typeof error === 'object'
		&& (error as Readonly<{ code?: unknown }>).code === PROJECT_AUDIO_FALLBACK_INTEGRITY_ERROR_CODE);
}

export function snapshotProjectAudioFallbackSelector(
	value: unknown,
): ProjectAudioFallbackIntegritySelector {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('The selected audio rendered fallback is invalid.');
	}
	const selector = value as Record<PropertyKey, unknown>;
	const captured = Object.freeze({
		requirementId: ownSelectorData(selector, 'requirementId'),
		featureId: ownSelectorData(selector, 'featureId'),
		role: ownSelectorData(selector, 'role'),
		kind: ownSelectorData(selector, 'kind'),
		sourceId: ownSelectorData(selector, 'sourceId'),
		sha256: ownSelectorData(selector, 'sha256'),
		targetTrackId: ownSelectorData(selector, 'targetTrackId'),
	});
	if (typeof captured.requirementId !== 'string' || !captured.requirementId
		|| typeof captured.featureId !== 'string' || !captured.featureId
		|| captured.kind !== 'audio'
		|| typeof captured.sourceId !== 'string' || !captured.sourceId
		|| typeof captured.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(captured.sha256)
		|| !validAudioRelationship(captured.role, captured.targetTrackId)) {
		throw new TypeError('The selected audio rendered fallback is invalid.');
	}
	return captured as ProjectAudioFallbackIntegritySelector;
}

function validAudioRelationship(role: unknown, targetTrackId: unknown): boolean {
	if (role === 'project-audio-mix-v1') return targetTrackId === null;
	return role === 'audio-track-render-v1' && typeof targetTrackId === 'string'
		&& targetTrackId.length <= PROJECT_FEATURE_REQUIREMENTS_LIMITS.maximumSourceIdLength
		&& targetTrackId.length > 0 && targetTrackId === targetTrackId.trim()
		&& !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(targetTrackId);
}

export function selectProjectAudioFallbackTarget<Source extends ProjectAudioFallbackSource>(
	requirements: readonly ProjectFeatureRequirement[],
	sources: readonly Source[],
	selector: ProjectAudioFallbackIntegritySelector,
): Readonly<{ claim: ProjectFeatureFallback; source: Source }> {
	const matches = requirements.filter(({ id }) => id === selector.requirementId);
	const requirement = matches.length === 1 ? matches[0] : undefined;
	const fallback = requirement?.fallback;
	const sourceMatches = sources.filter(({ id }) => id === selector.sourceId);
	const source = sourceMatches.length === 1 ? sourceMatches[0] : undefined;
	const conflictingClaim = requirements.some((candidate) => candidate.fallback?.sourceId === selector.sourceId
		&& (!sameAudioRelationship(candidate.fallback, selector)
			|| candidate.fallback.kind !== selector.kind
			|| candidate.fallback.sha256 !== selector.sha256));
	if (!requirement || requirement.featureId !== selector.featureId
		|| requirement.disposition !== 'rendered-fallback' || fallback?.kind !== selector.kind
		|| !sameAudioRelationship(fallback, selector)
		|| fallback.sourceId !== selector.sourceId || fallback.sha256 !== selector.sha256
		|| !source || source.kind !== selector.kind || conflictingClaim) {
		throw new Error('The selected audio rendered fallback does not match one active project requirement and source claim.');
	}
	return Object.freeze({ claim: fallback, source });
}

function sameAudioRelationship(
	claim: ProjectFeatureFallback,
	selector: ProjectAudioFallbackIntegritySelector,
): boolean {
	return claim.role === selector.role
		&& (claim.role === 'audio-track-render-v1' ? claim.targetTrackId : null) === selector.targetTrackId;
}

export function projectAudioFallbackSelectorMatches(
	requirements: readonly ProjectFeatureRequirement[],
	sources: readonly ProjectAudioFallbackSource[],
	selector: ProjectAudioFallbackIntegritySelector,
): boolean {
	try {
		selectProjectAudioFallbackTarget(requirements, sources, selector);
		return true;
	} catch {
		return false;
	}
}

export function sameProjectAudioFallbackSelector(
	left: ProjectAudioFallbackIntegritySelector,
	right: ProjectAudioFallbackIntegritySelector,
): boolean {
	return left.requirementId === right.requirementId && left.featureId === right.featureId
		&& left.role === right.role && left.kind === right.kind
		&& left.sourceId === right.sourceId && left.sha256 === right.sha256
		&& left.targetTrackId === right.targetTrackId;
}

/** Preserve the controller-activation verifier used when no exact selector is present. */
export async function verifyProjectAudioFallback(
	target: ProjectAudioFallbackVerificationTarget,
	store: ProjectAudioFallbackStore,
	audioChunkBudget: ReturnType<typeof createScapeAudioExportChunkBudget>,
	signal?: AbortSignal,
): Promise<void> {
	const digest = createScapeDigest();
	let size = 0;
	const cleanup: IteratorCleanupCapture = { failure: undefined, failed: false };
	const stream = scapeAudioSourceStream(
		cleanupPreservingAudioStore(store, cleanup),
		target.source,
		digest,
		(byteLength) => { size += byteLength; },
		signal,
		audioChunkBudget,
	);
	try {
		await drainStream(stream, signal);
	} catch (error) {
		if (cleanup.failed && cleanup.failure !== error) {
			throw aggregateScapeErrors(
				error,
				[cleanup.failure],
				'Rendered fallback verification and source cleanup both failed.',
			);
		}
		throw error;
	}
	if (cleanup.failed) throw cleanup.failure;
	if (size !== target.expectedBytes) {
		throw new Error(`Rendered fallback source ${target.claim.sourceId} has an unexpected size.`);
	}
	assertDigest(target.claim, scapeHex(digest.digest()));
}

/** Full scan plus a private, digest-bound random-access provider for one exact audio claim. */
export async function verifySelectedProjectAudioFallback(
	target: ProjectAudioFallbackVerificationTarget,
	store: ProjectAudioFallbackStore,
	audioChunkBudget: ReturnType<typeof createScapeAudioExportChunkBudget>,
	options: SelectedAudioVerificationOptions,
): Promise<ProjectAudioFallbackChunkProvider> {
	if (typeof store.readSourceChunks !== 'function' || typeof store.readSourceChunk !== 'function') {
		throw new TypeError('Selected stored audio fallback verification is unavailable.');
	}
	const layout = scapeAudioSourceLayout(target.source);
	canonicalSampleRate(target.source.sampleRate, target.source.id);
	const digestTable = new Uint8Array(layout.chunkCount * 32);
	const sourceDigest = createScapeDigest();
	let size = 0;
	let primaryFailure: unknown;
	let iterator: AsyncIterator<readonly Float32Array[] | StoredSourceChunk>;
	try {
		iterator = selectedAudioIterator(store, target.source, options.signal);
	} catch (error) {
		throwIfExactAborted(options.signal);
		throw error;
	}
	try {
		options.assertCurrent();
		for (let chunkIndex = 0; chunkIndex < layout.chunkCount; chunkIndex += 1) {
			throwIfExactAborted(options.signal);
			const next = await awaitScapeReadOperation(() => iterator.next(), options.signal);
			throwIfExactAborted(options.signal);
			if (next.done) {
				throw new Error(`Stored PCM for ${target.source.id} ended before its declared frame count.`);
			}
			const canonical = canonicalStoredChunk(next.value, target.source, layout.chunkFrames, chunkIndex);
			audioChunkBudget.consume(target.source.id);
			const chunkDigest = createScapeDigest();
			for (const bytes of [canonical.header, canonical.payload]) {
				chunkDigest.update(bytes);
				sourceDigest.update(bytes);
				size += bytes.byteLength;
			}
			digestTable.set(chunkDigest.digest(), chunkIndex * 32);
			throwIfExactAborted(options.signal);
		}
		const extra = await awaitScapeReadOperation(() => iterator.next(), options.signal);
		throwIfExactAborted(options.signal);
		if (!extra.done) throw new Error(`Stored PCM for ${target.source.id} has more chunks than declared.`);
		if (size !== target.expectedBytes) {
			throw new Error(`Rendered fallback source ${target.claim.sourceId} has an unexpected size.`);
		}
		assertDigest(target.claim, scapeHex(sourceDigest.digest()));
		options.assertCurrent();
	} catch (error) {
		primaryFailure = error;
	}
	const cleanupFailure = await closeSelectedIterator(iterator, options.signal);
	throwIfExactAborted(options.signal);
	if (primaryFailure !== undefined) {
		if (cleanupFailure !== undefined && cleanupFailure !== primaryFailure) {
			throw aggregateScapeErrors(
				primaryFailure,
				[cleanupFailure],
				'Rendered fallback verification and source cleanup both failed.',
			);
		}
		throw primaryFailure;
	}
	if (cleanupFailure !== undefined) throw cleanupFailure;
	options.assertCurrent();
	return createVerifiedAudioChunkProvider(target.source, store, digestTable, options);
}

function createVerifiedAudioChunkProvider(
	source: ProjectAudioFallbackSource,
	store: ProjectAudioFallbackStore,
	digestTable: Uint8Array,
	options: SelectedAudioVerificationOptions,
): ProjectAudioFallbackChunkProvider {
	const layout = scapeAudioSourceLayout(source);
	const sampleRate = canonicalSampleRate(source.sampleRate, source.id);
	const storageKey = sourceStorageKey(source);
	return Object.freeze({
		channelCount: layout.channelCount,
		frameCount: layout.frameCount,
		chunkFrames: layout.chunkFrames,
		sampleRate,
		async readStorageChunk(
			chunkIndex: number,
			context: Readonly<{ signal?: AbortSignal | null }> = {},
		): Promise<readonly Float32Array[]> {
			const signal = providerSignal(options.signal, context.signal ?? undefined);
			throwIfExactAborted(signal);
			try {
				assertProviderChunkIndex(chunkIndex, layout.chunkCount);
			} catch (error) {
				throwProviderIntegrity(error, chunkIndex);
			}
			const assertCurrent = options.assertProviderCurrent ?? options.assertCurrent;
			assertCurrent();
			throwIfExactAborted(signal);
			let value: unknown;
			try {
				value = await awaitScapeReadOperation(
					() => store.readSourceChunk?.(storageKey, chunkIndex, {
						signal,
						migrateLegacyPcmOnAccess: false,
					}),
					signal,
				);
			} catch (error) {
				if (signal?.aborted) throw signal.reason;
				throwProviderIntegrity(error, chunkIndex);
			}
			throwIfExactAborted(signal);
			assertCurrent();
			throwIfExactAborted(signal);
			let canonical: CanonicalStoredChunk;
			try {
				canonical = canonicalStoredChunk(value, source, layout.chunkFrames, chunkIndex);
				const digest = createScapeDigest();
				digest.update(canonical.header);
				digest.update(canonical.payload);
				const expected = digestTable.subarray(chunkIndex * 32, (chunkIndex + 1) * 32);
				if (!sameBytes(digest.digest(), expected)) {
					throw new ProjectAudioFallbackIntegrityError(
						`Stored rendered fallback chunk ${String(chunkIndex)} changed after integrity admission.`,
					);
				}
			} catch (error) {
				throwProviderIntegrity(error, chunkIndex);
			}
			throwIfExactAborted(signal);
			assertCurrent();
			throwIfExactAborted(signal);
			return Object.freeze([...canonical.channels]);
		},
	});
}

function selectedAudioIterator(
	store: ProjectAudioFallbackStore,
	source: ProjectAudioFallbackSource,
	signal?: AbortSignal,
): AsyncIterator<readonly Float32Array[] | StoredSourceChunk> {
	const iterable = store.readSourceChunks(sourceStorageKey(source), {
		signal,
		migrateLegacyPcmOnAccess: false,
	});
	if (!iterable || typeof iterable[Symbol.asyncIterator] !== 'function') {
		throw new TypeError('Stored audio fallback verification did not return an async iterable.');
	}
	const iterator = iterable[Symbol.asyncIterator]();
	if (!iterator || typeof iterator.next !== 'function') {
		throw new TypeError('Stored audio fallback verification did not return an async iterator.');
	}
	return iterator;
}

function canonicalStoredChunk(
	value: unknown,
	source: ProjectAudioFallbackSource,
	chunkFrames: number,
	chunkIndex: number,
): CanonicalStoredChunk {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`Stored PCM for ${source.id} is invalid.`);
	}
	const record = value as Record<PropertyKey, unknown>;
	const index = ownChunkData(record, 'index', source.id);
	const frames = ownChunkData(record, 'frames', source.id);
	const channelValue = ownChunkData(record, 'channels', source.id);
	if (index !== chunkIndex) {
		throw new Error(`Stored PCM for ${source.id} has noncanonical chunk order.`);
	}
	const expectedFrameCount = Math.min(chunkFrames, source.frameCount - chunkIndex * chunkFrames);
	if (frames !== expectedFrameCount) {
		throw new Error(`Stored PCM for ${source.id} has noncanonical PCM chunk geometry.`);
	}
	if (!Array.isArray(channelValue) || Object.getPrototypeOf(channelValue) !== Array.prototype
		|| channelValue.length !== source.channelCount) {
		throw new Error(`Stored PCM for ${source.id} is invalid.`);
	}
	const channels = channelValue.map((channel) => {
		if (!(channel instanceof Float32Array) || channel.length !== expectedFrameCount) {
			throw new Error(`Stored PCM for ${source.id} has noncanonical PCM chunk geometry.`);
		}
		return new Float32Array(channel);
	});
	const header = new Uint8Array(4);
	new DataView(header.buffer).setUint32(0, expectedFrameCount, true);
	const payload = new Uint8Array(packPlanarFloat32(channels) as ArrayBuffer);
	return Object.freeze({
		channels: Object.freeze(channels),
		frameCount: expectedFrameCount,
		header,
		payload,
	});
}

async function closeSelectedIterator(
	iterator: AsyncIterator<readonly Float32Array[] | StoredSourceChunk>,
	signal?: AbortSignal,
): Promise<unknown> {
	if (typeof iterator.return !== 'function') return undefined;
	let operation: PromiseLike<IteratorResult<readonly Float32Array[] | StoredSourceChunk>> | IteratorResult<readonly Float32Array[] | StoredSourceChunk>;
	try {
		operation = iterator.return();
	} catch (error) {
		return error;
	}
	if (signal?.aborted) {
		void Promise.resolve(operation).catch(() => undefined);
		return undefined;
	}
	try {
		await awaitScapeReadOperation(() => operation, signal);
		return undefined;
	} catch (error) {
		if (signal?.aborted) throw signal.reason;
		return error;
	}
}

async function drainStream(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<void> {
	const reader = stream.getReader();
	try {
		while (true) {
			const next = await awaitScapeOperation(reader.read(), signal);
			if (next.done) return;
		}
	} catch (error) {
		try {
			await reader.cancel(error);
		} catch (cleanupError) {
			if (cleanupError !== error) {
				throw new AggregateError(
					[error, cleanupError],
					'Rendered fallback verification and source cleanup both failed.',
				);
			}
		}
		throw error;
	} finally {
		reader.releaseLock();
	}
}

function cleanupPreservingAudioStore(
	store: ProjectAudioFallbackStore,
	capture: IteratorCleanupCapture,
): Required<Pick<ProjectAudioFallbackStore, 'readSourceChunks'>> {
	return {
		readSourceChunks(sourceId, options) {
			const iterable = store.readSourceChunks(sourceId, {
				...options,
				migrateLegacyPcmOnAccess: false,
			});
			const iterator = iterable[Symbol.asyncIterator]();
			const wrapped: AsyncIterableIterator<readonly Float32Array[] | StoredSourceChunk> = {
				next: () => iterator.next(),
				async return() {
					try {
						return await iterator.return?.() ?? { done: true, value: undefined };
					} catch (error) {
						if (!capture.failed) {
							capture.failed = true;
							capture.failure = error;
						}
						return { done: true, value: undefined };
					}
				},
				[Symbol.asyncIterator]() { return wrapped; },
			};
			return wrapped;
		},
	};
}

function assertDigest(claim: ScapeProjectFallbackClaim, digest: string): void {
	if (digest !== claim.sha256) {
		throw new Error(`Rendered fallback source ${claim.sourceId} failed SHA-256 verification.`);
	}
}

function sourceStorageKey(source: ProjectAudioFallbackSource): string {
	if (source.storageKey === undefined) return source.id;
	if (typeof source.storageKey !== 'string' || !source.storageKey.trim()) {
		throw new TypeError(`Rendered fallback source ${source.id} has an invalid storage key.`);
	}
	return source.storageKey;
}

function canonicalSampleRate(value: unknown, sourceId: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 768_000) {
		throw new RangeError(`Rendered fallback source ${sourceId} has an invalid sample rate.`);
	}
	return Number(value);
}

function ownSelectorData(record: Record<PropertyKey, unknown>, key: PropertyKey): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor || !('value' in descriptor)) {
		throw new TypeError('The selected audio rendered fallback is invalid.');
	}
	return descriptor.value;
}

function ownChunkData(record: Record<PropertyKey, unknown>, key: PropertyKey, sourceId: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor || !('value' in descriptor)) {
		throw new Error(`Stored PCM for ${sourceId} is invalid.`);
	}
	return descriptor.value;
}

function assertProviderChunkIndex(chunkIndex: number, chunkCount: number): void {
	if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= chunkCount) {
		throw new RangeError(`Source storage chunk ${String(chunkIndex)} does not exist.`);
	}
}

function providerSignal(
	operationSignal?: AbortSignal,
	requestSignal?: AbortSignal,
): AbortSignal | undefined {
	if (!operationSignal) return requestSignal;
	if (!requestSignal || requestSignal === operationSignal) return operationSignal;
	return AbortSignal.any([operationSignal, requestSignal]);
}

function throwIfExactAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason;
}

function throwProviderIntegrity(error: unknown, chunkIndex: number): never {
	if (isProjectAudioFallbackIntegrityError(error)
		|| (error instanceof Error && error.name === 'AbortError')) throw error;
	throw new ProjectAudioFallbackIntegrityError(
		`Audio rendered fallback chunk ${String(chunkIndex)} failed operation-time integrity verification.`,
		error,
	);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) return false;
	let difference = 0;
	for (let index = 0; index < left.byteLength; index += 1) {
		difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
	}
	return difference === 0;
}
