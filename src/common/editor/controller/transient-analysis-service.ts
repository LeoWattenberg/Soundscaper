/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	type DetectPcmTransientsOptions,
	type TransientAnalysisChannelPolicy,
	type TransientAnalysisParameters,
	type TransientAnalysisResult,
} from '../transient-analysis.ts';
import { detectPcmTransientsInWorker } from '../transient-analysis-worker-client.ts';
import {
	createTransientAnalysisCacheRecord,
	inspectTransientAnalysisCacheRecord,
	transientAnalysisIdentity,
} from '../storage/transient-analysis-cache.ts';
import { isMediaContentSha256 } from '../storage/media-content-provenance.ts';
import type {
	EditorControllerLifetime,
	EditorProjectToken,
	EditorTaskScope,
} from './lifecycle.ts';

export interface TransientAnalysisControllerClip {
	readonly id: string;
	readonly kind?: 'audio' | 'video';
	readonly sourceId: string;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
}

export interface TransientAnalysisControllerSource {
	readonly id: string;
	readonly kind?: 'audio' | 'video';
	readonly storageKey?: string;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly chunkFrames: number;
	readonly sampleRate: number;
	readonly contentSha256?: unknown;
}

export interface TransientAnalysisControllerProject {
	readonly id: string;
	readonly clips: readonly TransientAnalysisControllerClip[];
	readonly sources: readonly TransientAnalysisControllerSource[];
}

export interface AnalyzeClipTransientsOptions {
	readonly channelPolicy?: TransientAnalysisChannelPolicy;
	readonly parameters?: Partial<TransientAnalysisParameters>;
}

export interface ClipTransientAnalysisOutcome {
	readonly clipId: string;
	readonly sourceId: string;
	readonly cacheKey: string;
	readonly cacheStatus: 'hit' | 'computed';
	readonly analysis: Readonly<TransientAnalysisResult>;
}

export interface TransientAnalysisServiceDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive' | 'startTask'>;
	getProject(): TransientAnalysisControllerProject;
	captureProject(): EditorProjectToken;
	assertProject(token: EditorProjectToken): void;
	loadAnalysis(key: string): Promise<unknown>;
	saveAnalysis(key: string, value: unknown): Promise<unknown>;
	deleteAnalysis(key: string): Promise<unknown>;
	resolveSourceSha256?(
		projectId: string,
		source: TransientAnalysisControllerSource,
		signal: AbortSignal,
	): PromiseLike<string> | string;
	readSourceRange(
		source: TransientAnalysisControllerSource,
		range: Readonly<{ startFrame: number; endFrame: number }>,
		signal: AbortSignal,
	): Promise<readonly Float32Array[]>;
	analyzeChannels?(
		channels: readonly Float32Array[],
		options: Readonly<DetectPcmTransientsOptions>,
		signal: AbortSignal,
	): PromiseLike<Readonly<TransientAnalysisResult>> | Readonly<TransientAnalysisResult>;
}

export interface TransientAnalysisService {
	analyzeClip(
		clipId: string,
		options?: Readonly<AnalyzeClipTransientsOptions>,
	): Promise<Readonly<ClipTransientAnalysisOutcome>>;
}

interface ClipAnalysisAuthority {
	readonly projectId: string;
	readonly clipId: string;
	readonly sourceId: string;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly sourceStorageKey: string;
	readonly sourceFrameCount: number;
	readonly sourceChannelCount: number;
	readonly sourceChunkFrames: number;
	readonly sourceSampleRate: number;
	readonly verifiedSourceSha256: string | null;
}

/**
 * Owns deterministic transient derivatives without letting asynchronous reads,
 * workers, or cache writes outlive the clip/source authority they describe.
 */
