/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEnvelopeValueEvaluator } from '../common/editor/automation.js';
import { evaluateClipTransitionGainAt } from '../common/editor/audio-clip-transition-gain.ts';
import {
	createAudioWarpRuntimeEvaluator,
	type AudioWarpRuntimeClip,
	type AudioWarpRuntimeEvaluator,
	type AudioWarpRuntimeProject,
} from '../common/editor/audio-warp-runtime.ts';
import { AUDIO_EDITOR_STORAGE_CHUNK_FRAMES } from '../common/editor/chunk-stream.js';
import {
	resolveRuntimeClipProjection,
	type RuntimeClipProject,
	type RuntimePersistedClip,
} from '../common/editor/runtime-clip-projection.ts';
import type { UnifiedExactRenderVisualFrameEntryV13 } from '../common/editor/unified-exact-render-visual-consumers-v13.ts';
import {
	SOUND_VISUALIZER_SPECTRUM_SIZE,
	soundVisualizerSpectrumWindowStarts,
} from '../common/editor/sound-visualizer-spectrum-windows.ts';
import { normalizeVideoGeneratorSourceV1 } from '../common/editor/video-visual-model-v24.ts';

type Data = Readonly<Record<string, unknown>>;

export interface FramescaperSoundVisualizerWindow {
	readonly channels: readonly Float32Array[] | null;
	readonly sampleRate: number;
	/** Absolute project-rate timeline sample at the left edge, including leading silence. */
	readonly windowStartFrame: number;
	readonly timelineFrame: number;
}

export interface FramescaperSoundVisualizerPcmStore {
	readSourceChunk?(
		sourceId: string,
		chunkIndex: number,
		options?: Readonly<{ readonly signal?: AbortSignal }>,
	): PromiseLike<unknown> | unknown;
}

export interface FramescaperSoundVisualizerWindowReader {
	window(
		entry: UnifiedExactRenderVisualFrameEntryV13,
		timelineSample: number,
		outputOrdinal: number,
		signal: AbortSignal,
	): Promise<FramescaperSoundVisualizerWindow>;
	dispose(): void;
}

interface AudioSource {
	readonly id: string;
	readonly storageKey: string;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly chunkFrames: number;
}

interface AudioBinding {
	readonly id: string;
	readonly source: AudioSource;
	readonly start: number;
	readonly end: number;
	readonly sourceStart: number;
	readonly sourceEnd: number;
	readonly gain: number;
	readonly reversed: boolean;
	readonly fadeInFrames: number;
	readonly fadeOutFrames: number;
	readonly fadeInShape: number | undefined;
	readonly fadeOutShape: number | undefined;
	readonly envelopeAt: (frame: number) => number;
	readonly warp: AudioWarpRuntimeEvaluator | null;
}

interface AudioChunk {
	readonly channels: readonly Float32Array[];
	readonly byteLength: number;
}

interface WaveformWindowCache {
	readonly binding: AudioBinding;
	readonly frameCount: number;
	readonly sampleStride: number;
	readonly outputFrames: number;
	readonly windowStartFrame: number;
	readonly channels: readonly Float32Array[];
}

const MAXIMUM_CACHED_CHUNKS = 32;
const MAXIMUM_CACHED_PCM_BYTES = 32 * 1_024 * 1_024;
const MAXIMUM_CHUNKS_PER_WINDOW = 1_024;
const MAXIMUM_VISUAL_CHANNELS = 2;
const MAXIMUM_VISUAL_FRAMES = 1_048_576;

