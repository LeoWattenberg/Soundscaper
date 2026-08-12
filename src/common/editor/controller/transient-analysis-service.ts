/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	detectPcmTransients,
	type DetectPcmTransientsOptions,
	type TransientAnalysisChannelPolicy,
	type TransientAnalysisParameters,
	type TransientAnalysisResult,
} from '../transient-analysis.ts';
import {
	createTransientAnalysisCacheRecord,
	inspectTransientAnalysisCacheRecord,
	transientAnalysisIdentity,
} from '../storage/transient-analysis-cache.ts';
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
	readonly frameCount: number;
	readonly contentSha256?: string;
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
	readonly sourceSha256: string;
}

/**
 * Owns deterministic transient derivatives without letting asynchronous reads,
 * workers, or cache writes outlive the clip/source authority they describe.
 */
export function createTransientAnalysisService(
	dependencies: Readonly<TransientAnalysisServiceDependencies>,
): Readonly<TransientAnalysisService> {
	const analyzeChannels = dependencies.analyzeChannels
		?? ((channels: readonly Float32Array[], options: Readonly<DetectPcmTransientsOptions>) => (
			detectPcmTransients(channels, options)
		));
	return Object.freeze({ analyzeClip });

	async function analyzeClip(
		clipIdValue: string,
		options: Readonly<AnalyzeClipTransientsOptions> = {},
	): Promise<Readonly<ClipTransientAnalysisOutcome>> {
		dependencies.lifetime.assertActive();
		const clipId = requiredId(clipIdValue, 'An audio clip id is required for transient analysis.');
		const authority = captureAuthority(dependencies.getProject(), clipId);
		const identity = transientAnalysisIdentity({
			sourceSha256: authority.sourceSha256,
			sourceRange: {
				startFrame: authority.sourceStartFrame,
				endFrame: authority.sourceEndFrame,
			},
			channelPolicy: options.channelPolicy,
			parameters: options.parameters,
		});
		const projectToken = dependencies.captureProject();
		const task = dependencies.lifetime.startTask(`transient-analysis:${clipId}`);
		try {
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
	if (!/^[a-f0-9]{64}$/u.test(source.contentSha256 ?? '')) {
		throw new Error(`Audio source ${source.id} requires a verified source SHA-256 digest.`);
	}
	return Object.freeze({
		projectId: requiredId(project.id, 'A project id is required for transient analysis.'),
		clipId,
		sourceId: source.id,
		sourceStartFrame,
		sourceEndFrame,
		sourceSha256: source.contentSha256!,
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
		&& left.sourceSha256 === right.sourceSha256;
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
