/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createScapeAudioExportChunkBudget,
	createScapeDigest,
	scapeAudioSourceLayout,
	scapeAudioSourceStream,
	scapeHex,
	type ScapeAudioSource,
} from './scape-archive-media.ts';
import {
	aggregateScapeErrors,
	awaitScapeOperation,
	awaitScapeReadOperation,
	throwIfScapeAborted,
} from './scape-abort.ts';
import { SCAPE_ARCHIVE_LIMITS } from './scape-archive-envelope.ts';
import {
	snapshotScapeProjectFallbackIntegrity,
	type ScapeProjectFallbackClaim,
} from './scape-project-assets.ts';
import {
	PROJECT_FEATURE_REQUIREMENTS_LIMITS,
	type ProjectFeatureRequirement,
} from './project-feature-requirements.ts';
import {
	projectVideoFallbackSelectorMatches,
	sameProjectVideoFallbackSelector,
	selectProjectVideoFallbackTarget,
	snapshotProjectVideoFallbackSelector,
	type ProjectVideoFallbackIntegritySelector,
} from './project-fallback-integrity-video.ts';
export type { ProjectVideoFallbackIntegritySelector } from './project-fallback-integrity-video.ts';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from './project-v9.ts';
import {
	canonicalMediaContentBlob,
	digestMediaContent,
} from './storage/media-content-digest.ts';

interface ProjectFallbackSource extends ScapeAudioSource {
	readonly kind?: 'audio' | 'video';
}

interface StoredSourceChunk {
	readonly channels?: readonly Float32Array[];
}

export interface ProjectFallbackIntegrityStore {
	readSourceChunks?(
		sourceId: string,
		options?: Readonly<{
			signal?: AbortSignal;
			migrateLegacyPcmOnAccess?: boolean;
		}>,
	): AsyncIterable<readonly Float32Array[] | StoredSourceChunk>;
	loadMediaAsset?(
		sourceId: string,
		options?: Readonly<{
			signal?: AbortSignal;
			backfillDigest?: boolean;
		}>,
	): PromiseLike<unknown> | unknown;
	getMediaAssetMetadata?(sourceId: string): PromiseLike<unknown> | unknown;
}

export interface ProjectFallbackIntegrityOptions {
	readonly signal?: AbortSignal;
	readonly videoFallback?: ProjectVideoFallbackIntegritySelector;
}

interface VerificationTarget {
	readonly claim: ScapeProjectFallbackClaim;
	readonly source: ProjectFallbackSource;
}

interface VerificationPlan extends VerificationTarget {
	readonly expectedBytes: number;
}

interface CapturedProjectFallbackIntegrity {
	readonly schemaVersion: unknown;
	readonly claims: readonly ScapeProjectFallbackClaim[];
	readonly requirements: readonly ProjectFeatureRequirement[];
	readonly sources: readonly ProjectFallbackSource[];
}

interface IteratorCleanupCapture {
	failure: unknown;
	failed: boolean;
}

export interface ProjectFallbackIntegrityAdmission {
	assertCurrent(project: unknown): void;
	getVerifiedVideoBlob(selector: ProjectVideoFallbackIntegritySelector): Blob;
}

/**
 * Verifies exact-schema-9 rendered fallbacks against their canonical stored
 * bytes before controller activation. Future schemas are intentionally opaque.
 */
export async function verifyProjectFallbackIntegrity(
	project: unknown,
	store: ProjectFallbackIntegrityStore,
	options: ProjectFallbackIntegrityOptions = {},
): Promise<ProjectFallbackIntegrityAdmission> {
	const signal = options.signal;
	throwIfScapeAborted(signal);
	const videoSelector = options.videoFallback === undefined
		? null
		: snapshotProjectVideoFallbackSelector(options.videoFallback);
	const captured = captureProjectFallbackIntegrity(project);
	if (videoSelector && captured.schemaVersion !== AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION) {
		throw new Error('A selected video rendered fallback requires exact project schema 9.');
	}
	const admissionState = snapshotAdmissionState(captured);
	if (!captured.claims.length && !videoSelector) return createAdmission(admissionState);
	const targetValues: VerificationTarget[] = [];
	if (videoSelector) {
		targetValues.push(selectProjectVideoFallbackTarget(
			captured.requirements,
			captured.sources,
			videoSelector,
		));
	} else {
		const sourcesById = new Map(captured.sources.map((source) => [source.id, source]));
		const targets = new Map<string, VerificationTarget>();
		for (const claim of captured.claims) {
			const existing = targets.get(claim.sourceId);
			if (existing) {
				if (existing.claim.kind !== claim.kind || existing.claim.sha256 !== claim.sha256) {
					throw new Error(`Rendered fallback source ${claim.sourceId} has conflicting SHA-256 claims.`);
				}
				continue;
			}
			const source = sourcesById.get(claim.sourceId);
			if (!source) throw new Error(`Rendered fallback source ${claim.sourceId} is unavailable.`);
			targets.set(claim.sourceId, Object.freeze({ claim, source }));
		}
		targetValues.push(...targets.values());
	}
	const audioSources = targetValues.filter(({ claim }) => claim.kind === 'audio').map(({ source }) => source);
	const audioChunkBudget = createScapeAudioExportChunkBudget(audioSources);
	const plans = await preflightVerification(targetValues, store, signal);
	let verifiedVideoBlob: Blob | null = null;
	for (const plan of plans) {
		throwIfScapeAborted(signal);
		if (plan.claim.kind === 'audio') {
			await verifyAudioFallback(plan, store, audioChunkBudget, signal);
		} else {
			const blob = await verifyVideoFallback(plan, store, signal);
			if (videoSelector) verifiedVideoBlob = blob;
		}
	}
	return createAdmission(admissionState, videoSelector && verifiedVideoBlob
		? Object.freeze({ selector: videoSelector, blob: verifiedVideoBlob })
		: null);
}

