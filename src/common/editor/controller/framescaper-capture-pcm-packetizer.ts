/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	CapturePcmAudioPacket,
} from '../framescaper-capture-domain.ts';

const MAXIMUM_CAPTURE_AUDIO_CHANNELS = 32;
const MAXIMUM_CAPTURE_AUDIO_CHUNK_FRAMES = 16_384;

type AudioRole = 'microphone' | 'system-audio';

export interface CapturePcmChunk {
	readonly frameStart: number;
	readonly frames: number;
	readonly channels: readonly Float32Array[];
}

export interface FramescaperCapturePcmPacketizerOptions {
	readonly sessionId: string;
	readonly streamId: string;
	readonly role: AudioRole;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly receiptTime?: () => number;
}

export interface FramescaperCapturePcmPacketizer {
	readonly frameCount: number;
	readonly packetCount: number;
	expectPauseGap(): void;
	packet(chunk: CapturePcmChunk): Readonly<CapturePcmAudioPacket>;
}

/** Converts AudioWorklet planar chunks to immutable timestamped capture PCM. */
export function createFramescaperCapturePcmPacketizer(
	options: FramescaperCapturePcmPacketizerOptions,
): FramescaperCapturePcmPacketizer {
	const sessionId = canonicalId(options.sessionId, 'Capture session ID');
	const streamId = canonicalId(options.streamId, 'Capture stream ID');
	if (options.role !== 'microphone' && options.role !== 'system-audio') {
		throw new TypeError('Capture PCM role must be microphone or system-audio.');
	}
	const sampleRate = boundedPositiveInteger(options.sampleRate, 768_000, 'Capture PCM sample rate');
	const channelCount = boundedPositiveInteger(
		options.channelCount,
		MAXIMUM_CAPTURE_AUDIO_CHANNELS,
		'Capture PCM channel count',
	);
	const receiptTime = options.receiptTime ?? (() => globalThis.performance?.now?.() ?? Date.now());
	let sequence = 0;
	let capturedFrames = 0;
	let expectedInputFrame: number | null = null;
	let excludedPauseFrames = 0;
	let acceptsPauseGap = false;

	function expectPauseGap(): void {
		acceptsPauseGap = true;
	}

	function packet(chunk: CapturePcmChunk): Readonly<CapturePcmAudioPacket> {
		const frameStart = nonNegativeInteger(chunk?.frameStart, 'Capture PCM input frame start');
		const frames = boundedPositiveInteger(
			chunk?.frames,
			MAXIMUM_CAPTURE_AUDIO_CHUNK_FRAMES,
			'Capture PCM chunk frame count',
		);
		if (!Array.isArray(chunk.channels) || chunk.channels.length !== channelCount) {
			throw new Error('Capture PCM chunk channel count does not match its actual format.');
		}
		for (const channel of chunk.channels) {
			if (!(channel instanceof Float32Array) || channel.length !== frames) {
				throw new Error('Capture PCM channels must be bounded equal-length Float32 data.');
			}
		}
		if (expectedInputFrame !== null && frameStart < expectedInputFrame) {
			throw new Error('Capture PCM input chunks cannot overlap or move backward.');
		}
		const inputGapFrames = expectedInputFrame === null ? 0 : frameStart - expectedInputFrame;
		const droppedFrames = acceptsPauseGap ? 0 : inputGapFrames;
		if (acceptsPauseGap) {
			excludedPauseFrames = exactSum(
				excludedPauseFrames,
				inputGapFrames,
				'Capture PCM excluded pause frames',
			);
		}
		// Pause arms the latch synchronously while chunks arrive through a
		// serialized queue, so a contiguous pre-pause chunk can still land first.
		// Only a packet that actually carries a gap consumes the latch; otherwise
		// the real pause would later be classified as dropped frames.
		if (inputGapFrames > 0) acceptsPauseGap = false;
		expectedInputFrame = exactSum(frameStart, frames, 'Capture PCM input frame end');
		const presentationTimeUs = frameTimeMicroseconds(
			frameStart - excludedPauseFrames,
			sampleRate,
		);
		const durationUs = frameTimeMicroseconds(frames, sampleRate);
		const samples = new Float32Array(frames * channelCount);
		for (let frame = 0; frame < frames; frame += 1) {
			for (let channel = 0; channel < channelCount; channel += 1) {
				samples[frame * channelCount + channel] = chunk.channels[channel]![frame]!;
			}
		}
		const result: CapturePcmAudioPacket = Object.freeze({
			kind: 'pcm-audio', sessionId, streamId, role: options.role,
			sequence,
			presentationTimeUs,
			durationUs,
			receiptTimeMs: finiteNonNegative(receiptTime(), 'Capture PCM receipt time'),
			droppedBefore: Object.freeze({ value: droppedFrames, confidence: 'exact' }),
			frameCount: frames,
			sampleRate,
			channelCount,
			samples,
		});
		sequence = exactSum(sequence, 1, 'Capture PCM packet sequence');
		capturedFrames = exactSum(capturedFrames, frames, 'Capture PCM captured frame count');
		return result;
	}

	return Object.freeze({
		get frameCount(): number { return capturedFrames; },
		get packetCount(): number { return sequence; },
		expectPauseGap,
		packet,
	});
}

function canonicalId(value: string, name: string): string {
	if (typeof value !== 'string' || !value || value.length > 256 || value.trim() !== value) {
		throw new TypeError(`${name} must be a canonical non-empty string.`);
	}
	return value;
}

function boundedPositiveInteger(value: unknown, maximum: number, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
		throw new RangeError(`${name} must be a positive bounded integer.`);
	}
	return Number(value);
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative integer.`);
	}
	return Number(value);
}

function exactSum(left: number, right: number, name: string): number {
	const value = left + right;
	if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} exceeds the safe range.`);
	return value;
}

function frameTimeMicroseconds(frames: number, sampleRate: number): number {
	const value = Math.round(frames * 1_000_000 / sampleRate);
	if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Capture PCM time exceeds the safe range.');
	return value;
}

function finiteNonNegative(value: number, name: string): number {
	if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be finite and non-negative.`);
	return value;
}
