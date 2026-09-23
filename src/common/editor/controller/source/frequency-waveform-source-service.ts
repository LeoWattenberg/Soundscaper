/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	frequencyWaveformCacheKey,
	normalizeFrequencyWaveformCrossovers,
	validateFrequencyWaveformAnalysis,
	type FrequencyWaveformAnalysis,
	type FrequencyWaveformCrossovers,
} from '../../frequency-waveform-contract.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

const MAXIMUM_CONCURRENT_GENERATIONS = 2;
export const DEFAULT_MAXIMUM_RESIDENT_FREQUENCY_WAVEFORM_ANALYSES = 256;
export const DEFAULT_MAXIMUM_RESIDENT_FREQUENCY_WAVEFORM_ANALYSIS_BYTES = 64 * 1_024 * 1_024;

interface GenerationJob {
	abort?: () => void;
	generate: () => Awaitable<FrequencyWaveformAnalysis>;
	reject: (reason?: unknown) => void;
	resolve: (value: FrequencyWaveformAnalysis | PromiseLike<FrequencyWaveformAnalysis>) => void;
	signal: AbortSignal;
	settled: boolean;
}

export interface FrequencyWaveformRuntimeSource {
	readonly id: string;
	readonly kind?: string;
	readonly storageKey?: string;
	readonly frameCount?: number;
	readonly channelCount?: number;
	readonly sampleRate?: number;
}

export interface FrequencyWaveformRuntimeClip {
	readonly id: string;
	readonly sourceId: string;
	readonly kind?: string;
	readonly durationFrames?: number;
	readonly timelineStartFrame?: number;
	readonly sourceStartFrame?: number;
	readonly sourceDurationFrames?: number;
	readonly reversed?: boolean;
	readonly anchor?: unknown;
	readonly musicalStartBeat?: unknown;
	readonly musicalExtent?: unknown;
	readonly musicalDurationBeats?: unknown;
	readonly warpMap?: unknown;
}

export interface FrequencyWaveformRuntimeProject {
	readonly id: string;
	readonly clips: readonly FrequencyWaveformRuntimeClip[];
	readonly sources: readonly FrequencyWaveformRuntimeSource[];
	readonly sampleRate?: number;
	readonly tempoMap?: unknown;
}

export interface FrequencyWaveformRuntimeEntry {
	readonly projectId: string;
	readonly storageKey: string;
	readonly analysis: FrequencyWaveformAnalysis;
}

export interface FrequencyWaveformRequestOptions {
	readonly lowMidCrossoverHz?: number;
	readonly midHighCrossoverHz?: number;
}

export interface FrequencyWaveformSourceServiceStore {
	loadAnalysis(key: string): Awaitable<unknown>;
	saveAnalysis(key: string, value: FrequencyWaveformAnalysis): Awaitable<unknown>;
	deleteAnalysis?(key: string): Awaitable<unknown>;
}

export interface FrequencyWaveformSourceServiceDependencies<
	Project extends FrequencyWaveformRuntimeProject = FrequencyWaveformRuntimeProject,
	Buffer = unknown,
> {
	readonly findClip: (project: Project, clipId: string) => FrequencyWaveformRuntimeClip | null | undefined;
	readonly findSource: (project: Project, sourceId: string) => FrequencyWaveformRuntimeSource | null | undefined;
	readonly getProject: () => Project | null;
	readonly sourceBuffers: ReadonlyMap<string, Buffer>;
	readonly sourceFrequencyAnalyses: Map<string, FrequencyWaveformRuntimeEntry>;
	readonly persistentCacheBypassSourceIds?: Set<string>;
	readonly maximumResidentAnalysisEntries?: number;
	readonly maximumResidentAnalysisBytes?: number;
	readonly store: FrequencyWaveformSourceServiceStore;
	readonly generateFromBuffer: (
		buffer: Buffer,
		source: RequiredFrequencyWaveformSource,
		crossovers: FrequencyWaveformCrossovers,
		signal: AbortSignal,
	) => Awaitable<FrequencyWaveformAnalysis>;
	readonly generateFromStore: (
		store: FrequencyWaveformSourceServiceStore,
		source: RequiredFrequencyWaveformSource,
		crossovers: FrequencyWaveformCrossovers,
		signal: AbortSignal,
	) => Awaitable<FrequencyWaveformAnalysis>;
	readonly publishDocumentSnapshot: () => void;
}

