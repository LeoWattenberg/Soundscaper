import { createPlanarPcmChunkCoalescer } from '../pcm-chunks.js';
import { AUDIO_EDITOR_SAMPLE_RATE } from '../project.js';
import { createStreamingWindowedSincResampler } from '../resample.js';
import { isSourcePcmReadSessionReleasedError } from '../storage/source-pcm-read-session.ts';
import { downmixSurroundToStereo } from '../surround-monitoring.ts';
import { scaleSampleFrame } from '../timeline-time.ts';
import { abortError, throwIfAborted } from './app-helpers.ts';

export const SOURCE_CHUNK_FRAMES = 65_536;
export const SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES = 32 * 1024 * 1024;

export interface AudioBufferLike {
	readonly length: number;
	readonly numberOfChannels: number;
	readonly sampleRate: number;
	getChannelData(channel: number): Float32Array;
	copyToChannel?(source: Float32Array, channelNumber: number, startInChannel?: number): void;
}

interface AudioBufferContext {
	createBuffer?(channelCount: number, length: number, sampleRate: number): AudioBufferLike;
}

interface AudioCopy {
	readonly decodedAudioEmpty: string;
	readonly decodedChannelLengthsMismatch: string;
	readonly audacityProjectTooLong: string;
	readonly audioBufferUnsupported: string;
}

interface WritablePcmSource {
	readonly framesWritten?: unknown;
	write(channels: Float32Array[]): Promise<unknown> | unknown;
	commit(metadata?: Record<string, unknown>): Promise<unknown> | unknown;
	abort(reason?: unknown): Promise<unknown> | unknown;
}

export interface StoredAudioSource {
	readonly id: string;
	readonly storageKey?: string;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
	readonly chunkFrames?: number;
}

interface StoredSourceMetadata extends Record<string, unknown> {
	readonly id?: unknown;
	readonly frameCount?: unknown;
	readonly frameLength?: unknown;
	readonly channelCount?: unknown;
	readonly sampleRate?: unknown;
	readonly chunkFrames?: unknown;
	readonly chunkCount?: unknown;
}

interface StoredSourceReader {
	readSourceChunk(sourceId: string, chunkIndex: number, context?: Record<string, unknown>): Promise<unknown> | unknown;
	openSourceReadSession?(
		sourceId: string,
		options?: Readonly<{ signal?: AbortSignal; expectedSource?: StoredSourceMetadata }>,
	): PromiseLike<StoredSourceReadSession | null> | StoredSourceReadSession | null;
}

interface StoredSourceReadSession {
	chunk(chunkIndex: number, options?: Readonly<{ signal?: AbortSignal }>): Promise<unknown> | unknown;
	release(): Promise<void> | void;
}

interface ClipEnvelopePoint extends Record<string, unknown> {
	readonly frame: number;
}

interface ClipEnvelope {
	readonly durationFrames: number;
	readonly envelope?: ClipEnvelopePoint[];
}

interface AudacityNoiseProfile extends Record<string, unknown> {
	readonly meanPowers?: ArrayLike<number> | Iterable<number>;
}

export async function writeBuffer(
	writer: Pick<WritablePcmSource, 'write'>,
	buffer: AudioBufferLike,
	signal: AbortSignal | null = null,
): Promise<void> {
	for (let start = 0; start < buffer.length; start += SOURCE_CHUNK_FRAMES) {
		throwIfAborted(signal);
		const end = Math.min(buffer.length, start + SOURCE_CHUNK_FRAMES);
		await writer.write(Array.from(
			{ length: buffer.numberOfChannels },
			(_, channel) => buffer.getChannelData(channel).slice(start, end),
		));
	}
	throwIfAborted(signal);
}

