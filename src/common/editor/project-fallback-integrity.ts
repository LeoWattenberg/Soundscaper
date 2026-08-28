/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createScapeAudioExportChunkBudget,
	scapeAudioSourceLayout,
} from './scape-archive-media.ts';
import {
	awaitScapeOperation,
	awaitScapeReadOperation,
	throwIfScapeAborted,
} from './scape-abort.ts';
import { SCAPE_ARCHIVE_LIMITS } from './scape-archive-envelope.ts';
import type { ScapeProjectFallbackClaim } from './scape-project-assets.ts';
import {
	PROJECT_AUDIO_FALLBACK_INTEGRITY_ERROR_CODE,
	isProjectAudioFallbackIntegrityError,
	projectAudioFallbackSelectorMatches,
	sameProjectAudioFallbackSelector,
	selectProjectAudioFallbackTarget,
	snapshotProjectAudioFallbackSelector,
	verifyProjectAudioFallback,
	verifySelectedProjectAudioFallback,
	type ProjectAudioFallbackChunkProvider,
	type ProjectAudioFallbackIntegritySelector,
} from './project-fallback-integrity-audio.ts';
export {
	PROJECT_AUDIO_FALLBACK_INTEGRITY_ERROR_CODE,
	isProjectAudioFallbackIntegrityError,
};
export type {
	ProjectAudioFallbackChunkProvider,
	ProjectAudioFallbackIntegritySelector,
};
import {
	projectVideoFallbackSelectorMatches,
	sameProjectVideoFallbackSelector,
	selectProjectVideoFallbackTarget,
	snapshotProjectVideoFallbackSelector,
	type ProjectVideoFallbackIntegritySelector,
} from './project-fallback-integrity-video.ts';
export type { ProjectVideoFallbackIntegritySelector } from './project-fallback-integrity-video.ts';
import {
	captureProjectFallbackIntegrity,
	sameCapturedProjectFallbackIntegrity,
	type CapturedProjectFallbackIntegrity,
	type ProjectFallbackIntegritySource,
} from './project-fallback-integrity-snapshot.ts';
import {
	isMaintainedRenderedFallbackProjectSchema,
	isBaselineRenderedFallbackProject,
} from './project-schema-version.ts';
import {
	canonicalMediaContentBlob,
	digestMediaContent,
} from './storage/media-content-digest.ts';

type ProjectFallbackSource = ProjectFallbackIntegritySource;

interface StoredSourceChunk {
	readonly index?: unknown;
	readonly frames?: unknown;
	readonly channels?: readonly Float32Array[];
}

export interface ProjectFallbackIntegrityStore {
	readSourceChunks?(
		sourceId: string,
		options?: Readonly<{
			signal?: AbortSignal;
		}>,
	): AsyncIterable<readonly Float32Array[] | StoredSourceChunk>;
	readSourceChunk?(
		sourceId: string,
		chunkIndex: number,
		options?: Readonly<{
			signal?: AbortSignal;
		}>,
	): PromiseLike<unknown> | unknown;
	loadMediaAsset?(
		sourceId: string,
		options?: Readonly<{
			signal?: AbortSignal;
		}>,
	): PromiseLike<unknown> | unknown;
	getMediaAssetMetadata?(sourceId: string): PromiseLike<unknown> | unknown;
}

export interface ProjectFallbackIntegrityOptions {
	readonly signal?: AbortSignal;
	readonly assertCurrent?: () => void;
	readonly audioFallback?: ProjectAudioFallbackIntegritySelector;
	readonly videoFallback?: ProjectVideoFallbackIntegritySelector;
}

interface VerificationTarget {
	readonly claim: ScapeProjectFallbackClaim;
	readonly source: ProjectFallbackSource;
}

interface VerificationPlan extends VerificationTarget {
	readonly expectedBytes: number;
}

export interface ProjectFallbackIntegrityAdmission {
	assertCurrent(project: unknown): void;
	getVerifiedAudioChunkProvider(selector: ProjectAudioFallbackIntegritySelector): ProjectAudioFallbackChunkProvider;
	getVerifiedVideoBlob(selector: ProjectVideoFallbackIntegritySelector): Blob;
}

