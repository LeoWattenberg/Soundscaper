/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	FREQUENCY_WAVEFORM_FFT_SIZE,
	FREQUENCY_WAVEFORM_HOP_SIZE,
	normalizeFrequencyWaveformCrossovers,
	validateFrequencyWaveformWindow,
	type FrequencyWaveformCrossovers,
	type FrequencyWaveformWindow,
} from '../../frequency-waveform-contract.ts';
import type {
	FrequencyWaveformRuntimeClip,
	FrequencyWaveformRuntimeProject,
	FrequencyWaveformRuntimeSource,
	RequiredFrequencyWaveformSource,
} from './frequency-waveform-source-service.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

const MAXIMUM_CONCURRENT_WINDOW_GENERATIONS = 2;
const DEFAULT_MAXIMUM_RESIDENT_WINDOW_ENTRIES = 256;
const DEFAULT_MAXIMUM_RESIDENT_WINDOW_BYTES = 16 * 1_024 * 1_024;
const MAXIMUM_FREQUENCY_WAVEFORM_PADDING_FRAMES = 65_536;
const CROSSOVER_SETTLING_RESIDUAL = 1e-4;

interface GenerationJob {
	abort: () => void;
	generate: () => Awaitable<FrequencyWaveformWindow>;
	reject: (reason?: unknown) => void;
	resolve: (value: FrequencyWaveformWindow | PromiseLike<FrequencyWaveformWindow>) => void;
	signal: AbortSignal;
	settled: boolean;
}

export interface FrequencyWaveformPcmWindow {
	readonly clipId: string;
	readonly sourceId: string;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly visibleStartFrame?: number;
	readonly visibleEndFrame?: number;
	readonly channels: readonly Float32Array[];
}

export interface FrequencyWaveformRuntimeWindowEntry {
	readonly projectId: string;
	readonly sourceId: string;
	readonly storageKey: string;
	readonly mappingSignature: string;
	readonly requestStartFrame: number;
	readonly requestEndFrame: number;
	readonly window: FrequencyWaveformWindow;
}

export interface FrequencyWaveformWindowRequestOptions {
	readonly startFrame?: unknown;
	readonly endFrame?: unknown;
	readonly lowMidCrossoverHz?: number;
	readonly midHighCrossoverHz?: number;
}

export interface GenerateFrequencyWaveformRuntimeWindowOptions {
	readonly crossovers: FrequencyWaveformCrossovers;
	readonly sourceStartFrame: number;
	readonly visibleStartOffset: number;
	readonly visibleFrameCount: number;
	readonly signal: AbortSignal;
}

export interface FrequencyWaveformWindowServiceDependencies<
	Project extends FrequencyWaveformRuntimeProject = FrequencyWaveformRuntimeProject,
> {
	readonly findClip: (project: Project, clipId: string) => FrequencyWaveformRuntimeClip | null | undefined;
	readonly findSource: (project: Project, sourceId: string) => FrequencyWaveformRuntimeSource | null | undefined;
	readonly getProject: () => Project | null;
	readonly sourceFrequencyWindows: Map<string, FrequencyWaveformRuntimeWindowEntry>;
	readonly requestPcmWindow: (
		clipId: string,
		options: Readonly<{
			startFrame: number;
			endFrame: number;
			sourcePaddingFrames: number;
			signal?: AbortSignal;
		}>,
	) => Awaitable<FrequencyWaveformPcmWindow | null>;
	readonly generateWindow: (
		channels: readonly Float32Array[],
		sampleRate: number,
		options: GenerateFrequencyWaveformRuntimeWindowOptions,
	) => Awaitable<FrequencyWaveformWindow>;
	readonly publishDocumentSnapshot: () => void;
	readonly maximumResidentEntries?: number;
	readonly maximumResidentBytes?: number;
}

/** Own bounded, clip-visible frequency windows used below the 256-frame pyramid resolution. */
export function createFrequencyWaveformWindowService<
	Project extends FrequencyWaveformRuntimeProject,