export function createCoalescingSourceWriter(writer: WritablePcmSource) {
	if (!writer || typeof writer.write !== 'function' || typeof writer.commit !== 'function' || typeof writer.abort !== 'function') {
		throw new TypeError('A writable PCM source is required.');
	}
	const coalescer = createPlanarPcmChunkCoalescer({
		chunkFrames: SOURCE_CHUNK_FRAMES,
		onChunk: (channels: Float32Array[]) => writer.write(channels),
	});
	let commitPromise: Promise<unknown> | null = null;
	return Object.freeze({
		get framesWritten(): number {
			const storedFrames = Number(writer.framesWritten);
			return Math.max(coalescer.framesWritten, Number.isSafeInteger(storedFrames) ? storedFrames : 0);
		},
		get channelCount(): number {
			return coalescer.channelCount;
		},
		write(channels: Float32Array[]): Promise<unknown> {
			return coalescer.write(channels);
		},
		commit(metadata: Record<string, unknown> = {}): Promise<unknown> {
			const pending = commitPromise ||= coalescer.finalize()
				.then(() => writer.commit({ ...metadata, chunkFrames: SOURCE_CHUNK_FRAMES }));
			return pending;
		},
		abort(reason?: unknown): Promise<unknown> | unknown {
			coalescer.abort(reason);
			return writer.abort();
		},
	});
}

export async function readStoredAudioBuffer(
	store: { loadSourceAudioBuffer(sourceId: string, context: AudioBufferContext): Promise<AudioBufferLike | null> },
	source: Pick<StoredAudioSource, 'id' | 'storageKey'>,
	context: AudioBufferContext | null | undefined,
): Promise<AudioBufferLike | null> {
	if (!context?.createBuffer) return null;
	return store.loadSourceAudioBuffer(source.storageKey || source.id, context);
}

export function sourceAudioBufferBytes(buffer: { readonly length?: unknown; readonly numberOfChannels?: unknown } | null | undefined): number {
	const length = Number(buffer?.length);
	const channelCount = Number(buffer?.numberOfChannels);
	if (!Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(channelCount) || channelCount < 0) return Infinity;
	const bytes = length * channelCount * Float32Array.BYTES_PER_ELEMENT;
	return Number.isSafeInteger(bytes) ? bytes : Infinity;
}

export function sourcePcmBytes(source: { readonly frameCount?: unknown; readonly channelCount?: unknown } | null | undefined): number {
	const frameCount = Number(source?.frameCount);
	const channelCount = Number(source?.channelCount);
	if (!Number.isSafeInteger(frameCount) || frameCount < 0 || !Number.isSafeInteger(channelCount) || channelCount < 0) return Infinity;
	const bytes = frameCount * channelCount * Float32Array.BYTES_PER_ELEMENT;
	return Number.isSafeInteger(bytes) ? bytes : Infinity;
}

export function normalizeByteLimit(value: unknown, fallback: number): number {
	const limit = value == null ? fallback : Number(value);
	if (!Number.isSafeInteger(limit) || limit < 0) {
		throw new RangeError('A memory limit must be a non-negative safe integer byte count.');
	}
	return limit;
}

export function isStreamableStoredSource(
	source: StoredAudioSource | null | undefined,
	metadata: StoredSourceMetadata | null | undefined,
): boolean {
	if (!metadata || typeof metadata !== 'object') return false;
	if (typeof metadata.id !== 'string' || typeof source?.id !== 'string') return false;
	if (!Number.isSafeInteger(source.frameCount) || !Number.isSafeInteger(source.channelCount)) return false;
	const chunkFrames = Object.hasOwn(metadata, 'chunkFrames') ? metadata.chunkFrames : source.chunkFrames;
	if (!Number.isSafeInteger(chunkFrames) || Number(chunkFrames) <= 0 || Number(chunkFrames) > SOURCE_CHUNK_FRAMES) return false;
	if ((metadata.frameCount ?? metadata.frameLength) !== source.frameCount || metadata.channelCount !== source.channelCount) return false;
	if (metadata.sampleRate != null && metadata.sampleRate !== source.sampleRate) return false;
	return metadata.chunkCount === Math.ceil(source.frameCount / Number(chunkFrames));
}

