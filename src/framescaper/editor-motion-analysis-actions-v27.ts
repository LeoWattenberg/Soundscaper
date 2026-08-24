/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	normalizeVideoMotionAnalysisReferenceV1,
	normalizeVideoProcessorStackV1,
	requireFreshVideoMotionAnalysisV1,
	type VideoMotionAnalysisReferenceV1,
	type VideoProcessorStackV1,
} from '../common/editor/video-motion-model-v27.ts';
import type {
	VideoMotionAnalysisProgressV1,
	VideoMotionAnalysisResultV1,
} from '../common/editor/video-motion-analysis-v27.ts';
import type { GrayVideoFrameV1 } from '../common/editor/video-motion-processing-v27.ts';
import {
	snapshotFramescaperOwnedFinishingCommandV27,
} from './editor-project-v27-finishing-command.ts';

export type FramescaperMotionAnalysisPhaseV27 = 'decoding' | 'tracking' | 'publishing' | 'complete';

export interface FramescaperMotionAnalysisProgressV27 {
	readonly phase: FramescaperMotionAnalysisPhaseV27;
	readonly completed: number;
	readonly total: number;
}

export interface FramescaperMotionAnalysisTargetV27 {
	readonly stackId: string;
	readonly sourceId: string;
	readonly sourceName: string;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly analysisId: string;
	readonly freshness: 'missing' | 'current' | 'stale';
}

export interface FramescaperMotionAnalysisFrameRequestV27 {
	readonly projectId: string;
	readonly source: Readonly<Record<string, unknown>>;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly signal?: AbortSignal;
	readonly onProgress: (progress: FramescaperMotionAnalysisProgressV27) => void;
}

export type FramescaperMotionAnalysisFrameProviderV27 = (
	request: FramescaperMotionAnalysisFrameRequestV27,
) => PromiseLike<readonly Readonly<{
	readonly frameNumber: number;
	readonly frame: GrayVideoFrameV1;
}>[]> | readonly Readonly<{
	readonly frameNumber: number;
	readonly frame: GrayVideoFrameV1;
}>[];

interface MotionAnalysisOwnerV27 {
	readonly project: unknown;
	readonly actions: Readonly<{
		readonly edit: Readonly<{ commit(command: unknown): PromiseLike<unknown> | unknown }>;
	}>;
}

interface MotionAnalysisStoreV27 {
	getMediaAssetMetadata(key: string): PromiseLike<Readonly<Record<string, unknown>> | null>;
	beginMediaAssetWrite(
		key: string,
		metadata: Readonly<Record<string, unknown>>,
		options: Readonly<{
			readonly expectedBytes: number;
			readonly expectedSha256: string;
			readonly signal?: AbortSignal;
		}>,
	): PromiseLike<MotionAnalysisWriterV27>;
}

interface MotionAnalysisWriterV27 {
	readonly maximumChunkBytes: number;
	readonly bytesWritten: number;
	write(
		bytes: Uint8Array,
		options?: Readonly<{ readonly signal?: AbortSignal }>,
	): PromiseLike<void>;
	commitOwned(options?: Readonly<{ readonly signal?: AbortSignal }>): PromiseLike<MotionAnalysisPublicationV27>;
	abort(): PromiseLike<void>;
}

interface MotionAnalysisPublicationV27 {
	readonly metadata: Readonly<Record<string, unknown>>;
	discardIfCurrent(): PromiseLike<boolean>;
}

export interface FramescaperMotionAnalysisActionsV27 {
	targets(): readonly FramescaperMotionAnalysisTargetV27[];
	analyze(request: Readonly<{
		readonly processorStackId: string;
		readonly startFrame: number;
		readonly endFrame: number;
		readonly signal?: AbortSignal;
		readonly onProgress?: (progress: FramescaperMotionAnalysisProgressV27) => void;
	}>): Promise<VideoMotionAnalysisReferenceV1>;
}

const MAXIMUM_ANALYSIS_FRAMES = 4_096;
const RUNTIMES = new WeakMap<object, FramescaperMotionAnalysisActionsV27>();