>(dependencies: FrequencyWaveformWindowServiceDependencies<Project>) {
	const maximumResidentEntries = positiveLimit(
		dependencies.maximumResidentEntries,
		DEFAULT_MAXIMUM_RESIDENT_WINDOW_ENTRIES,
		'entry',
	);
	const maximumResidentBytes = positiveLimit(
		dependencies.maximumResidentBytes,
		DEFAULT_MAXIMUM_RESIDENT_WINDOW_BYTES,
		'byte',
	);
	const pending = new Map<string, Promise<FrequencyWaveformWindow | null>>();
	const latestRequestKeys = new Map<string, string>();
	const sourceGenerations = new Map<string, number>();
	const requests = new Map<string, Readonly<{
		clipId: string;
		sourceId: string;
		controller: AbortController;
	}>>();
	const generationQueue: GenerationJob[] = [];
	let activeGenerations = 0;
	let runtimeGeneration = 0;

	async function requestFrequencyWaveformWindow(
		clipId: string,
		options: FrequencyWaveformWindowRequestOptions,
	): Promise<FrequencyWaveformWindow | null> {
		const project = dependencies.getProject();
		const clip = project ? dependencies.findClip(project, clipId) : null;
		const source = project && clip
			? requiredAudioSource(dependencies.findSource(project, clip.sourceId))
			: null;
		let range: Readonly<{ startFrame: number; endFrame: number }> | null = null;
		try {
			range = clip ? requestRange(options, clip) : null;
		} catch {
			return null;
		}
		if (!project || !clip || !source || !range) return null;
		let crossovers: FrequencyWaveformCrossovers;
		try {
			crossovers = normalizeFrequencyWaveformCrossovers({
				lowMidHz: options.lowMidCrossoverHz,
				midHighHz: options.midHighCrossoverHz,
			});
		} catch {
			return null;
		}
		const mappingSignature = clipMappingSignature(project, clip);
		const requestKey = [
			project.id,
			clip.id,
			source.id,
			sourceStorageKey(source),
			source.frameCount,
			source.channelCount,
			source.sampleRate,
			range.startFrame,
			range.endFrame,
			mappingSignature,
			crossovers.lowMidHz,
			crossovers.midHighHz,
		].join('\u0000');
		latestRequestKeys.set(clip.id, requestKey);
		abortClipRequests(clip.id, requestKey);
		const resident = dependencies.sourceFrequencyWindows.get(clip.id);
		if (runtimeEntryMatches(resident, project.id, source, range, mappingSignature, crossovers)) {
			retainRuntimeEntry(clip.id, resident);
			return resident.window;
		}
		if (resident) {
			dependencies.sourceFrequencyWindows.delete(clip.id);
			dependencies.publishDocumentSnapshot();
		}
		const existing = pending.get(requestKey);
		if (existing) return existing;
		const sourceGeneration = sourceGenerations.get(source.id) ?? 0;
		const runtimeAtStart = runtimeGeneration;
		const controller = new AbortController();
		requests.set(requestKey, { clipId: clip.id, sourceId: source.id, controller });
		const promise = resolveWindow(clip.id, source, range, crossovers, controller.signal)
			.then((window) => {
				if (!requestIsCurrent(
					project.id, clip.id, source, mappingSignature, requestKey,
					sourceGeneration, runtimeAtStart,
				)) return null;
				retainRuntimeEntry(clip.id, Object.freeze({
					projectId: project.id,
					sourceId: source.id,
					storageKey: sourceStorageKey(source),
					mappingSignature,
					requestStartFrame: range.startFrame,
					requestEndFrame: range.endFrame,
					window,
				}));
				dependencies.publishDocumentSnapshot();
				return window;
			})
			.catch(() => null)
			.finally(() => {
				if (pending.get(requestKey) === promise) pending.delete(requestKey);
				if (requests.get(requestKey)?.controller === controller) requests.delete(requestKey);
			});
		pending.set(requestKey, promise);
		return promise;
	}

	async function resolveWindow(
		clipId: string,
		source: RequiredFrequencyWaveformSource,
		range: Readonly<{ startFrame: number; endFrame: number }>,
		crossovers: FrequencyWaveformCrossovers,
		signal: AbortSignal,
	): Promise<FrequencyWaveformWindow> {
		throwIfAborted(signal);
		const pcm = await dependencies.requestPcmWindow(clipId, {
			...range,
			sourcePaddingFrames: frequencyWaveformWindowPaddingFrames(source.sampleRate, crossovers),
			signal,
		});
		throwIfAborted(signal);
		if (!pcm || pcm.sourceId !== source.id || pcm.channels.length !== source.channelCount
			|| pcm.channels.some((channel) => !(channel instanceof Float32Array)
				|| channel.length !== pcm.endFrame - pcm.startFrame)) {
			throw new Error('Frequency waveform PCM window geometry is invalid.');
		}
		const visibleStartFrame = requiredFrame(pcm.visibleStartFrame, 'visible start frame');
		const visibleEndFrame = requiredFrame(pcm.visibleEndFrame, 'visible end frame');
		if (visibleStartFrame < pcm.startFrame || visibleEndFrame > pcm.endFrame
			|| visibleEndFrame <= visibleStartFrame) {
			throw new RangeError('Frequency waveform visible PCM range is invalid.');
		}
		const generated = await scheduleGeneration(signal, () => dependencies.generateWindow(
			pcm.channels,
			source.sampleRate,
			{
				crossovers,
				sourceStartFrame: pcm.startFrame,
				visibleStartOffset: visibleStartFrame - pcm.startFrame,
				visibleFrameCount: visibleEndFrame - visibleStartFrame,
				signal,
			},
		));
		const window = validateFrequencyWaveformWindow(generated);
		if (window.sampleRate !== source.sampleRate || window.channelCount !== source.channelCount
			|| window.startFrame !== visibleStartFrame
			|| window.frameCount !== visibleEndFrame - visibleStartFrame
			|| window.crossovers.lowMidHz !== crossovers.lowMidHz
			|| window.crossovers.midHighHz !== crossovers.midHighHz) {
			throw new Error('Frequency waveform window does not match its source request.');
		}
		return window;
	}

	function scheduleGeneration(
		signal: AbortSignal,
		generate: () => Awaitable<FrequencyWaveformWindow>,
	): Promise<FrequencyWaveformWindow> {
		throwIfAborted(signal);
		return new Promise((resolve, reject) => {
			const job: GenerationJob = {
				generate,
				reject,
				resolve,
				signal,
				settled: false,
				abort: () => undefined,
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
		while (activeGenerations < MAXIMUM_CONCURRENT_WINDOW_GENERATIONS && generationQueue.length) {
			const job = generationQueue.shift()!;
			if (job.settled || job.signal.aborted) {
				job.signal.removeEventListener('abort', job.abort);
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
				job.signal.removeEventListener('abort', job.abort);
				activeGenerations -= 1;
				pumpGenerationQueue();
			});
		}
	}

	function retainRuntimeEntry(clipId: string, entry: FrequencyWaveformRuntimeWindowEntry): void {
		dependencies.sourceFrequencyWindows.delete(clipId);
		dependencies.sourceFrequencyWindows.set(clipId, entry);
		while (dependencies.sourceFrequencyWindows.size > maximumResidentEntries
			|| residentByteLength(dependencies.sourceFrequencyWindows) > maximumResidentBytes) {
			const oldestClipId = dependencies.sourceFrequencyWindows.keys().next().value;
			if (oldestClipId === undefined || (oldestClipId === clipId
				&& dependencies.sourceFrequencyWindows.size === 1)) break;
			dependencies.sourceFrequencyWindows.delete(oldestClipId);
		}
	}

	function abortClipRequests(clipId: string, exceptRequestKey?: string): void {
		for (const [requestKey, request] of requests) {
			if (request.clipId !== clipId || requestKey === exceptRequestKey) continue;
			request.controller.abort();
			requests.delete(requestKey);
			pending.delete(requestKey);
		}
	}

	function clearRuntime(): void {
		runtimeGeneration += 1;
		for (const request of requests.values()) request.controller.abort();
		requests.clear();
		pending.clear();
		latestRequestKeys.clear();
		sourceGenerations.clear();
		dependencies.sourceFrequencyWindows.clear();
	}

	async function invalidateSource(sourceId: string): Promise<void> {
		sourceGenerations.set(sourceId, (sourceGenerations.get(sourceId) ?? 0) + 1);
		for (const [requestKey, request] of requests) {
			if (request.sourceId !== sourceId) continue;
			request.controller.abort();
			requests.delete(requestKey);
			pending.delete(requestKey);
		}
		let removed = false;
		for (const [clipId, entry] of dependencies.sourceFrequencyWindows) {
			if (entry.sourceId !== sourceId) continue;
			dependencies.sourceFrequencyWindows.delete(clipId);
			removed = true;
		}
		if (removed) dependencies.publishDocumentSnapshot();
	}

	function requestIsCurrent(
		projectId: string,
		clipId: string,
		source: RequiredFrequencyWaveformSource,
		mappingSignature: string,
		requestKey: string,
		sourceGeneration: number,
		runtimeAtStart: number,
	): boolean {
		if (runtimeGeneration !== runtimeAtStart
			|| (sourceGenerations.get(source.id) ?? 0) !== sourceGeneration
			|| latestRequestKeys.get(clipId) !== requestKey) return false;
		const project = dependencies.getProject();
		const clip = project?.id === projectId ? dependencies.findClip(project, clipId) : null;
		const current = project && clip?.sourceId === source.id
			? requiredAudioSource(dependencies.findSource(project, source.id))
			: null;
		return Boolean(current && sameSourceGeometry(current, source)
			&& clipMappingSignature(project!, clip!) === mappingSignature);
	}

	return Object.freeze({ requestFrequencyWaveformWindow, clearRuntime, invalidateSource });
}

/** Context needed for a source-aligned centered FFT and a -80 dB low-crossover pole decay. */
export function frequencyWaveformWindowPaddingFrames(
	sampleRate: number,
	crossovers: FrequencyWaveformCrossovers,
): number {
	if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
		throw new RangeError('A frequency waveform window requires a positive sample rate.');
	}
	const normalized = normalizeFrequencyWaveformCrossovers(crossovers);
	const frequency = Math.min(normalized.lowMidHz, sampleRate * 0.45);
	const k = Math.tan(Math.PI * frequency / sampleRate);
	const pole = Math.abs((1 - k) / (1 + k));
	const settlingFrames = pole > 0 && pole < 1
		? Math.ceil(Math.log(CROSSOVER_SETTLING_RESIDUAL) / Math.log(pole))
		: 0;
	return Math.min(MAXIMUM_FREQUENCY_WAVEFORM_PADDING_FRAMES, Math.max(
		FREQUENCY_WAVEFORM_FFT_SIZE / 2 + FREQUENCY_WAVEFORM_HOP_SIZE - 1,
		settlingFrames,
	));
}

function requestRange(
	options: FrequencyWaveformWindowRequestOptions,
	clip: FrequencyWaveformRuntimeClip,
): Readonly<{ startFrame: number; endFrame: number }> | null {
	const durationFrames = requiredFrame(clip.durationFrames, 'clip duration');
	const startFrame = requiredFrame(options.startFrame, 'request start frame');
	const endFrame = requiredFrame(options.endFrame, 'request end frame');
	return startFrame < endFrame && endFrame <= durationFrames ? { startFrame, endFrame } : null;
}

function runtimeEntryMatches(
	entry: FrequencyWaveformRuntimeWindowEntry | undefined,
	projectId: string,
	source: RequiredFrequencyWaveformSource,
	range: Readonly<{ startFrame: number; endFrame: number }>,
	mappingSignature: string,
	crossovers: FrequencyWaveformCrossovers,
): entry is FrequencyWaveformRuntimeWindowEntry {
	return Boolean(entry
		&& entry.projectId === projectId
		&& entry.sourceId === source.id
		&& entry.storageKey === sourceStorageKey(source)
		&& entry.requestStartFrame === range.startFrame
		&& entry.requestEndFrame === range.endFrame
		&& entry.mappingSignature === mappingSignature
		&& entry.window.sampleRate === source.sampleRate
		&& entry.window.channelCount === source.channelCount
		&& entry.window.crossovers.lowMidHz === crossovers.lowMidHz
		&& entry.window.crossovers.midHighHz === crossovers.midHighHz);
}

function clipMappingSignature(
	project: FrequencyWaveformRuntimeProject,
	clip: FrequencyWaveformRuntimeClip,
): string {
	return JSON.stringify([
		clip.timelineStartFrame ?? null,
		clip.sourceStartFrame ?? null,
		clip.sourceDurationFrames ?? null,
		clip.durationFrames ?? null,
		Boolean(clip.reversed),
		clip.kind ?? null,
		clip.anchor ?? null,
		clip.musicalStartBeat ?? null,
		clip.musicalExtent ?? null,
		clip.musicalDurationBeats ?? null,
		clip.warpMap ?? null,
		project.sampleRate ?? null,
		project.tempoMap ?? null,
	]);
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

function sameSourceGeometry(
	left: RequiredFrequencyWaveformSource,
	right: RequiredFrequencyWaveformSource,
): boolean {
	return sourceStorageKey(left) === sourceStorageKey(right)
		&& left.frameCount === right.frameCount
		&& left.channelCount === right.channelCount
		&& left.sampleRate === right.sampleRate;
}

function residentByteLength(entries: ReadonlyMap<string, FrequencyWaveformRuntimeWindowEntry>): number {
	let total = 0;
	for (const { window } of entries.values()) {
		for (const band of ['low', 'mid', 'high'] as const) {
			for (const channel of window.bands[band]) total += channel.byteLength;
		}
		total += window.centroid.numerators.byteLength + window.centroid.weights.byteLength;
	}
	return total;
}

function positiveLimit(value: number | undefined, fallback: number, name: string): number {
	const resolved = value ?? fallback;
	if (!Number.isSafeInteger(resolved) || resolved < 1) {
		throw new RangeError(`The resident frequency waveform window ${name} limit must be positive.`);
	}
	return resolved;
}

function requiredFrame(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`Invalid frequency waveform ${name}.`);
	}
	return Number(value);
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
