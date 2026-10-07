/* SPDX-License-Identifier: AGPL-3.0-only */

import { encodeMorseCode, morseCodeDotSeconds, morseCodeKeying } from './morse-code.ts';
import { createNoiseBlockRenderer } from './signal-generator-noise.ts';

export const AUDIO_EDITOR_GENERATOR_TYPES = Object.freeze(['silence', 'tone', 'chirp', 'noise', 'dtmf', 'morse'] as const);
export type AudioEditorGeneratorType = typeof AUDIO_EDITOR_GENERATOR_TYPES[number];
type Options = Readonly<Record<string, unknown>>;
type Waveform = 'sine' | 'square' | 'sawtooth';
type MonoBlock = (frames: number, start: number) => Float32Array;
interface PreparedSignal {
	readonly frameCount: number;
	readonly render: (frames: number, start: number) => Float32Array[];
}

export interface AudioEditorSignalRenderer {
	readonly type: AudioEditorGeneratorType;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
	/** Caller owns each block, including its transferable channel buffers. */
	next(blockFrames: number): readonly Float32Array[] | null;
}

const WAVEFORMS = Object.freeze(['sine', 'square', 'sawtooth'] as const);
const MAX_SECONDS = 24 * 60 * 60;
// Repeated long DTMF tones must not turn a bounded job into a whole-signal cache.
const MAX_DTMF_CACHE_FRAMES = 16_384;
const MAX_DTMF_CACHED_TONES = 16;
const DTMF: Readonly<Record<string, readonly [number, number]>> = Object.freeze({
	'1': [697, 1209], '2': [697, 1336], '3': [697, 1477], A: [697, 1633],
	'4': [770, 1209], '5': [770, 1336], '6': [770, 1477], B: [770, 1633],
	'7': [852, 1209], '8': [852, 1336], '9': [852, 1477], C: [852, 1633],
	'*': [941, 1209], '0': [941, 1336], '#': [941, 1477], D: [941, 1633],
});

/** Validate the complete job before rendering and emit bounded, independent blocks. */
export function createAudioEditorSignalRenderer(type: string, options: Options = {}): AudioEditorSignalRenderer {
	if (!(AUDIO_EDITOR_GENERATOR_TYPES as readonly string[]).includes(type)) throw new RangeError(`Unsupported audio generator: ${type}.`);
	const sampleRate = positiveInteger(options.sampleRate ?? 48_000, 'sampleRate');
	const channelCount = integerInRange(options.channelCount ?? 1, 1, 32, 'channelCount');
	const prepared = type === 'dtmf' ? prepareDtmf(options, sampleRate, channelCount)
		: type === 'morse' ? prepareMorse(options, sampleRate, channelCount)
		: prepareFixed(type, options, sampleRate, channelCount);
	let offset = 0;
	return Object.freeze({
		type: type as AudioEditorGeneratorType, sampleRate, channelCount, frameCount: prepared.frameCount,
		next(blockFrames: number) {
			const requested = positiveInteger(blockFrames, 'blockFrames');
			if (offset === prepared.frameCount) return null;
			const frames = Math.min(requested, prepared.frameCount - offset);
			const channels = prepared.render(frames, offset);
			offset += frames;
			return Object.freeze(channels);
		},
	});
}