export function createTransientAnalysisService(
	dependencies: Readonly<TransientAnalysisServiceDependencies>,
): Readonly<TransientAnalysisService> {
	const analyzeChannels = dependencies.analyzeChannels
		?? ((channels: readonly Float32Array[], options: Readonly<DetectPcmTransientsOptions>, signal: AbortSignal) => (
			detectPcmTransientsInWorker(channels, options, { signal, pcmOwnership: 'transfer' })
		));
	return Object.freeze({ analyzeClip });

	async function analyzeClip(
		clipIdValue: string,
		options: Readonly<AnalyzeClipTransientsOptions> = {},
	): Promise<Readonly<ClipTransientAnalysisOutcome>> {
		dependencies.lifetime.assertActive();
		const clipId = requiredId(clipIdValue, 'An audio clip id is required for transient analysis.');
		const projectToken = dependencies.captureProject();
		const authority = captureAuthority(dependencies.getProject(), clipId);
		const task = dependencies.lifetime.startTask(`transient-analysis:${clipId}`);
		try {
			assertOwned(task, projectToken, authority);
			const sourceAtStart = findSource(dependencies.getProject(), authority.sourceId);
			if (!sourceAtStart) throw new Error(`Audio source ${authority.sourceId} was not found.`);
			const sourceSha256 = authority.verifiedSourceSha256
				?? await resolveSourceSha256(authority, sourceAtStart, task.signal);
			assertOwned(task, projectToken, authority);
			const identity = transientAnalysisIdentity({
				sourceSha256,
				sourceRange: {
					startFrame: authority.sourceStartFrame,
					endFrame: authority.sourceEndFrame,
				},
				channelPolicy: options.channelPolicy,
				parameters: options.parameters,
			});
			const cached = await dependencies.loadAnalysis(identity.key);
			assertOwned(task, projectToken, authority);
			const inspection = inspectTransientAnalysisCacheRecord(cached, identity);
			if (inspection.analysis) {
				return outcome(authority, identity.key, 'hit', inspection.analysis);
			}
			if (inspection.discard) {
				await dependencies.deleteAnalysis(identity.key);
				assertOwned(task, projectToken, authority);
			}
			const source = findSource(dependencies.getProject(), authority.sourceId);
			if (!source) throw new Error(`Audio source ${authority.sourceId} was not found.`);
			const channels = await dependencies.readSourceRange(source, identity.sourceRange, task.signal);
			assertOwned(task, projectToken, authority);
			validateReadChannels(channels, authority.sourceEndFrame - authority.sourceStartFrame);
			const analysis = await analyzeChannels(channels, {
				sourceStartFrame: authority.sourceStartFrame,
				channelPolicy: identity.channelPolicy,
				parameters: identity.parameters,
			}, task.signal);
			assertOwned(task, projectToken, authority);
			const record = createTransientAnalysisCacheRecord(identity, analysis);
			await dependencies.saveAnalysis(identity.key, record);
			assertOwned(task, projectToken, authority);
			return outcome(authority, identity.key, 'computed', analysisFromRecord(record));
		} finally {
			task.finish();
		}
	}

	async function resolveSourceSha256(
		authority: Readonly<ClipAnalysisAuthority>,
		source: TransientAnalysisControllerSource,
		signal: AbortSignal,
	): Promise<string> {
		if (!dependencies.resolveSourceSha256) {
			throw new Error(`Audio source ${source.id} requires a verified source SHA-256 digest.`);
		}
		const digest = await dependencies.resolveSourceSha256(authority.projectId, source, signal);
		if (!isMediaContentSha256(digest)) {
			throw new Error(`Audio source ${source.id} requires a verified source SHA-256 digest.`);
		}
		return digest;
	}

	function assertOwned(
		task: EditorTaskScope,
		projectToken: EditorProjectToken,
		authority: Readonly<ClipAnalysisAuthority>,
	): void {
		task.assertCurrent();
		dependencies.assertProject(projectToken);
		const current = captureAuthority(dependencies.getProject(), authority.clipId);
		if (!sameAuthority(current, authority)) {
			throw new Error(`Audio clip ${authority.clipId} changed before transient analysis completed.`);
		}
	}
}