export interface RequiredFrequencyWaveformSource extends FrequencyWaveformRuntimeSource {
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
}

/**
 * Own the lazy source-domain frequency waveform cache. Requests are speculative:
 * malformed persisted data and analysis failures deliberately leave the ordinary
 * waveform in place, while a later viewport request may retry the work.
 */
export function createFrequencyWaveformSourceService<
	Project extends FrequencyWaveformRuntimeProject,
	Buffer = unknown,
>(dependencies: FrequencyWaveformSourceServiceDependencies<Project, Buffer>) {
	const maximumResidentAnalysisEntries = residentAnalysisEntryLimit(
		dependencies.maximumResidentAnalysisEntries,
	);
	const maximumResidentAnalysisBytes = residentAnalysisByteLimit(
		dependencies.maximumResidentAnalysisBytes,
	);
	const pending = new Map<string, Promise<FrequencyWaveformAnalysis | null>>();
	const persistentCacheBypassSourceIds = dependencies.persistentCacheBypassSourceIds ?? new Set<string>();
	const latestRequestKeys = new Map<string, string>();
	const sourceGenerations = new Map<string, number>();
	const cacheOperationTails = new Map<string, Promise<void>>();
	const requestAbortControllers = new Map<string, Readonly<{
		sourceId: string;
		controller: AbortController;
	}>>();
	const generationQueue: GenerationJob[] = [];
	let activeGenerations = 0;
	let runtimeGeneration = 0;

	async function requestFrequencyWaveform(
		clipId: string,
		options: FrequencyWaveformRequestOptions = {},
	): Promise<FrequencyWaveformAnalysis | null> {
		const project = dependencies.getProject();
		const clip = project ? dependencies.findClip(project, clipId) : null;
		const candidate = clip && project ? dependencies.findSource(project, clip.sourceId) : null;
		const source = requiredAudioSource(candidate);
		if (!project || !clip || !source) return null;
		let crossovers: FrequencyWaveformCrossovers;
		try {
			crossovers = normalizeFrequencyWaveformCrossovers({
				lowMidHz: options.lowMidCrossoverHz,
				midHighHz: options.midHighCrossoverHz,
			});
		} catch {
			return null;
		}
		const requestKey = [
			project.id,
			source.id,
			sourceStorageKey(source),
			source.frameCount,
			source.channelCount,
			source.sampleRate,
			crossovers.lowMidHz,
			crossovers.midHighHz,
		].join('\u0000');
		latestRequestKeys.set(source.id, requestKey);
		abortSourceRequests(source.id, requestKey);
		const runtimeEntry = dependencies.sourceFrequencyAnalyses.get(source.id);
		if (runtimeEntryMatches(runtimeEntry, project.id, source, crossovers)) {
			const evicted = retainRuntimeEntry(source.id, runtimeEntry);
			if (evicted) dependencies.publishDocumentSnapshot();
			return runtimeEntry.analysis;
		}
		if (runtimeEntry && dependencies.sourceFrequencyAnalyses.get(source.id) === runtimeEntry) {
			dependencies.sourceFrequencyAnalyses.delete(source.id);
			dependencies.publishDocumentSnapshot();
		}
		const existing = pending.get(requestKey);
		if (existing) return existing;
		const generation = sourceGenerations.get(source.id) ?? 0;
		const runtimeAtStart = runtimeGeneration;
		const controller = new AbortController();
		requestAbortControllers.set(requestKey, { sourceId: source.id, controller });
		const promise = resolveAnalysis(project.id, source, crossovers, controller.signal).then(async (resolved) => {
			if (!requestIsCurrent(project.id, source, requestKey, generation, runtimeAtStart)) return null;
			const { analysis } = resolved;
			const entry = Object.freeze({
				projectId: project.id,
				storageKey: sourceStorageKey(source),
				analysis,
			});
			retainRuntimeEntry(source.id, entry);
			dependencies.publishDocumentSnapshot();
			if (resolved.requiresSave) {
				await enqueueCacheOperation(source.id, async () => {
					if (!requestIsCurrent(project.id, source, requestKey, generation, runtimeAtStart)) return;
					await dependencies.store.saveAnalysis(frequencyWaveformCacheKey(source.id), analysis);
					if (requestIsCurrent(project.id, source, requestKey, generation, runtimeAtStart)) {
						persistentCacheBypassSourceIds.delete(source.id);
					}
				});
			}
			if (!requestIsCurrent(project.id, source, requestKey, generation, runtimeAtStart)) return null;
			return analysis;
		}).catch(() => null).finally(() => {
			if (pending.get(requestKey) === promise) pending.delete(requestKey);
			const activeRequest = requestAbortControllers.get(requestKey);
			if (activeRequest?.controller === controller) requestAbortControllers.delete(requestKey);
		});
		pending.set(requestKey, promise);
		return promise;
	}

	async function resolveAnalysis(
		projectId: string,
		source: RequiredFrequencyWaveformSource,
		crossovers: FrequencyWaveformCrossovers,
		signal: AbortSignal,
	): Promise<Readonly<{ analysis: FrequencyWaveformAnalysis; requiresSave: boolean }>> {
		throwIfAborted(signal);
		const key = frequencyWaveformCacheKey(source.id);
		await waitForCacheOperations(source.id);
		throwIfAborted(signal);
		let cached: unknown;
		if (!persistentCacheBypassSourceIds.has(source.id)) {
			try {
				cached = await dependencies.store.loadAnalysis(key);
			} catch {
				cached = null;
			}
		}
		throwIfAborted(signal);
		const validCached = matchingAnalysis(cached, source, crossovers);
		if (validCached) return { analysis: validCached, requiresSave: false };
		const current = currentSource(projectId, source);
		if (!current) throw new Error('The frequency waveform source is no longer current.');
		const buffer = dependencies.sourceBuffers.get(source.id);
		const generated = await scheduleGeneration(signal, () => buffer
			? dependencies.generateFromBuffer(buffer, current, crossovers, signal)
			: dependencies.generateFromStore(dependencies.store, current, crossovers, signal));
		const valid = matchingAnalysis(generated, current, crossovers);
		if (!valid) throw new Error('Frequency waveform analysis does not match its source.');
		return { analysis: valid, requiresSave: true };
	}

	async function enqueueCacheOperation(sourceId: string, operation: () => Awaitable<unknown>): Promise<void> {
		const previous = cacheOperationTails.get(sourceId) ?? Promise.resolve();
		const next = previous
			.catch(() => undefined)
			.then(async () => { await operation(); })
			.catch(() => undefined);
		cacheOperationTails.set(sourceId, next);
		await next;
		if (cacheOperationTails.get(sourceId) === next) cacheOperationTails.delete(sourceId);
	}

	async function waitForCacheOperations(sourceId: string): Promise<void> {
		await cacheOperationTails.get(sourceId)?.catch(() => undefined);
	}

	function scheduleGeneration(
		signal: AbortSignal,
		generate: () => Awaitable<FrequencyWaveformAnalysis>,
	): Promise<FrequencyWaveformAnalysis> {
		throwIfAborted(signal);
		return new Promise((resolve, reject) => {
			const job: GenerationJob = {
				generate,
				reject,
				resolve,
				signal,
				settled: false,
			};
			job.abort = () => {
				if (job.settled) return;
				job.settled = true;
				reject(abortError(signal));
			};
			signal.addEventListener('abort', job.abort, { once: true });
			generationQueue.push(job);
			pumpGenerationQueue();
		});
	}

	function pumpGenerationQueue(): void {
		while (activeGenerations < MAXIMUM_CONCURRENT_GENERATIONS && generationQueue.length) {
			const job = generationQueue.shift()!;
			if (job.settled || job.signal.aborted) {
				job.signal.removeEventListener('abort', job.abort!);
				continue;
			}
			activeGenerations += 1;
			void Promise.resolve().then(job.generate).then(
				(value) => {
					if (!job.settled) {
						job.settled = true;
						job.resolve(value);
					}
				},
				(error: unknown) => {
					if (!job.settled) {
						job.settled = true;
						job.reject(error);
					}
				},
			).finally(() => {
				job.signal.removeEventListener('abort', job.abort!);
				activeGenerations -= 1;
				pumpGenerationQueue();
			});
		}
	}

	function abortSourceRequests(sourceId: string, exceptRequestKey?: string): void {
		for (const [requestKey, request] of requestAbortControllers) {
			if (request.sourceId !== sourceId || requestKey === exceptRequestKey) continue;
			request.controller.abort();
			requestAbortControllers.delete(requestKey);
			pending.delete(requestKey);
		}
	}

	function retainRuntimeEntry(sourceId: string, entry: FrequencyWaveformRuntimeEntry): boolean {
		dependencies.sourceFrequencyAnalyses.delete(sourceId);
		dependencies.sourceFrequencyAnalyses.set(sourceId, entry);
		let evicted = false;
		let residentBytes = residentAnalysisBytes(dependencies.sourceFrequencyAnalyses);
		while (dependencies.sourceFrequencyAnalyses.size > maximumResidentAnalysisEntries
			|| residentBytes > maximumResidentAnalysisBytes) {
			let oldestEntry: readonly [string, FrequencyWaveformRuntimeEntry] | null = null;
			for (const candidate of dependencies.sourceFrequencyAnalyses) {
				const [candidateSourceId] = candidate;
				if (candidateSourceId === sourceId) continue;
				oldestEntry = candidate;
				break;
			}
			if (oldestEntry === null) break;
			dependencies.sourceFrequencyAnalyses.delete(oldestEntry[0]);
			residentBytes -= frequencyWaveformAnalysisTypedArrayBytes(oldestEntry[1].analysis);
			evicted = true;
		}
		return evicted;
	}

	function clearRuntime(): void {
		runtimeGeneration += 1;
		for (const request of requestAbortControllers.values()) request.controller.abort();
		requestAbortControllers.clear();
		dependencies.sourceFrequencyAnalyses.clear();
		pending.clear();
		latestRequestKeys.clear();
		sourceGenerations.clear();
	}

	async function invalidateSource(sourceId: string): Promise<void> {
		persistentCacheBypassSourceIds.add(sourceId);
		sourceGenerations.set(sourceId, (sourceGenerations.get(sourceId) ?? 0) + 1);
		abortSourceRequests(sourceId);
		dependencies.sourceFrequencyAnalyses.delete(sourceId);
		latestRequestKeys.delete(sourceId);
		await enqueueCacheOperation(sourceId, async () => {
			if (!dependencies.store.deleteAnalysis) return;
			await dependencies.store.deleteAnalysis(frequencyWaveformCacheKey(sourceId));
			persistentCacheBypassSourceIds.delete(sourceId);
		});
	}

	function requestIsCurrent(
		projectId: string,
		source: RequiredFrequencyWaveformSource,
		requestKey: string,
		generation: number,
		runtimeAtStart: number,
	): boolean {
		return runtimeGeneration === runtimeAtStart
			&& (sourceGenerations.get(source.id) ?? 0) === generation
			&& latestRequestKeys.get(source.id) === requestKey
			&& currentSource(projectId, source) !== null;
	}

	function currentSource(
		projectId: string,
		source: RequiredFrequencyWaveformSource,
	): RequiredFrequencyWaveformSource | null {
		const project = dependencies.getProject();
		if (!project || project.id !== projectId) return null;
		const current = requiredAudioSource(dependencies.findSource(project, source.id));
		return current && sameSourceGeometry(current, source) ? current : null;
	}

	return Object.freeze({
		requestFrequencyWaveform,
		clearRuntime,
		invalidateSource,
	});
}