export function createFramescaperMotionAnalysisActionsV27(options: Readonly<{
	readonly owner: MotionAnalysisOwnerV27;
	readonly store: MotionAnalysisStoreV27;
	readonly frameProvider: FramescaperMotionAnalysisFrameProviderV27;
}>): FramescaperMotionAnalysisActionsV27 {
	if (!options.owner || typeof options.owner !== 'object'
		|| typeof options.owner.actions?.edit?.commit !== 'function') {
		throw new TypeError('Selected V27 motion analysis requires a controller owner.');
	}
	if (!options.store || typeof options.store.getMediaAssetMetadata !== 'function'
		|| typeof options.store.beginMediaAssetWrite !== 'function') {
		throw new TypeError('Selected V27 motion analysis requires an exact asset store.');
	}
	if (typeof options.frameProvider !== 'function') {
		throw new TypeError('Selected V27 motion analysis requires a frame provider.');
	}
	let active = false;
	const runtime: FramescaperMotionAnalysisActionsV27 = Object.freeze({
		targets: () => targets(options.owner.project),
		analyze: async (request: Parameters<FramescaperMotionAnalysisActionsV27['analyze']>[0]) => {
			if (active) throw new Error('A selected V27 motion analysis is already running.');
			active = true;
			try {
				return await executeAnalysis(options, request);
			} finally {
				active = false;
			}
		},
	});
	return runtime;
}

export function bindFramescaperMotionAnalysisActionsV27(
	owner: object,
	runtime: FramescaperMotionAnalysisActionsV27,
): void {
	if (!owner || typeof owner !== 'object') throw new TypeError('A V27 motion-analysis owner is required.');
	RUNTIMES.set(owner, runtime);
}

export function framescaperMotionAnalysisActionsV27For(
	owner: unknown,
): FramescaperMotionAnalysisActionsV27 | null {
	return owner && (typeof owner === 'object' || typeof owner === 'function')
		? RUNTIMES.get(owner as object) ?? null : null;
}

async function executeAnalysis(
	options: Readonly<{
		readonly owner: MotionAnalysisOwnerV27;
		readonly store: MotionAnalysisStoreV27;
		readonly frameProvider: FramescaperMotionAnalysisFrameProviderV27;
	}>,
	request: Readonly<{
		readonly processorStackId: string;
		readonly startFrame: number;
		readonly endFrame: number;
		readonly signal?: AbortSignal;
		readonly onProgress?: (progress: FramescaperMotionAnalysisProgressV27) => void;
	}>,
): Promise<VideoMotionAnalysisReferenceV1> {
	throwIfAborted(request.signal);
	const initial = projectRecord(options.owner.project);
	const stack = stackById(initial, request.processorStackId);
	const source = sourceById(initial, stack.sourceId);
	const range = analysisRange(request.startFrame, request.endFrame, source);
	const existing = analysisForStack(initial, stack);
	const analysisId = existing?.id ?? `analysis:${stack.id}`;
	const onProgress = (value: FramescaperMotionAnalysisProgressV27): void => {
		try { request.onProgress?.(Object.freeze({ ...value })); }
		catch { /* Progress observers cannot own analysis or publication. */ }
	};
	onProgress({ phase: 'decoding', completed: 0, total: range.endFrame - range.startFrame });
	const frames = await options.frameProvider({
		projectId: stableId(initial.id, 'V27 project ID'), source,
		...range,
		...(request.signal ? { signal: request.signal } : {}),
		onProgress,
	});
	throwIfAborted(request.signal);
	assertCurrent(options.owner.project, source, stack, existing);
	const analysisModule = await import('../common/editor/video-motion-analysis-v27.ts');
	const result = await analysisModule.analyzeVideoMotionV1({
		analysisId,
		inputSha256: digest(source.contentSha256, 'V27 motion-analysis source digest'),
		processorStack: stack,
		frames,
		...(request.signal ? { signal: request.signal } : {}),
		onProgress: (value: VideoMotionAnalysisProgressV1) => {
			onProgress({ phase: value.phase, completed: value.completed, total: value.total });
		},
	});
	throwIfAborted(request.signal);
	assertCurrent(options.owner.project, source, stack, existing);
	return publishAnalysis(options, result, existing, source, stack, request.signal, onProgress);
}