export function createStoredChunkProvider(
	store: StoredSourceReader,
	source: StoredAudioSource,
	metadata: StoredSourceMetadata,
) {
	if (typeof store.readSourceChunk !== 'function') throw new TypeError('The project store cannot demand-load source chunks.');
	const sourceId = source.storageKey || source.id;
	const lifetime = new AbortController();
	const disposedError = new Error('The stored source chunk provider was disposed.');
	disposedError.name = STORED_CHUNK_PROVIDER_DISPOSED_ERROR_NAME;
	let disposed = false;
	let opening: Promise<StoredSourceReadSession | null> | null = null;
	let disposal: Promise<void> | null = null;
	const openSession = (): Promise<StoredSourceReadSession | null> => {
		if (opening) return opening;
		try {
			opening = Promise.resolve(store.openSourceReadSession?.(sourceId, {
				signal: lifetime.signal,
				expectedSource: metadata,
			}) ?? null);
		} catch (error) {
			opening = Promise.reject(error);
		}
		return opening;
	};
	// Storage maintenance and required-source preparation both release live read
	// sessions, and a release is a lifetime event rather than a data fault. A
	// long render that happens to be mid-read would otherwise fail outright, so
	// an undisposed provider reopens its session once and repeats the read; the
	// reopened session revalidates the same expected source identity.
	const readSessionChunk = async (
		chunkIndex: number,
		context: Record<string, unknown>,
	): Promise<unknown> => {
		const signal = validAbortSignal(context.signal);
		for (let attempt = 0; ; attempt += 1) {
			const pending = openSession();
			const session = await waitForStoredSourceSession(pending, signal);
			if (disposed) throw disposedError;
			if (!session) return store.readSourceChunk(sourceId, chunkIndex, context);
			try {
				return await session.chunk(chunkIndex, signal ? { signal } : {});
			} catch (error) {
				if (attempt > 0 || disposed || signal?.aborted
					|| !isSourcePcmReadSessionReleasedError(error)) throw error;
				if (opening === pending) opening = null;
			}
		}
	};
	const dispose = (): Promise<void> => {
		if (disposal) return disposal;
		disposed = true;
		lifetime.abort(disposedError);
		disposal = releaseStoredSourceSession(opening);
		return disposal;
	};
	return Object.freeze({
		channelCount: source.channelCount,
		frameCount: source.frameCount,
		chunkFrames: Number(Object.hasOwn(metadata, 'chunkFrames') ? metadata.chunkFrames : source.chunkFrames),
		sampleRate: source.sampleRate,
		storageKey: sourceId,
		readStorageChunk(chunkIndex: number, context: Record<string, unknown> = {}): Promise<unknown> | unknown {
			if (disposed) throw disposedError;
			if (store.openSourceReadSession) return readSessionChunk(chunkIndex, context);
			return store.readSourceChunk(sourceId, chunkIndex, context);
		},
		dispose,
	});
}

/**
 * Decide whether a live provider already serves exactly this stored source.
 *
 * Providers own a read session, so replacing one retires the session a render
 * may still be reading through. Stored sources are immutable under their id, so
 * an equivalent live provider is reused instead of rebuilt and the render keeps
 * the object it started with.
 */
export const STORED_CHUNK_PROVIDER_DISPOSED_ERROR_NAME = 'StoredSourceChunkProviderDisposedError';

/**
 * Recognise a read that failed only because its provider was retired.
 *
 * Retiring a provider is routine bookkeeping — a required source that switches
 * to a cached buffer drops its provider — and it releases the read session with
 * it. A speculative reader such as a waveform window has nothing to report to
 * the user for that: it drops the result and asks again against the successor.
 */
export function isRetiredSourceReadError(error: unknown): boolean {
	if (isSourcePcmReadSessionReleasedError(error)) return true;
	return typeof error === 'object' && error !== null
		&& (error as Readonly<{ name?: unknown }>).name === STORED_CHUNK_PROVIDER_DISPOSED_ERROR_NAME;
}