async function preflightVerification(
	targets: readonly VerificationTarget[],
	store: ProjectFallbackIntegrityStore,
	signal?: AbortSignal,
): Promise<readonly VerificationPlan[]> {
	if (targets.some(({ claim }) => claim.kind === 'audio')
		&& typeof store?.readSourceChunks !== 'function') {
		throw new TypeError('Stored audio fallback verification is unavailable.');
	}
	if (targets.some(({ claim }) => claim.kind === 'video')
		&& (typeof store?.getMediaAssetMetadata !== 'function'
			|| typeof store.loadMediaAsset !== 'function')) {
		throw new TypeError('Stored video fallback verification is unavailable.');
	}
	let admittedBytes = 0;
	const plans: VerificationPlan[] = [];
	for (const target of targets) {
		throwIfScapeAborted(signal);
		const storageKey = sourceStorageKey(target.source);
		let expectedBytes: number;
		if (target.claim.kind === 'audio') {
			expectedBytes = scapeAudioSourceLayout(target.source).archiveBytes;
		} else {
			const metadata = await awaitScapeReadOperation(
				() => store.getMediaAssetMetadata?.(storageKey),
				signal,
			);
			if (metadata == null) {
				throw new Error(`Rendered fallback source ${target.claim.sourceId} is unavailable.`);
			}
			expectedBytes = mediaAssetSize(metadata, target.claim.sourceId);
		}
		if (expectedBytes > SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes - admittedBytes) {
			throw new RangeError('Rendered fallbacks exceed the cumulative .scape expanded-byte limit.');
		}
		admittedBytes += expectedBytes;
		plans.push(Object.freeze({ ...target, expectedBytes }));
	}
	return Object.freeze(plans);
}