async function publishAnalysis(
	options: Readonly<{ readonly owner: MotionAnalysisOwnerV27; readonly store: MotionAnalysisStoreV27 }>,
	result: VideoMotionAnalysisResultV1,
	existing: VideoMotionAnalysisReferenceV1 | null,
	expectedSource: Readonly<Record<string, unknown>>,
	expectedStack: VideoProcessorStackV1,
	signal: AbortSignal | undefined,
	onProgress: (progress: FramescaperMotionAnalysisProgressV27) => void,
): Promise<VideoMotionAnalysisReferenceV1> {
	onProgress({ phase: 'publishing', completed: 0, total: 1 });
	const priorBody = await options.store.getMediaAssetMetadata(result.reference.storageKey);
	throwIfAborted(signal);
	let created: MotionAnalysisPublicationV27 | null = null;
	if (priorBody === null) {
		created = await writeAnalysisBody(options.store, result, signal);
	} else {
		assertExistingBody(priorBody, result.reference);
	}
	try {
		throwIfAborted(signal);
		assertCurrent(options.owner.project, expectedSource, expectedStack, existing);
		if (JSON.stringify(existing) === JSON.stringify(result.reference)) {
			onProgress({ phase: 'complete', completed: 1, total: 1 });
			return result.reference;
		}
		const command = snapshotFramescaperOwnedFinishingCommandV27({
			type: 'video-motion-analysis/set',
			motionAnalysisId: result.reference.id,
			expectedMotionAnalysis: existing,
			motionAnalysis: result.reference,
		});
		await options.owner.actions.edit.commit(command);
		onProgress({ phase: 'complete', completed: 1, total: 1 });
		return result.reference;
	} catch (error) {
		if (created) {
			try { await created.discardIfCurrent(); }
			catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					'Motion-analysis publication and body rollback both failed.',
					{ cause: error },
				);
			}
		}
		throw error;
	}
}

async function writeAnalysisBody(
	store: MotionAnalysisStoreV27,
	result: VideoMotionAnalysisResultV1,
	signal: AbortSignal | undefined,
): Promise<MotionAnalysisPublicationV27> {
	const options = signal ? { signal } : {};
	const writer = await store.beginMediaAssetWrite(
		result.reference.storageKey,
		{
			name: `${result.reference.id}.motion.json`,
			mimeType: 'application/vnd.framescaper.motion-analysis+json',
			sha256: result.reference.sha256,
		},
		{
			expectedBytes: result.reference.byteLength,
			expectedSha256: result.reference.sha256,
			...(signal ? { signal } : {}),
		},
	);
	let publication: MotionAnalysisPublicationV27 | null = null;
	try {
		const maximumChunkBytes = positiveInteger(
			writer.maximumChunkBytes,
			'Motion-analysis storage chunk limit',
		);
		if (writer.bytesWritten !== 0) throw new Error('A new motion-analysis writer is not empty.');
		for (let offset = 0; offset < result.bytes.byteLength; offset += maximumChunkBytes) {
			throwIfAborted(signal);
			await writer.write(result.bytes.subarray(offset, offset + maximumChunkBytes), options);
		}
		throwIfAborted(signal);
		publication = await writer.commitOwned(options);
		assertExistingBody(publication.metadata, result.reference);
		return publication;
	} catch (error) {
		try {
			if (publication) await publication.discardIfCurrent();
			else await writer.abort();
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				'Motion-analysis body staging and cleanup both failed.',
				{ cause: error },
			);
		}
		throw error;
	}
}

function targets(value: unknown): readonly FramescaperMotionAnalysisTargetV27[] {
	const project = projectRecord(value);
	const sources = records(project.sources, 'V27 motion-analysis sources');
	const analyses = records(project.videoMotionAnalyses, 'V27 motion analyses')
		.map(normalizeVideoMotionAnalysisReferenceV1);
	return Object.freeze(records(project.videoProcessorStacks, 'V27 processor stacks').flatMap((value) => {
		let stack: VideoProcessorStackV1;
		try { stack = normalizeVideoProcessorStackV1(value); } catch { return []; }
		if (stack.processors.filter(({ kind, enabled }) => kind === 'tracking' && enabled).length !== 1) return [];
		const source = sources.find(({ id }) => id === stack.sourceId);
		if (!source || source.kind !== 'video') return [];
		const sourceEndFrame = positiveInteger(source.sourceFrameCount, 'V27 video source frame count');
		const endFrame = Math.min(sourceEndFrame, MAXIMUM_ANALYSIS_FRAMES);
		const existing = analyses.find((analysis) => (
			analysis.sourceId === stack.sourceId && analysis.processorStackId === stack.id
		)) ?? null;
		return [Object.freeze({
			stackId: stack.id,
			sourceId: stack.sourceId,
			sourceName: typeof source.name === 'string' && source.name ? source.name : stack.sourceId,
			startFrame: 0,
			endFrame,
			analysisId: existing?.id ?? `analysis:${stack.id}`,
			freshness: analysisFreshness(existing, source, stack),
		})];
	}));
}

function analysisFreshness(
	analysis: VideoMotionAnalysisReferenceV1 | null,
	source: Readonly<Record<string, unknown>>,
	stack: VideoProcessorStackV1,
): 'missing' | 'current' | 'stale' {
	if (analysis === null) return 'missing';
	try {
		requireFreshVideoMotionAnalysisV1(analysis, {
			sourceId: stack.sourceId,
			processorStackId: stack.id,
			inputSha256: digest(source.contentSha256, 'V27 motion-analysis source digest'),
			settingsSha256: settingsDigest(stack),
		});
		return 'current';
	} catch { return 'stale'; }
}