/** Read a moving, project-rate PCM window for one placed visualizer clip. */
export function createFramescaperSoundVisualizerWindowReader(options: Readonly<{
	readonly project: unknown;
	readonly store?: unknown;
}>): FramescaperSoundVisualizerWindowReader {
	const project = record(options?.project, 'sound visualizer project');
	const store = options?.store as FramescaperSoundVisualizerPcmStore | null | undefined;
	const sampleRate = positiveInteger(project.sampleRate, 'sound visualizer project sample rate');
	const sourceById = new Map(records(project.sources, 'sound visualizer sources')
		.map((source) => [id(source.id, 'audio source ID'), source]));
	const clipById = new Map(records(project.clips, 'sound visualizer clips')
		.map((clip) => [id(clip.id, 'audio clip ID'), clip]));
	const trackById = new Map(records(project.tracks, 'sound visualizer tracks')
		.map((track) => [id(track.id, 'track ID'), track]));
	const sequenceById = new Map(records(project.sequences, 'sound visualizer sequences')
		.map((sequence) => [id(sequence.id, 'sequence ID'), sequence]));
	const bindingsBySequence = new Map<string, readonly AudioBinding[]>();
	const chunkCache = new Map<string, AudioChunk>();
	let cachedChunkBytes = 0;
	let waveformWindow: WaveformWindowCache | null = null;
	let disposed = false;

	function bindings(sequenceId: string): readonly AudioBinding[] {
		const cached = bindingsBySequence.get(sequenceId);
		if (cached) return cached;
		const sequence = sequenceById.get(sequenceId);
		if (!sequence) throw new ReferenceError(`Sound visualizer sequence ${sequenceId} is missing.`);
		const seen = new Set<string>();
		const result: AudioBinding[] = [];
		for (const trackId of strings(sequence.trackIds, 'sequence track IDs')) {
			const track = trackById.get(trackId);
			if (!track || track.type !== 'audio') continue;
			for (const clipId of strings(track.clipIds, 'audio track clip IDs')) {
				if (seen.has(clipId)) continue;
				seen.add(clipId);
				const clip = clipById.get(clipId);
				if (!clip || clip.kind !== 'audio') {
					throw new ReferenceError(`Audio track references missing audio clip ${clipId}.`);
				}
				if (clip.sequenceId !== undefined && clip.sequenceId !== sequenceId) continue;
				const source = sourceById.get(id(clip.sourceId, 'audio clip source ID'));
				if (!source || source.kind !== 'audio') {
					throw new ReferenceError(`Audio clip ${clipId} has no matching audio source.`);
				}
				result.push(binding(project, clip, source));
			}
		}
		const frozen = Object.freeze(result);
		bindingsBySequence.set(sequenceId, frozen);
		return frozen;
	}

	async function readChunk(source: AudioSource, index: number, signal: AbortSignal): Promise<AudioChunk> {
		if (!store || typeof store.readSourceChunk !== 'function') {
			throw new Error('Sound visualizer PCM source reading is unavailable.');
		}
		const key = `${source.storageKey}:${String(index)}`;
		const cached = chunkCache.get(key);
		if (cached) {
			chunkCache.delete(key);
			chunkCache.set(key, cached);
			return cached;
		}
		throwIfAborted(signal);
		const raw = await store.readSourceChunk(source.storageKey, index, { signal });
		throwIfAborted(signal);
		if (disposed) throw new Error('The sound visualizer PCM reader was disposed.');
		const chunk = record(raw, 'sound visualizer PCM chunk');
		const expectedFrames = Math.min(source.chunkFrames, source.frameCount - index * source.chunkFrames);
		if (chunk.index !== index || chunk.frames !== expectedFrames || !Array.isArray(chunk.channels)
			|| chunk.channels.length !== source.channelCount
			|| chunk.channels.some((channel) => !(channel instanceof Float32Array)
				|| channel.length !== expectedFrames)) {
			throw new RangeError(`Audio source ${source.id} chunk ${String(index)} has stale PCM geometry.`);
		}
		const accepted = Object.freeze({
			channels: chunk.channels as readonly Float32Array[],
			byteLength: expectedFrames * source.channelCount * Float32Array.BYTES_PER_ELEMENT,
		});
		const replaced = chunkCache.get(key);
		if (replaced) cachedChunkBytes -= replaced.byteLength;
		chunkCache.delete(key);
		chunkCache.set(key, accepted);
		cachedChunkBytes += accepted.byteLength;
		while (chunkCache.size > MAXIMUM_CACHED_CHUNKS || cachedChunkBytes > MAXIMUM_CACHED_PCM_BYTES) {
			const oldest = chunkCache.keys().next().value;
			if (oldest === undefined) break;
			cachedChunkBytes -= chunkCache.get(oldest)!.byteLength;
			chunkCache.delete(oldest);
		}
		return accepted;
	}

	async function window(
		entry: UnifiedExactRenderVisualFrameEntryV13,
		timelineSample: number,
		outputOrdinal: number,
		signal: AbortSignal,
	): Promise<FramescaperSoundVisualizerWindow> {
		if (disposed) throw new Error('The sound visualizer PCM reader was disposed.');
		throwIfAborted(signal);
		const time = roundedNonNegativeSample(timelineSample, 'sound visualizer timeline sample');
		const ordinal = nonNegativeInteger(outputOrdinal, 'sound visualizer output ordinal');
		if (!entry || typeof entry !== 'object' || !('source' in entry.authoredState)
			|| entry.authoredState.source.kind !== 'generator') {
			throw new TypeError('A placed sound visualizer generator entry is required.');
		}
		const source = normalizeVideoGeneratorSourceV1(entry.authoredState.source);
		const generator = source.generator;
		if (generator.kind !== 'sound-visualizer' || entry.modelKind !== generator.kind) {
			throw new RangeError('The visual entry is not a sound visualizer.');
		}
		const frameCount = Math.max(1, Math.round(generator.windowSeconds * sampleRate));
		const peakMode = generator.mode === 'waveform' && frameCount > MAXIMUM_VISUAL_FRAMES;
		const sampleStride = peakMode
			? Math.ceil((frameCount - 1) / (MAXIMUM_VISUAL_FRAMES - 1))
			: Math.ceil(frameCount / MAXIMUM_VISUAL_FRAMES);
		const outputFrames = peakMode
			? Math.ceil((frameCount + sampleStride - 1) / sampleStride)
			: Math.ceil(frameCount / sampleStride);
		const requestedWindowStart = time - Math.floor(frameCount / 2);
		const requestedWindowEnd = requestedWindowStart + frameCount;
		const spectrumStarts = generator.mode === 'spectrum'
			? soundVisualizerSpectrumWindowStarts(outputFrames) : null;
		const visualFrames = spectrumStarts && outputFrames > SOUND_VISUALIZER_SPECTRUM_SIZE
			? spectrumStarts.length * SOUND_VISUALIZER_SPECTRUM_SIZE : outputFrames;
		const maximumChunks = generator.mode === 'spectrum'
			? Math.max(MAXIMUM_CHUNKS_PER_WINDOW, visualFrames * 2) : MAXIMUM_CHUNKS_PER_WINDOW;
		const windowStartFrame = peakMode
			? Math.floor(requestedWindowStart / sampleStride) * sampleStride
			: requestedWindowStart;
		const eligible = bindings(entry.authoredState.clip.sequenceId);
		const selected = generator.sourceIds.length === 0 ? eligible : eligible.filter(
			(candidate) => generator.sourceIds.includes(candidate.source.id),
		);
		if (generator.sourceIds.length > 0 && selected.length === 0) {
			throw new ReferenceError('The selected sound visualizer audio sources have no clips in this sequence.');
		}
		const nearest = selectNearest(selected, time);
		const base = { sampleRate: sampleRate / sampleStride, windowStartFrame, timelineFrame: ordinal };
		if (!nearest) {
			waveformWindow = null;
			return Object.freeze({ ...base, channels: null });
		}
		const audioSource = nearest.source;
		const sourceChannels = audioSource.channelCount;
		const downmix = generator.mode === 'waveform' && sourceChannels > MAXIMUM_VISUAL_CHANNELS;
		const visualChannels = downmix ? 1 : sourceChannels;
		const channels = Array.from({ length: visualChannels * (peakMode ? 2 : 1) },
			() => new Float32Array(visualFrames));
		const cached = generator.mode === 'waveform' ? waveformWindow : null;
		const delta = cached ? windowStartFrame - cached.windowStartFrame : -1;
		const overlap = cached?.binding === nearest && cached.frameCount === frameCount
			&& cached.sampleStride === sampleStride && cached.outputFrames === outputFrames
			&& cached.channels.length === channels.length && delta >= 0
			&& delta % sampleStride === 0 ? Math.max(0, visualFrames - delta / sampleStride) : 0;
		if (overlap > 0 && cached) {
			for (let channel = 0; channel < channels.length; channel += 1) {
				channels[channel]!.set(cached.channels[channel]!.subarray(visualFrames - overlap));
			}
		}
		const scanRanges = peakMode && overlap > 0
			? [[0, 1], [overlap - 1, overlap], [overlap, visualFrames]]
			: [[overlap, visualFrames]];
		const activeChunks = new Map<number, AudioChunk>();
		const requestedChunks = new Set<number>();
		async function loadChunk(index: number): Promise<AudioChunk> {
			if (!requestedChunks.has(index)) {
				if (requestedChunks.size >= maximumChunks) {
					throw new RangeError('A sound visualizer window spans too many PCM chunks.');
				}
				requestedChunks.add(index);
			}
			const chunk = await readChunk(audioSource, index, signal);
			activeChunks.set(index, chunk);
			while (activeChunks.size > 2) {
				const oldest = activeChunks.keys().next().value;
				if (oldest === undefined) break;
				activeChunks.delete(oldest);
			}
			return chunk;
		}
		const transition = {
			fadeInFrames: nearest.fadeInFrames, fadeOutFrames: nearest.fadeOutFrames,
			fadeInShape: nearest.fadeInShape, fadeOutShape: nearest.fadeOutShape,
			crossfadeInRanges: [], crossfadeOutRanges: [],
		};
		for (const [start, end] of scanRanges) for (let index = start!; index < end!; index += 1) {
			if ((index & 4_095) === 0) throwIfAborted(signal);
			const sampleIndex = spectrumStarts && outputFrames > SOUND_VISUALIZER_SPECTRUM_SIZE
				? spectrumStarts[Math.floor(index / SOUND_VISUALIZER_SPECTRUM_SIZE)]!
					+ index % SOUND_VISUALIZER_SPECTRUM_SIZE : index;
			const binStart = windowStartFrame + sampleIndex * sampleStride;
			const first = peakMode ? Math.max(requestedWindowStart, binStart) : binStart;
			const last = peakMode ? Math.min(requestedWindowEnd, binStart + sampleStride) : binStart + 1;
			if (last <= nearest.start || first >= nearest.end) {
				for (const channel of channels) channel[index] = 0;
				continue;
			}
			let minimum0 = Number.POSITIVE_INFINITY;
			let maximum0 = Number.NEGATIVE_INFINITY;
			let minimum1 = Number.POSITIVE_INFINITY;
			let maximum1 = Number.NEGATIVE_INFINITY;
			for (let frame = first; frame < last; frame += 1) {
				if (frame < nearest.start || frame >= nearest.end) {
					minimum0 = Math.min(minimum0, 0);
					maximum0 = Math.max(maximum0, 0);
					minimum1 = Math.min(minimum1, 0);
					maximum1 = Math.max(maximum1, 0);
					continue;
				}
				const position = sourcePosition(nearest, frame);
				const local = frame - nearest.start;
				const gain = nearest.gain * nearest.envelopeAt(local)
					* evaluateClipTransitionGainAt(local, nearest.end - nearest.start, transition);
				const lower = Math.floor(position);
				const fraction = position - lower;
				const upper = fraction === 0 ? lower : Math.min(nearest.sourceEnd - 1, lower + 1);
				const lowerIndex = Math.floor(lower / audioSource.chunkFrames);
				const upperIndex = Math.floor(upper / audioSource.chunkFrames);
				const lowerChunk = activeChunks.get(lowerIndex) ?? await loadChunk(lowerIndex);
				const upperChunk = lowerIndex === upperIndex ? lowerChunk
					: activeChunks.get(upperIndex) ?? await loadChunk(upperIndex);
				if (downmix) {
					let sum = 0;
					for (let channel = 0; channel < sourceChannels; channel += 1) {
						const a = chunkSample(audioSource, lowerChunk, channel, lower);
						const b = chunkSample(audioSource, upperChunk, channel, upper);
						sum += a + (b - a) * fraction;
					}
					const value = sum * gain / sourceChannels;
					minimum0 = Math.min(minimum0, value);
					maximum0 = Math.max(maximum0, value);
				} else {
					for (let channel = 0; channel < visualChannels; channel += 1) {
						const a = chunkSample(audioSource, lowerChunk, channel, lower);
						const b = chunkSample(audioSource, upperChunk, channel, upper);
						const value = (a + (b - a) * fraction) * gain;
						if (generator.mode === 'spectrum') {
							channels[channel]![index] = value;
						} else if (channel === 0) {
							minimum0 = Math.min(minimum0, value);
							maximum0 = Math.max(maximum0, value);
						} else {
							minimum1 = Math.min(minimum1, value);
							maximum1 = Math.max(maximum1, value);
						}
					}
				}
			}
			if (generator.mode === 'spectrum') continue;
			channels[0]![index] = Number.isFinite(minimum0) ? minimum0 : 0;
			if (peakMode) {
				channels[1]![index] = Number.isFinite(maximum0) ? maximum0 : 0;
				if (visualChannels === 2) {
					channels[2]![index] = Number.isFinite(minimum1) ? minimum1 : 0;
					channels[3]![index] = Number.isFinite(maximum1) ? maximum1 : 0;
				}
			} else if (visualChannels === 2) {
				channels[1]![index] = Number.isFinite(minimum1) ? minimum1 : 0;
			}
		}
		throwIfAborted(signal);
		waveformWindow = generator.mode === 'waveform' ? Object.freeze({
			binding: nearest, frameCount, sampleStride, outputFrames, windowStartFrame,
			channels: Object.freeze(channels.map((channel) => channel.slice())),
		}) : null;
		return Object.freeze({ ...base, channels: Object.freeze(channels) });
	}

	return Object.freeze({
		window,
		dispose(): void {
			disposed = true;
			chunkCache.clear();
			cachedChunkBytes = 0;
			waveformWindow = null;
			bindingsBySequence.clear();
		},
	});
}