function prepareFixed(type: string, options: Options, sampleRate: number, channelCount: number): PreparedSignal {
	const duration = finiteInRange(options.durationSeconds ?? 1, 1 / sampleRate, MAX_SECONDS, 'durationSeconds');
	const frameCount = boundedFrameCount(duration, sampleRate);
	if (type === 'silence') return { frameCount, render: (frames) => Array.from({ length: channelCount }, () => new Float32Array(frames)) };
	if (type === 'tone') {
		const amplitude = finiteInRange(options.amplitude ?? 0.8, 0, 1, 'amplitude');
		const frequency = finiteInRange(options.frequency ?? 440, 0.01, sampleRate / 2, 'frequency');
		const waveform = enumValue(options.waveform ?? 'sine', WAVEFORMS, 'waveform');
		const oscillate = waveformOscillator(waveform);
		let phase = 0;
		const step = frequency / sampleRate;
		return monoSignal(frameCount, channelCount, (frames) => {
			const output = new Float32Array(frames);
			let currentPhase = phase;
			for (let frame = 0; frame < frames; frame += 1) {
				output[frame] = amplitude * oscillate(currentPhase);
				currentPhase += step;
				if (currentPhase >= 1) currentPhase -= 1;
			}
			phase = currentPhase;
			return output;
		});
	}
	if (type === 'chirp') {
		const startFrequency = finiteInRange(options.startFrequency ?? 440, 0.01, sampleRate / 2, 'startFrequency');
		const endFrequency = finiteInRange(options.endFrequency ?? 1_320, 0.01, sampleRate / 2, 'endFrequency');
		const startAmplitude = finiteInRange(options.startAmplitude ?? options.amplitude ?? 0.8, 0, 1, 'startAmplitude');
		const endAmplitude = finiteInRange(options.endAmplitude ?? options.amplitude ?? 0.8, 0, 1, 'endAmplitude');
		const interpolation = enumValue(options.interpolation ?? 'logarithmic', ['linear', 'logarithmic'], 'interpolation');
		const waveform = enumValue(options.waveform ?? 'sine', WAVEFORMS, 'waveform');
		const oscillate = waveformOscillator(waveform);
		const frequencyDifference = endFrequency - startFrequency;
		const frequencyRatio = endFrequency / startFrequency;
		const frequencyAt = interpolation === 'linear'
			? (progress: number) => startFrequency + frequencyDifference * progress
			: (progress: number) => startFrequency * frequencyRatio ** progress;
		const amplitudeDifference = endAmplitude - startAmplitude;
		let phase = 0;
		return monoSignal(frameCount, channelCount, (frames, start) => {
			const output = new Float32Array(frames);
			let currentPhase = phase;
			for (let frame = 0; frame < frames; frame += 1) {
				const progress = frameCount <= 1 ? 0 : (start + frame) / (frameCount - 1);
				const frequency = frequencyAt(progress);
				const amplitude = startAmplitude + amplitudeDifference * progress;
				output[frame] = amplitude * oscillate(currentPhase);
				currentPhase += frequency / sampleRate;
				if (currentPhase >= 1) currentPhase -= 1;
			}
			phase = currentPhase;
			return output;
		});
	}
	const amplitude = finiteInRange(options.amplitude ?? 0.8, 0, 1, 'amplitude');
	const color = enumValue(options.color ?? 'white', ['white', 'pink', 'brown'] as const, 'color');
	const seed = (Number(options.seed ?? 0x6d2b_79f5) >>> 0) || 1;
	return { frameCount, render: createNoiseBlockRenderer(frameCount, channelCount, amplitude, color, seed, sampleRate) };
}

function prepareDtmf(options: Options, sampleRate: number, channelCount: number): PreparedSignal {
	const sequence = String(options.sequence ?? '123').toUpperCase().replace(/[\s,-]+/g, '');
	if (!sequence.length || [...sequence].some((symbol) => !DTMF[symbol])) throw new RangeError('DTMF sequence contains an unsupported symbol.');
	const toneSeconds = finiteInRange(options.toneSeconds ?? 0.1, 1 / sampleRate, MAX_SECONDS, 'toneSeconds');
	const silenceSeconds = finiteInRange(options.silenceSeconds ?? 0.05, 0, MAX_SECONDS, 'silenceSeconds');
	const amplitude = finiteInRange(options.amplitude ?? 0.8, 0, 1, 'amplitude');
	const toneFrames = boundedFrameCount(toneSeconds, sampleRate);
	const silenceFrames = Math.round(silenceSeconds * sampleRate);
	const naturalFrames = sequence.length * toneFrames + Math.max(0, sequence.length - 1) * silenceFrames;
	const naturalDuration = sequence.length * toneSeconds + Math.max(0, sequence.length - 1) * silenceSeconds;
	const scaledDuration = options.durationSeconds !== undefined;
	const frameCount = !scaledDuration ? naturalFrames
		: boundedFrameCount(finiteInRange(options.durationSeconds, 1 / sampleRate, MAX_SECONDS, 'durationSeconds'), sampleRate);
	if (!Number.isSafeInteger(frameCount) || frameCount <= 0 || frameCount > 0x7fff_ffff) throw new RangeError('DTMF output is too large.');
	const tones = new Map<string, Float32Array>();
	let symbolIndex = 0;
	function fillTone(output: Float32Array, destination: number, start: number, frames: number,
		symbol: string, symbolFrames: number): void {
		const [low, high] = DTMF[symbol]!;
		const fadeFrames = Math.min(Math.round(sampleRate * 0.005), Math.floor(symbolFrames / 2));
		for (let index = 0; index < frames; index += 1) {
			const frame = start + index;
			const fade = fadeFrames ? Math.min(1, (frame + 1) / fadeFrames, (symbolFrames - frame) / fadeFrames) : 1;
			output[destination + index] = amplitude * fade * 0.5 * (
				Math.sin(2 * Math.PI * low * frame / sampleRate) + Math.sin(2 * Math.PI * high * frame / sampleRate)
			);
		}
	}
	return monoSignal(frameCount, channelCount, (frames, start) => {
		const output = new Float32Array(frames);
		const end = start + frames;
		while (symbolIndex < sequence.length) {
			const toneStart = !scaledDuration ? symbolIndex * (toneFrames + silenceFrames)
				: Math.round(symbolIndex * (toneSeconds + silenceSeconds) / naturalDuration * frameCount);
			const toneEnd = !scaledDuration ? toneStart + toneFrames
				: symbolIndex === sequence.length - 1 ? frameCount
				: Math.round((symbolIndex * (toneSeconds + silenceSeconds) + toneSeconds) / naturalDuration * frameCount);
			if (toneStart >= end) break;
			const localStart = Math.max(start, toneStart) - toneStart;
			const toneCount = Math.min(end, toneEnd) - Math.max(start, toneStart);
			if (toneCount > 0) {
				const symbol = sequence[symbolIndex]!;
				const symbolFrames = toneEnd - toneStart;
				const key = `${symbol}:${symbolFrames}`;
				let cached = tones.get(key);
				if (!cached && symbolFrames <= MAX_DTMF_CACHE_FRAMES && tones.size < MAX_DTMF_CACHED_TONES) {
					cached = new Float32Array(symbolFrames);
					fillTone(cached, 0, 0, symbolFrames, symbol, symbolFrames);
					tones.set(key, cached);
				}
				const destination = Math.max(start, toneStart) - start;
				if (cached) output.set(cached.subarray(localStart, localStart + toneCount), destination);
				else fillTone(output, destination, localStart, toneCount, symbol, symbolFrames);
			}
			if (toneEnd > end) break;
			symbolIndex += 1;
		}
		return output;
	});
}