function residentAnalysisEntryLimit(value: number | undefined): number {
	if (value === undefined) return DEFAULT_MAXIMUM_RESIDENT_FREQUENCY_WAVEFORM_ANALYSES;
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new RangeError('The resident frequency waveform analysis limit must be a positive safe integer.');
	}
	return value;
}

function residentAnalysisByteLimit(value: number | undefined): number {
	if (value === undefined) return DEFAULT_MAXIMUM_RESIDENT_FREQUENCY_WAVEFORM_ANALYSIS_BYTES;
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new RangeError('The resident frequency waveform analysis byte limit must be a positive safe integer.');
	}
	return value;
}

function residentAnalysisBytes(entries: ReadonlyMap<string, FrequencyWaveformRuntimeEntry>): number {
	let bytes = 0;
	for (const { analysis } of entries.values()) {
		bytes += frequencyWaveformAnalysisTypedArrayBytes(analysis);
	}
	return bytes;
}

function frequencyWaveformAnalysisTypedArrayBytes(analysis: FrequencyWaveformAnalysis): number {
	let bytes = 0;
	for (const level of analysis.levels) {
		bytes += level.centroid.numerators.byteLength + level.centroid.weights.byteLength;
		for (const channels of [level.bands.low, level.bands.mid, level.bands.high]) {
			for (const channel of channels) {
				bytes += channel.minimums.byteLength + channel.maximums.byteLength;
			}
		}
	}
	return bytes;
}