async function verifyAudioFallback(
	target: VerificationPlan,
	store: ProjectFallbackIntegrityStore,
	audioChunkBudget: ReturnType<typeof createScapeAudioExportChunkBudget>,
	signal?: AbortSignal,
): Promise<void> {
	const digest = createScapeDigest();
	let size = 0;
	const cleanup: IteratorCleanupCapture = { failure: undefined, failed: false };
	const stream = scapeAudioSourceStream(
		cleanupPreservingAudioStore(
			store as Required<Pick<ProjectFallbackIntegrityStore, 'readSourceChunks'>>,
			cleanup,
		),
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

async function verifyVideoFallback(
	target: VerificationPlan,
	store: ProjectFallbackIntegrityStore,
	signal?: AbortSignal,
): Promise<Blob> {
	const storageKey = sourceStorageKey(target.source);
	const loaded = await awaitScapeOperation(store.loadMediaAsset?.(storageKey, {
		signal,
		backfillDigest: false,
	}), signal);
	if (loaded == null) {
		throw new Error(`Rendered fallback source ${target.claim.sourceId} is unavailable.`);
	}
	const blob = canonicalMediaContentBlob(loaded);
	if (blob.size !== target.expectedBytes) {
		throw new Error(`Rendered fallback source ${target.claim.sourceId} has an unexpected size.`);
	}
	const digest = await digestMediaContent(blob, { signal });
	assertDigest(target.claim, digest);
	return blob;
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

function assertDigest(claim: ScapeProjectFallbackClaim, digest: string): void {
	if (digest !== claim.sha256) {
		throw new Error(`Rendered fallback source ${claim.sourceId} failed SHA-256 verification.`);
	}
}

function sourceStorageKey(source: ProjectFallbackSource): string {
	if (source.storageKey === undefined) return source.id;
	if (typeof source.storageKey !== 'string' || !source.storageKey.trim()) {
		throw new TypeError(`Rendered fallback source ${source.id} has an invalid storage key.`);
	}
	return source.storageKey;
}

function mediaAssetSize(metadata: unknown, sourceId: string): number {
	const record = objectRecord(metadata, `Stored media metadata for ${sourceId}`);
	const size = ownDataValue(record, 'size', `Stored media metadata for ${sourceId}`);
	if (!Number.isSafeInteger(size) || Number(size) < 0) {
		throw new RangeError(`Rendered fallback source ${sourceId} has an invalid stored size.`);
	}
	return Number(size);
}

function captureProjectFallbackIntegrity(project: unknown): CapturedProjectFallbackIntegrity {
	const candidate = objectRecord(project, 'The project fallback integrity candidate');
	const schemaVersion = ownDataValue(candidate, 'schemaVersion', 'project');
	if (schemaVersion !== AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION) {
		return Object.freeze({
			schemaVersion,
			claims: Object.freeze([]),
			requirements: Object.freeze([]),
			sources: Object.freeze([]),
		});
	}
	const sources = snapshotArray(
		ownDataValue(candidate, 'sources', 'project'),
		'project.sources',
		(value, index) => snapshotSource(value, index),
	);
	const featureRequirements = snapshotFeatureRequirements(
		ownDataValue(candidate, 'featureRequirements', 'project'),
	);
	const snapshot = snapshotScapeProjectFallbackIntegrity(Object.freeze({
		schemaVersion,
		sources,
		featureRequirements,
	}));
	return Object.freeze({
		schemaVersion,
		claims: snapshot.claims,
		requirements: snapshot.featureRequirements?.requirements ?? Object.freeze([]),
		sources,
	});
}

function snapshotSource(value: unknown, index: number): ProjectFallbackSource {
	const source = objectRecord(value, `project.sources[${String(index)}]`);
	const id = ownDataValue(source, 'id', `project.sources[${String(index)}]`);
	if (typeof id !== 'string' || !id) {
		throw new TypeError('A rendered fallback source must have an ID.');
	}
	return Object.freeze({
		id,
		kind: optionalOwnDataValue(source, 'kind', `project source ${id}`) as 'audio' | 'video' | undefined,
		storageKey: optionalOwnDataValue(source, 'storageKey', `project source ${id}`) as string | undefined,
		frameCount: optionalOwnDataValue(source, 'frameCount', `project source ${id}`) as number,
		channelCount: optionalOwnDataValue(source, 'channelCount', `project source ${id}`) as number,
		chunkFrames: optionalOwnDataValue(source, 'chunkFrames', `project source ${id}`) as number,
	});
}

function snapshotFeatureRequirements(value: unknown): Readonly<Record<string, unknown>> {
	const manifest = objectRecord(value, 'project.featureRequirements');
	const output = snapshotEnumerableDataRecord(manifest, 'project.featureRequirements');
	const requirements = snapshotArray(
		ownDataValue(manifest, 'requirements', 'project.featureRequirements'),
		'project.featureRequirements.requirements',
		(requirement, index) => snapshotRequirement(requirement, index),
		PROJECT_FEATURE_REQUIREMENTS_LIMITS.maximumRequirements,
	);
	defineData(output, 'requirements', requirements);
	return Object.freeze(output);
}

function snapshotRequirement(value: unknown, index: number): Readonly<Record<string, unknown>> {
	const label = `project.featureRequirements.requirements[${String(index)}]`;
	const requirement = objectRecord(value, label);
	const output = snapshotEnumerableDataRecord(requirement, label);
	const fallback = optionalOwnDataValue(requirement, 'fallback', label);
	if (fallback !== undefined) {
		defineData(output, 'fallback', fallback === null
			? null
			: Object.freeze(snapshotEnumerableDataRecord(objectRecord(fallback, `${label}.fallback`), `${label}.fallback`)));
	}
	return Object.freeze(output);
}

function snapshotEnumerableDataRecord(
	value: Record<PropertyKey, unknown>,
	label: string,
): Record<PropertyKey, unknown> {
	const output = Object.create(null) as Record<PropertyKey, unknown>;
	for (const key of Object.keys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !('value' in descriptor)) {
			throw new TypeError(`${label}.${key} must be an own data property.`);
		}
		defineData(output, key, descriptor.value);
	}
	return output;
}

function snapshotArray<Value>(
	value: unknown,
	label: string,
	snapshot: (item: unknown, index: number) => Value,
	maximumLength = Number.MAX_SAFE_INTEGER,
): readonly Value[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError(`${label} must be an ordinary array.`);
	}
	const lengthValue = ownDataValue(value as unknown as Record<PropertyKey, unknown>, 'length', label);
	if (!Number.isSafeInteger(lengthValue) || Number(lengthValue) < 0) {
		throw new RangeError(`${label} has an invalid length.`);
	}
	const length = Number(lengthValue);
	if (length > maximumLength) throw new RangeError(`${label} exceeds its maximum length.`);
	const output: Value[] = [];
	for (let index = 0; index < length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor || !('value' in descriptor)) {
			throw new TypeError(`${label}[${String(index)}] must be an own data property.`);
		}
		output.push(snapshot(descriptor.value, index));
	}
	return Object.freeze(output);
}