function assertCurrent(
	projectValue: unknown,
	source: Readonly<Record<string, unknown>>,
	stack: VideoProcessorStackV1,
	expectedAnalysis: VideoMotionAnalysisReferenceV1 | null,
): void {
	const project = projectRecord(projectValue);
	const currentSource = sourceById(project, stack.sourceId);
	const currentStack = stackById(project, stack.id);
	const currentAnalysis = analysisForStack(project, stack);
	if (digest(currentSource.contentSha256, 'V27 motion-analysis source digest')
		!== digest(source.contentSha256, 'V27 motion-analysis source digest')
		|| JSON.stringify(currentStack) !== JSON.stringify(stack)
		|| JSON.stringify(currentAnalysis) !== JSON.stringify(expectedAnalysis)) {
		throw new Error('The selected V27 motion-analysis source, settings, or reference changed before publication.');
	}
}

function analysisForStack(
	project: Readonly<Record<string, unknown>>,
	stack: VideoProcessorStackV1,
): VideoMotionAnalysisReferenceV1 | null {
	const matches = records(project.videoMotionAnalyses, 'V27 motion analyses')
		.map(normalizeVideoMotionAnalysisReferenceV1)
		.filter((analysis) => analysis.sourceId === stack.sourceId && analysis.processorStackId === stack.id);
	if (matches.length > 1) throw new Error('A V27 processor stack has multiple motion analyses.');
	return matches[0] ?? null;
}

function stackById(project: Readonly<Record<string, unknown>>, stackId: string): VideoProcessorStackV1 {
	const id = stableId(stackId, 'V27 processor stack ID');
	const value = records(project.videoProcessorStacks, 'V27 processor stacks').find((item) => item.id === id);
	if (!value) throw new ReferenceError(`V27 processor stack ${id} is unavailable.`);
	return normalizeVideoProcessorStackV1(value);
}

function sourceById(
	project: Readonly<Record<string, unknown>>,
	sourceId: string,
): Readonly<Record<string, unknown>> {
	const value = records(project.sources, 'V27 motion-analysis sources').find(({ id }) => id === sourceId);
	if (!value || value.kind !== 'video') throw new ReferenceError(`V27 video source ${sourceId} is unavailable.`);
	return structuredClone(value);
}

function analysisRange(startValue: number, endValue: number, source: Readonly<Record<string, unknown>>) {
	const startFrame = nonNegativeInteger(startValue, 'Motion-analysis start frame');
	const endFrame = positiveInteger(endValue, 'Motion-analysis end frame');
	const sourceEnd = positiveInteger(source.sourceFrameCount, 'V27 video source frame count');
	if (endFrame - startFrame < 2 || endFrame > sourceEnd) {
		throw new RangeError('The motion-analysis range requires at least two contained source frames.');
	}
	if (endFrame - startFrame > MAXIMUM_ANALYSIS_FRAMES) {
		throw new RangeError(`A selected V27 motion-analysis run is limited to ${String(MAXIMUM_ANALYSIS_FRAMES)} frames.`);
	}
	return Object.freeze({ startFrame, endFrame });
}

function assertExistingBody(
	metadata: Readonly<Record<string, unknown>>,
	reference: VideoMotionAnalysisReferenceV1,
): void {
	const size = metadata.size ?? metadata.byteLength;
	if (size !== reference.byteLength || metadata.sha256 !== reference.sha256) {
		throw new Error('The existing digest-addressed motion-analysis body is corrupt or conflicting.');
	}
}

function settingsDigest(stack: VideoProcessorStackV1): string {
	return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(stack))));
}

function projectRecord(value: unknown): Readonly<Record<string, unknown>> {
	const project = record(value, 'Selected V27 motion-analysis project');
	if (project.schemaVersion !== 27 && project.schemaVersion !== 28) {
		throw new RangeError('Motion analysis requires selected schema V27 or V28.');
	}
	return project;
}

function records(value: unknown, name: string): Readonly<Record<string, unknown>>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item) => record(item, name));
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Readonly<Record<string, unknown>>;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
		throw new TypeError(`${name} is invalid.`);
	}
	return value;
}

function digest(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

function positiveInteger(value: unknown, name: string): number {
	const result = nonNegativeInteger(value, name);
	if (result < 1) throw new RangeError(`${name} must be positive.`);
	return result;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	throw signal.reason ?? new DOMException('Motion analysis was cancelled.', 'AbortError');
}