function requiredAudioSource(
	value: FrequencyWaveformRuntimeSource | null | undefined,
): RequiredFrequencyWaveformSource | null {
	if (!value || value.kind === 'video' || value.kind === 'image' || value.kind === 'still') return null;
	return typeof value.id === 'string'
		&& Number.isSafeInteger(value.frameCount) && Number(value.frameCount) >= 0
		&& Number.isSafeInteger(value.channelCount) && Number(value.channelCount) > 0
		&& Number.isSafeInteger(value.sampleRate) && Number(value.sampleRate) > 0
		? value as RequiredFrequencyWaveformSource
		: null;
}

function matchingAnalysis(
	value: unknown,
	source: RequiredFrequencyWaveformSource,
	crossovers: FrequencyWaveformCrossovers,
): FrequencyWaveformAnalysis | null {
	try {
		const analysis = validateFrequencyWaveformAnalysis(value);
		return analysis.frameCount === source.frameCount
			&& analysis.channelCount === source.channelCount
			&& analysis.sampleRate === source.sampleRate
			&& analysis.crossovers.lowMidHz === crossovers.lowMidHz
			&& analysis.crossovers.midHighHz === crossovers.midHighHz
			? analysis
			: null;
	} catch {
		return null;
	}
}

function runtimeEntryMatches(
	entry: FrequencyWaveformRuntimeEntry | undefined,
	projectId: string,
	source: RequiredFrequencyWaveformSource,
	crossovers: FrequencyWaveformCrossovers,
): entry is FrequencyWaveformRuntimeEntry {
	return Boolean(entry
		&& entry.projectId === projectId
		&& entry.storageKey === sourceStorageKey(source)
		&& matchingAnalysis(entry.analysis, source, crossovers));
}

function sameSourceGeometry(
	left: RequiredFrequencyWaveformSource,
	right: RequiredFrequencyWaveformSource,
): boolean {
	return sourceStorageKey(left) === sourceStorageKey(right)
		&& left.frameCount === right.frameCount
		&& left.channelCount === right.channelCount
		&& left.sampleRate === right.sampleRate;
}

function sourceStorageKey(source: FrequencyWaveformRuntimeSource): string {
	return source.storageKey || source.id;
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw abortError(signal);
}

function abortError(signal: AbortSignal): Error {
	if (signal.reason instanceof Error) return signal.reason;
	return new DOMException('The operation was aborted.', 'AbortError');
}