function objectRecord(value: unknown, label: string): Record<PropertyKey, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object.`);
	}
	return value as Record<PropertyKey, unknown>;
}

function ownDataValue(
	record: Record<PropertyKey, unknown>,
	key: PropertyKey,
	label: string,
): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor || !('value' in descriptor)) {
		throw new TypeError(`${label}.${String(key)} must be an own data property.`);
	}
	return descriptor.value;
}

function optionalOwnDataValue(
	record: Record<PropertyKey, unknown>,
	key: PropertyKey,
	label: string,
): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor) return undefined;
	if (!('value' in descriptor)) {
		throw new TypeError(`${label}.${String(key)} must be an own data property.`);
	}
	return descriptor.value;
}

function defineData(record: Record<PropertyKey, unknown>, key: PropertyKey, value: unknown): void {
	Object.defineProperty(record, key, {
		value,
		enumerable: true,
		configurable: true,
		writable: true,
	});
}

function cleanupPreservingAudioStore(
	store: Required<Pick<ProjectFallbackIntegrityStore, 'readSourceChunks'>>,
	capture: IteratorCleanupCapture,
): Required<Pick<ProjectFallbackIntegrityStore, 'readSourceChunks'>> {
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

function snapshotAdmissionState(
	captured: CapturedProjectFallbackIntegrity,
): CapturedProjectFallbackIntegrity {
	return Object.freeze({
		schemaVersion: captured.schemaVersion,
		claims: captured.claims,
		requirements: captured.requirements,
		sources: captured.sources,
	});
}

function createAdmission(
	verified: CapturedProjectFallbackIntegrity,
	verifiedVideo: Readonly<{
		selector: ProjectVideoFallbackIntegritySelector;
		blob: Blob;
	}> | null = null,
): ProjectFallbackIntegrityAdmission {
	return Object.freeze({
		assertCurrent(project: unknown): void {
			const current = snapshotAdmissionState(captureProjectFallbackIntegrity(project));
			if (!sameAdmissionState(verified, current)
				|| (verifiedVideo && !projectVideoFallbackSelectorMatches(
					current.requirements,
					verifiedVideo.selector,
				))) {
				throw new DOMException(
					'The rendered fallback integrity admission changed before activation.',
					'AbortError',
				);
			}
		},
		getVerifiedVideoBlob(selector: ProjectVideoFallbackIntegritySelector): Blob {
			if (!verifiedVideo) throw new Error('No selected video rendered fallback was verified.');
			const requested = snapshotProjectVideoFallbackSelector(selector);
			if (!sameProjectVideoFallbackSelector(requested, verifiedVideo.selector)) {
				throw new Error('The requested selector does not match the verified video rendered fallback.');
			}
			return verifiedVideo.blob;
		},
	});
}

function sameAdmissionState(
	left: CapturedProjectFallbackIntegrity,
	right: CapturedProjectFallbackIntegrity,
): boolean {
	if (left.schemaVersion !== right.schemaVersion
		|| left.claims.length !== right.claims.length
		|| left.sources.length !== right.sources.length) return false;
	for (let index = 0; index < left.claims.length; index += 1) {
		const first = left.claims[index];
		const second = right.claims[index];
		if (!first || !second || first.kind !== second.kind
			|| first.sourceId !== second.sourceId || first.sha256 !== second.sha256) return false;
	}
	for (let index = 0; index < left.sources.length; index += 1) {
		const first = left.sources[index];
		const second = right.sources[index];
		if (!first || !second || first.id !== second.id || first.kind !== second.kind
			|| first.storageKey !== second.storageKey || first.frameCount !== second.frameCount
			|| first.channelCount !== second.channelCount || first.chunkFrames !== second.chunkFrames) return false;
	}
	return true;
}