function binding(project: Data, clip: Data, sourceValue: Data): AudioBinding {
	const source: AudioSource = Object.freeze({
		id: id(sourceValue.id, 'audio source ID'),
		storageKey: id(sourceValue.storageKey ?? sourceValue.id, 'audio storage key'),
		frameCount: positiveInteger(sourceValue.frameCount, 'audio source frame count'),
		channelCount: boundedInteger(sourceValue.channelCount, 1, 32, 'audio source channel count'),
		chunkFrames: positiveInteger(sourceValue.chunkFrames ?? AUDIO_EDITOR_STORAGE_CHUNK_FRAMES,
			'audio source chunk frames'),
	});
	const resolved = resolveRuntimeClipProjection(project as RuntimeClipProject, clip as RuntimePersistedClip);
	if (resolved.sourceEndFrame > source.frameCount) {
		throw new RangeError(`Sound visualizer audio clip ${String(clip.id)} exceeds its PCM source.`);
	}
	const gain = finiteNonNegative(clip.gain ?? 1, 'audio clip gain')
		* (clip.inverted === true ? -1 : 1);
	const envelope = Array.isArray(clip.envelope) ? clip.envelope : [];
	const warp = clip.warpMap == null ? null : createAudioWarpRuntimeEvaluator(
		project as unknown as AudioWarpRuntimeProject, resolved as unknown as AudioWarpRuntimeClip,
	);
	return Object.freeze({
		id: id(clip.id, 'audio clip ID'),
		source, start: resolved.timelineStartFrame, end: resolved.timelineEndFrame,
		sourceStart: resolved.sourceStartFrame, sourceEnd: resolved.sourceEndFrame,
		gain, reversed: clip.reversed === true,
		fadeInFrames: nonNegativeInteger(clip.fadeInFrames ?? 0, 'audio fade in'),
		fadeOutFrames: nonNegativeInteger(clip.fadeOutFrames ?? 0, 'audio fade out'),
		fadeInShape: optionalNonNegative(clip.fadeInShape, 'audio fade in shape'),
		fadeOutShape: optionalNonNegative(clip.fadeOutShape, 'audio fade out shape'),
		envelopeAt: createEnvelopeValueEvaluator(envelope, resolved.durationFrames),
		warp,
	});
}