/**
 * Verifies exact-current rendered fallbacks against their canonical stored
 * bytes before controller activation. Future schemas are intentionally opaque.
 */
export async function verifyProjectFallbackIntegrity(
	project: unknown,
	store: ProjectFallbackIntegrityStore,
	options: ProjectFallbackIntegrityOptions = {},
): Promise<ProjectFallbackIntegrityAdmission> {
	const signal = options.signal;
	throwIfScapeAborted(signal);
	const audioSelector = options.audioFallback === undefined
		? null
		: snapshotProjectAudioFallbackSelector(options.audioFallback);
	const videoSelector = options.videoFallback === undefined
		? null
		: snapshotProjectVideoFallbackSelector(options.videoFallback);
	if (options.assertCurrent !== undefined && typeof options.assertCurrent !== 'function') {
		throw new TypeError('Fallback integrity currentness must be a function.');
	}
	const captured = captureProjectFallbackIntegrity(project);
	if (audioSelector && !isBaselineRenderedFallbackProject(captured)
		&& !isMaintainedRenderedFallbackProjectSchema(captured)) {
		throw new Error('A selected audio rendered fallback requires the exact current project schema.');
	}
	if (videoSelector && !isBaselineRenderedFallbackProject(captured)
		&& !isMaintainedRenderedFallbackProjectSchema(captured)) {
		throw new Error('A selected video rendered fallback requires the exact current project schema.');
	}
	const admissionState = snapshotAdmissionState(captured);
	if (!captured.claims.length && !audioSelector && !videoSelector) return createAdmission(admissionState);
	const targetValues: VerificationTarget[] = [];
	if (audioSelector) {
		targetValues.push(selectProjectAudioFallbackTarget(
			captured.requirements,
			captured.sources,
			audioSelector,
		));
	}
	if (videoSelector) {
		targetValues.push(selectProjectVideoFallbackTarget(
			captured.requirements,
			captured.sources,
			videoSelector,
		));
	}
	if (!audioSelector && !videoSelector) {
		const sourcesById = new Map(captured.sources.map((source) => [source.id, source]));
		const targets = new Map<string, VerificationTarget>();
		for (const claim of captured.claims) {
			const existing = targets.get(claim.sourceId);
			if (existing) {
				if (!sameFallbackClaim(existing.claim, claim)) {
					throw new Error(
						`Rendered fallback source ${claim.sourceId} has conflicting SHA-256 or relationship claims.`,
					);
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
	let verifiedAudioProvider: ProjectAudioFallbackChunkProvider | null = null;
	let verifiedVideoBlob: Blob | null = null;
	for (const plan of plans) {
		throwIfScapeAborted(signal);
		if (plan.claim.kind === 'audio') {
			if (audioSelector) {
				const assertFullCurrent = (): void => {
					options.assertCurrent?.();
					assertAdmissionCurrent(admissionState, project, audioSelector, videoSelector);
				};
				verifiedAudioProvider = await verifySelectedProjectAudioFallback(
					plan,
					store as Required<Pick<ProjectFallbackIntegrityStore, 'readSourceChunks'>>,
					audioChunkBudget,
					{
						signal,
						assertCurrent: assertFullCurrent,
						assertProviderCurrent: assertFullCurrent,
					},
				);
			} else {
				await verifyProjectAudioFallback(
					plan,
					store as Required<Pick<ProjectFallbackIntegrityStore, 'readSourceChunks'>>,
					audioChunkBudget,
					signal,
				);
			}
		} else {
			const blob = await verifyVideoFallback(plan, store, signal);
			if (videoSelector) verifiedVideoBlob = blob;
		}
	}
	return createAdmission(admissionState, audioSelector && verifiedAudioProvider
		? Object.freeze({ selector: audioSelector, provider: verifiedAudioProvider })
		: null, videoSelector && verifiedVideoBlob
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
			throw new RangeError('Rendered fallbacks exceed the cumulative Scape expanded-byte limit.');
		}
		admittedBytes += expectedBytes;
		plans.push(Object.freeze({ ...target, expectedBytes }));
	}
	return Object.freeze(plans);
}

async function verifyVideoFallback(
	target: VerificationPlan,
	store: ProjectFallbackIntegrityStore,
	signal?: AbortSignal,
): Promise<Blob> {
	const storageKey = sourceStorageKey(target.source);
	const loaded = await awaitScapeOperation(store.loadMediaAsset?.(storageKey, { signal }), signal);
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

function assertDigest(claim: ScapeProjectFallbackClaim, digest: string): void {
	if (digest !== claim.sha256) {
		throw new Error(`Rendered fallback source ${claim.sourceId} failed SHA-256 verification.`);
	}
}

function sameFallbackClaim(
	left: ScapeProjectFallbackClaim,
	right: ScapeProjectFallbackClaim,
): boolean {
	return left.role === right.role && left.kind === right.kind
		&& left.sourceId === right.sourceId && left.sha256 === right.sha256
		&& fallbackClaimTarget(left) === fallbackClaimTarget(right);
}

function fallbackClaimTarget(claim: ScapeProjectFallbackClaim): string | null {
	if (claim.role === 'video-clip-render-v1') return claim.targetClipId;
	if (claim.role === 'audio-track-render-v1') return claim.targetTrackId;
	return null;
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

function snapshotAdmissionState(
	captured: CapturedProjectFallbackIntegrity,
): CapturedProjectFallbackIntegrity {
	return Object.freeze({
		schemaFamily: captured.schemaFamily,
		schemaVersion: captured.schemaVersion,
		sampleRate: captured.sampleRate,
		primarySequenceId: captured.primarySequenceId,
		sequences: captured.sequences,
		claims: captured.claims,
		requirements: captured.requirements,
		sources: captured.sources,
		clips: captured.clips,
		tracks: captured.tracks,
		automationLanes: captured.automationLanes,
	});
}

function createAdmission(
	verified: CapturedProjectFallbackIntegrity,
	verifiedAudio: Readonly<{
		selector: ProjectAudioFallbackIntegritySelector;
		provider: ProjectAudioFallbackChunkProvider;
	}> | null = null,
	verifiedVideo: Readonly<{
		selector: ProjectVideoFallbackIntegritySelector;
		blob: Blob;
	}> | null = null,
): ProjectFallbackIntegrityAdmission {
	return Object.freeze({
		assertCurrent(project: unknown): void {
			assertAdmissionCurrent(verified, project, verifiedAudio?.selector ?? null, verifiedVideo?.selector ?? null);
		},
		getVerifiedAudioChunkProvider(selector: ProjectAudioFallbackIntegritySelector): ProjectAudioFallbackChunkProvider {
			if (!verifiedAudio) throw new Error('No selected audio rendered fallback was verified.');
			const requested = snapshotProjectAudioFallbackSelector(selector);
			if (!sameProjectAudioFallbackSelector(requested, verifiedAudio.selector)) {
				throw new Error('The requested selector does not match the verified audio rendered fallback.');
			}
			return verifiedAudio.provider;
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

function assertAdmissionCurrent(
	verified: CapturedProjectFallbackIntegrity,
	project: unknown,
	audioSelector: ProjectAudioFallbackIntegritySelector | null = null,
	videoSelector: ProjectVideoFallbackIntegritySelector | null = null,
): void {
	let current: CapturedProjectFallbackIntegrity;
	try {
		current = snapshotAdmissionState(captureProjectFallbackIntegrity(project));
	} catch {
		throw admissionChangedError();
	}
	if (!sameCapturedProjectFallbackIntegrity(verified, current)
		|| (audioSelector && !projectAudioFallbackSelectorMatches(
			current.requirements,
			current.sources,
			audioSelector,
		))
		|| (videoSelector && !projectVideoFallbackSelectorMatches(
			current.requirements,
			current.sources,
			videoSelector,
		))) {
		throw admissionChangedError();
	}
}

function admissionChangedError(): DOMException {
	return new DOMException(
		'The rendered fallback integrity admission changed before activation.',
		'AbortError',
	);
}