export function matchesStoredChunkProvider(
	provider: unknown,
	source: StoredAudioSource,
	metadata: StoredSourceMetadata,
): boolean {
	if (!provider || typeof provider !== 'object') return false;
	const candidate = provider as Readonly<Record<string, unknown>>;
	const chunkFrames = Number(Object.hasOwn(metadata, 'chunkFrames') ? metadata.chunkFrames : source.chunkFrames);
	return candidate.storageKey === (source.storageKey || source.id)
		&& candidate.channelCount === source.channelCount
		&& candidate.frameCount === source.frameCount
		&& candidate.sampleRate === source.sampleRate
		&& candidate.chunkFrames === chunkFrames
		&& typeof candidate.readStorageChunk === 'function';
}

async function releaseStoredSourceSession(
	opening: Promise<StoredSourceReadSession | null> | null,
): Promise<void> {
	if (!opening) return;
	let session: StoredSourceReadSession | null;
	try {
		session = await opening;
	} catch (error) {
		if (error instanceof AggregateError) throw error;
		return;
	}
	await session?.release();
}

function waitForStoredSourceSession(
	opening: Promise<StoredSourceReadSession | null>,
	signal?: AbortSignal,
): Promise<StoredSourceReadSession | null> {
	if (!signal) return opening;
	if (signal.aborted) return Promise.reject(signal.reason ?? abortError());
	return new Promise((resolve, reject) => {
		let settled = false;
		const settle = (operation: () => void) => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', onAbort);
			operation();
		};
		const onAbort = () => {
			settle(() => { reject(signal.reason ?? abortError()); });
		};
		signal.addEventListener('abort', onAbort, { once: true });
		void opening.then(
			(session) => { settle(() => { resolve(session); }); },
			(error: unknown) => { settle(() => { reject(error); }); },
		);
	});
}

function validAbortSignal(value: unknown): AbortSignal | undefined {
	if (!value || typeof value !== 'object') return undefined;
	const signal = value as Partial<AbortSignal>;
	return typeof signal.aborted === 'boolean'
		&& typeof signal.addEventListener === 'function'
		&& typeof signal.removeEventListener === 'function'
		? value as AbortSignal
		: undefined;
}

export async function canonicalizeBuffer(
	input: AudioBufferLike,
	context: AudioBufferContext | null | undefined,
	targetSampleRate: number | null = AUDIO_EDITOR_SAMPLE_RATE,
	copy: AudioCopy,
): Promise<AudioBufferLike> {
	if (!input?.numberOfChannels || !input?.length) throw new Error(copy.decodedAudioEmpty);
	let channels: Float32Array[];
	if (input.numberOfChannels <= 2) {
		channels = Array.from({ length: input.numberOfChannels }, (_, channel) => input.getChannelData(channel));
	} else if (input.numberOfChannels === 6) {
		channels = [...downmixSurroundToStereo(
			Array.from({ length: input.numberOfChannels }, (_, channel) => input.getChannelData(channel)),
		)];
	} else {
		const left = new Float32Array(input.length);
		const right = new Float32Array(input.length);
		const sourceChannels = Array.from({ length: input.numberOfChannels }, (_, channel) => input.getChannelData(channel));
		const normalization = 1 + Math.max(0, input.numberOfChannels - 2) * 0.5;
		for (let frame = 0; frame < input.length; frame += 1) {
			left[frame] = sourceChannels[0]![frame]!;
			right[frame] = sourceChannels[1]?.[frame] ?? sourceChannels[0]![frame]!;
			for (let channel = 2; channel < sourceChannels.length; channel += 1) {
				if (channel % 2 === 0) left[frame] += sourceChannels[channel]![frame]! * 0.5;
				else right[frame] += sourceChannels[channel]![frame]! * 0.5;
			}
			left[frame] /= normalization;
			right[frame] /= normalization;
		}
		channels = [left, right];
	}
	if ((targetSampleRate == null || input.sampleRate === targetSampleRate) && input.numberOfChannels <= 2) return input;
	const downmixed = await bufferFromChannels(channels, input.sampleRate, context, copy);
	return targetSampleRate == null || input.sampleRate === targetSampleRate
		? downmixed
		: resampleBuffer(downmixed, targetSampleRate, context, copy);
}