function selectNearest(bindings: readonly AudioBinding[], frame: number): AudioBinding | null {
	let best: AudioBinding | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const candidate of bindings) {
		const distance = frame < candidate.start ? candidate.start - frame
			: frame >= candidate.end ? frame - candidate.end + 1 : 0;
		if (distance < bestDistance || (distance === bestDistance && best
			&& (candidate.start < best.start || (candidate.start === best.start && candidate.id < best.id)))) {
			best = candidate;
			bestDistance = distance;
		}
	}
	return best;
}

function sourcePosition(binding: AudioBinding, frame: number): number {
	const local = frame - binding.start;
	const duration = binding.end - binding.start;
	const mapped = binding.warp
		? (() => {
			const point = binding.warp.sourceAtTimelineFrame(frame);
			return point.num / point.den;
		})()
		: binding.reversed
			? binding.sourceEnd - 1 - local * (binding.sourceEnd - binding.sourceStart) / duration
			: binding.sourceStart + local * (binding.sourceEnd - binding.sourceStart) / duration;
	return Math.max(binding.sourceStart, Math.min(binding.sourceEnd - 1, mapped));
}

function chunkSample(
	source: AudioSource,
	chunk: AudioChunk,
	channel: number,
	frame: number,
): number {
	const index = Math.floor(frame / source.chunkFrames);
	const sample = chunk.channels[channel]?.[frame - index * source.chunkFrames];
	if (sample === undefined || !Number.isFinite(sample)) {
		throw new RangeError(`Sound visualizer source ${source.id} contains unavailable PCM.`);
	}
	return sample;
}

function record(value: unknown, name: string): Data {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Data;
}

function records(value: unknown, name: string): readonly Data[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item) => record(item, name));
}

function strings(value: unknown, name: string): readonly string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item)) {
		throw new TypeError(`${name} must contain IDs.`);
	}
	return value as readonly string[];
}

function id(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value) throw new TypeError(`${name} is required.`);
	return value;
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be positive.`);
	return Number(value);
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

function roundedNonNegativeSample(value: unknown, name: string): number {
	const rounded = Math.round(finiteNonNegative(value, name));
	if (!Number.isSafeInteger(rounded)) throw new RangeError(`${name} must round to a safe integer.`);
	return rounded;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, name: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
		throw new RangeError(`${name} must be between ${String(minimum)} and ${String(maximum)}.`);
	}
	return number;
}

function finiteNonNegative(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new RangeError(`${name} must be finite and non-negative.`);
	}
	return value;
}

function optionalNonNegative(value: unknown, name: string): number | undefined {
	return value === undefined ? undefined : finiteNonNegative(value, name);
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw signal.reason ?? new DOMException('Sound visualizer PCM read was aborted.', 'AbortError');
}