function captureAuthority(
	project: Readonly<TransientAnalysisControllerProject>,
	clipId: string,
): Readonly<ClipAnalysisAuthority> {
	const clip = project.clips.find((candidate) => candidate.id === clipId && candidate.kind !== 'video');
	if (!clip) throw new Error(`Audio clip ${clipId} was not found.`);
	const source = findSource(project, clip.sourceId);
	if (!source) throw new Error(`Audio source ${clip.sourceId} was not found.`);
	const sourceStartFrame = nonNegativeSafeInteger(clip.sourceStartFrame, 'clip source start frame');
	const sourceDurationFrames = positiveSafeInteger(clip.sourceDurationFrames, 'clip source duration frames');
	const sourceEndFrame = safeAdd(sourceStartFrame, sourceDurationFrames, 'clip source range');
	const frameCount = nonNegativeSafeInteger(source.frameCount, 'source frame count');
	if (sourceEndFrame > frameCount) throw new RangeError('The clip source range exceeds its source media.');
	const sourceStorageKey = requiredId(
		source.storageKey ?? source.id,
		'A source storage key is required for transient analysis.',
	);
	return Object.freeze({
		projectId: requiredId(project.id, 'A project id is required for transient analysis.'),
		clipId,
		sourceId: source.id,
		sourceStartFrame,
		sourceEndFrame,
		sourceStorageKey,
		sourceFrameCount: frameCount,
		sourceChannelCount: positiveSafeInteger(source.channelCount, 'source channel count'),
		sourceChunkFrames: positiveSafeInteger(source.chunkFrames, 'source chunk frames'),
		sourceSampleRate: positiveSafeInteger(source.sampleRate, 'source sample rate'),
		verifiedSourceSha256: isMediaContentSha256(source.contentSha256)
			? source.contentSha256
			: null,
	});
}

function findSource(
	project: Readonly<TransientAnalysisControllerProject>,
	sourceId: string,
): TransientAnalysisControllerSource | null {
	return project.sources.find((candidate) => candidate.id === sourceId) ?? null;
}

function sameAuthority(
	left: Readonly<ClipAnalysisAuthority>,
	right: Readonly<ClipAnalysisAuthority>,
): boolean {
	return left.projectId === right.projectId
		&& left.clipId === right.clipId
		&& left.sourceId === right.sourceId
		&& left.sourceStartFrame === right.sourceStartFrame
		&& left.sourceEndFrame === right.sourceEndFrame
		&& left.sourceStorageKey === right.sourceStorageKey
		&& left.sourceFrameCount === right.sourceFrameCount
		&& left.sourceChannelCount === right.sourceChannelCount
		&& left.sourceChunkFrames === right.sourceChunkFrames
		&& left.sourceSampleRate === right.sourceSampleRate
		&& left.verifiedSourceSha256 === right.verifiedSourceSha256;
}

function validateReadChannels(channels: readonly Float32Array[], expectedFrames: number): void {
	if (!Array.isArray(channels) || channels.length < 1
		|| channels.some((channel) => !(channel instanceof Float32Array) || channel.length !== expectedFrames)) {
		throw new Error('Transient analysis PCM did not match the requested source range.');
	}
}

function analysisFromRecord(
	record: ReturnType<typeof createTransientAnalysisCacheRecord>,
): Readonly<TransientAnalysisResult> {
	return Object.freeze({
		algorithmId: record.algorithmId,
		algorithmRevision: record.algorithmRevision,
		channelPolicy: record.channelPolicy,
		parameters: record.parameters,
		sourceRange: record.sourceRange,
		transients: record.transients,
	});
}

function outcome(
	authority: Readonly<ClipAnalysisAuthority>,
	cacheKey: string,
	cacheStatus: 'hit' | 'computed',
	analysis: Readonly<TransientAnalysisResult>,
): Readonly<ClipTransientAnalysisOutcome> {
	return Object.freeze({
		clipId: authority.clipId,
		sourceId: authority.sourceId,
		cacheKey,
		cacheStatus,
		analysis,
	});
}

function requiredId(value: unknown, message: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.trim() !== value) throw new TypeError(message);
	return value;
}

function nonNegativeSafeInteger(value: unknown, field: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${field} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function positiveSafeInteger(value: unknown, field: string): number {
	const normalized = nonNegativeSafeInteger(value, field);
	if (normalized < 1) throw new RangeError(`${field} must be positive.`);
	return normalized;
}

function safeAdd(left: number, right: number, field: string): number {
	if (right > Number.MAX_SAFE_INTEGER - left) throw new RangeError(`${field} exceeds the safe integer range.`);
	return left + right;
}