export async function bufferFromChannels(
	channels: Float32Array[],
	sampleRate: number,
	context: AudioBufferContext | null | undefined,
	copy: AudioCopy,
): Promise<AudioBufferLike> {
	if (!channels?.length || !channels[0]?.length) throw new Error(copy.decodedAudioEmpty);
	const buffer = await createAudioBuffer(channels.length, channels[0].length, sampleRate, context, copy);
	for (let channel = 0; channel < channels.length; channel += 1) {
		if (channels[channel]!.length !== channels[0].length) throw new Error(copy.decodedChannelLengthsMismatch);
		if (buffer.copyToChannel) buffer.copyToChannel(channels[channel]!, channel);
		else buffer.getChannelData(channel).set(channels[channel]!);
	}
	return buffer;
}

export async function resampleBuffer(
	input: AudioBufferLike,
	sampleRate: number,
	context: AudioBufferContext | null | undefined,
	copy: AudioCopy,
	outputFrames: number | null = null,
): Promise<AudioBufferLike> {
	if (outputFrames !== null && (!Number.isSafeInteger(outputFrames) || outputFrames < 1)) {
		throw new RangeError('Resampled output frames must be a positive safe integer.');
	}
	if (input.sampleRate === sampleRate && (outputFrames === null || outputFrames === input.length)) return input;
	const length = outputFrames ?? Math.max(1, scaleSampleFrame(
		input.length, input.sampleRate, sampleRate, 'point',
	));
	const sourceChannels = Array.from({ length: input.numberOfChannels }, (_, channel) => input.getChannelData(channel));
	const channels = resampleChannelsWindowedSinc(sourceChannels, input.sampleRate, sampleRate, length);
	return bufferFromChannels(channels, sampleRate, context, copy);
}

export function resampleChannelsWindowedSinc(
	channels: Float32Array[],
	inputSampleRate: number,
	outputSampleRate: number,
	outputFrames: number,
): Float32Array[] {
	const resampler = createStreamingWindowedSincResampler(inputSampleRate, outputSampleRate, channels.length) as {
		push(value: Float32Array[]): Float32Array[];
		finish(requestedOutputFrames?: number | null): Float32Array[];
	};
	const head = resampler.push(channels) as Float32Array[];
	const tail = resampler.finish(outputFrames) as Float32Array[];
	return head.map((values, channel) => {
		const output = new Float32Array(values.length + tail[channel]!.length);
		output.set(values);
		output.set(tail[channel]!, values.length);
		return output.length === outputFrames ? output : output.slice(0, outputFrames);
	});
}

export async function createAudioBuffer(
	channelCount: number,
	length: number,
	sampleRate: number,
	context: AudioBufferContext | null | undefined,
	copy: AudioCopy,
): Promise<AudioBufferLike> {
	if (context?.createBuffer) return context.createBuffer(channelCount, length, sampleRate);
	if (typeof globalThis.AudioBuffer === 'function') {
		return new globalThis.AudioBuffer({ numberOfChannels: channelCount, length, sampleRate });
	}
	const globalAudio = globalThis as typeof globalThis & {
		readonly webkitAudioContext?: typeof AudioContext;
	};
	const Context = globalThis.AudioContext || globalAudio.webkitAudioContext;
	if (!Context) throw new Error(copy.audioBufferUnsupported);
	const temporary = new Context({ sampleRate });
	const buffer = temporary.createBuffer(channelCount, length, sampleRate);
	await temporary.close?.();
	return buffer;
}

export function audioBufferChannels(buffer: AudioBufferLike): Float32Array[] {
	return Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
}

export function scaleClipEnvelope(clip: ClipEnvelope, durationFrames: number): ClipEnvelopePoint[] {
	const ratio = durationFrames / Math.max(1, clip.durationFrames);
	return (clip.envelope || []).map((point) => ({
		...point,
		frame: Math.max(0, Math.min(durationFrames, Math.round(point.frame * ratio))),
	})).filter((point, index, points) => index === 0 || point.frame > points[index - 1]!.frame);
}

export function serializeAudacityNoiseProfile(profile: AudacityNoiseProfile | null | undefined) {
	if (!profile) return null;
	return {
		...profile,
		meanPowers: Array.from(profile.meanPowers || []),
	};
}