function prepareMorse(options: Options, sampleRate: number, channelCount: number): PreparedSignal {
	const words = encodeMorseCode(options.text ?? 'SOS');
	const wordsPerMinute = finiteInRange(options.wordsPerMinute ?? 20, 1, 120, 'wordsPerMinute');
	const frequency = finiteInRange(options.frequency ?? 700, 0.01, sampleRate / 2, 'frequency');
	const amplitude = finiteInRange(options.amplitude ?? 0.8, 0, 1, 'amplitude');
	const segments = morseCodeKeying(words);
	const dotSeconds = morseCodeDotSeconds(wordsPerMinute);
	const totalUnits = segments.reduce((total, segment) => total + segment.units, 0);
	if (totalUnits * dotSeconds > MAX_SECONDS) throw new RangeError('Morse output is too long.');
	const framesPerUnit = dotSeconds * sampleRate;
	const frameCount = boundedFrameCount(totalUnits * dotSeconds, sampleRate);
	const rampFrames = Math.round(Math.min(0.005, dotSeconds / 4) * sampleRate);
	let unitOffset = 0;
	const schedule = segments.map((segment) => {
		const start = Math.round(unitOffset * framesPerUnit);
		unitOffset += segment.units;
		const end = Math.min(frameCount, Math.round(unitOffset * framesPerUnit));
		return { ...segment, start, end, edgeFrames: Math.min(rampFrames, Math.floor((end - start) / 2)) };
	});
	let segmentIndex = 0;
	return monoSignal(frameCount, channelCount, (frames, start) => {
		const output = new Float32Array(frames);
		const end = start + frames;
		while (segmentIndex < schedule.length) {
			const segment = schedule[segmentIndex]!;
			if (segment.start >= end) break;
			if (segment.tone) for (let frame = Math.max(start, segment.start); frame < Math.min(end, segment.end); frame += 1) {
				const ramp = segment.edgeFrames
					? Math.min(1, (frame - segment.start + 1) / segment.edgeFrames, (segment.end - frame) / segment.edgeFrames) : 1;
				output[frame - start] = amplitude * (ramp === 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * ramp))
					* Math.sin(2 * Math.PI * frequency * (frame - segment.start) / sampleRate);
			}
			if (segment.end > end) break;
			segmentIndex += 1;
		}
		return output;
	});
}

function monoSignal(frameCount: number, channelCount: number, monoBlock: MonoBlock): PreparedSignal {
	return { frameCount, render(frames, start) {
		const mono = monoBlock(frames, start);
		return Array.from({ length: channelCount }, (_, channel) => channel === 0 ? mono : new Float32Array(mono));
	} };
}

function waveformOscillator(waveform: Waveform): (phase: number) => number {
	if (waveform === 'square') return (phase) => phase < 0.5 ? 1 : -1;
	if (waveform === 'sawtooth') return (phase) => phase * 2 - 1;
	return (phase) => Math.sin(phase * Math.PI * 2);
}

function boundedFrameCount(seconds: number, sampleRate: number): number {
	const frames = Math.round(seconds * sampleRate);
	if (!Number.isSafeInteger(frames) || frames <= 0 || frames > 0x7fff_ffff) throw new RangeError('Generator output is too large.');
	return frames;
}

function finiteInRange(value: unknown, minimum: number, maximum: number, name: string): number {
	const number = Number(value);
	if (!Number.isFinite(number) || number < minimum || number > maximum) throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
	return number;
}

function positiveInteger(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return number;
}

function integerInRange(value: unknown, minimum: number, maximum: number, name: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
	return number;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
	if (typeof value !== 'string' || !allowed.includes(value as T)) throw new RangeError(`${name} must be one of: ${allowed.join(', ')}.`);
	return value as T;
}
