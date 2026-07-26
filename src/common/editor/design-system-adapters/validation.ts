import { AUDIO_EDITOR_SAMPLE_RATE } from '../project.js';
import type { FrameConversionOptions, NumericChannel } from './types.ts';

export const MAXIMUM_FRAME = Number.MAX_SAFE_INTEGER;

export function frameBounds(options: FrameConversionOptions): {
	readonly minimumFrame: number;
	readonly maximumFrame: number;
} {
	const minimumFrame = nonNegativeSafeInteger(options.minimumFrame ?? 0, 'minimumFrame');
	const maximumFrame = nonNegativeSafeInteger(options.maximumFrame ?? MAXIMUM_FRAME, 'maximumFrame');
	if (maximumFrame < minimumFrame) throw new RangeError('maximumFrame must not be below minimumFrame.');
	return { minimumFrame, maximumFrame };
}

export function normalizeSampleRate(value: unknown): number {
	const sampleRate = Number(value ?? AUDIO_EDITOR_SAMPLE_RATE);
	if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) {
		throw new RangeError('sampleRate must be a positive safe integer.');
	}
	return sampleRate;
}

export function validateSourceChannels(channels: readonly NumericChannel[]): number {
	if (!Array.isArray(channels) || !channels.length) {
		throw new TypeError('sourceChannels must contain at least one channel.');
	}
	const length = channels[0]?.length;
	if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) {
		throw new TypeError('Source channels must be array-like.');
	}
	for (const channel of channels) {
		const channelLength = channel.length;
		if ((!Array.isArray(channel) && !ArrayBuffer.isView(channel)) || channelLength !== length) {
			throw new RangeError('Source channels must be equally sized arrays.');
		}
	}
	return length;
}

export function fadeEnvelope(
	localFrame: number,
	durationFrames: number,
	fadeInFrames: number,
	fadeOutFrames: number,
): number {
	let envelope = 1;
	if (fadeInFrames > 0 && localFrame < fadeInFrames) envelope *= localFrame / fadeInFrames;
	if (fadeOutFrames > 0 && localFrame > durationFrames - fadeOutFrames) {
		envelope *= (durationFrames - localFrame) / fadeOutFrames;
	}
	return Math.max(0, envelope);
}

export function clampedLocalFrame(value: unknown, durationFrames: number, name: string): number {
	return clamp(Math.round(finiteNumber(value, name)), 0, durationFrames);
}

export function addFrames(startFrame: number, durationFrames: number, name: string): number {
	if (durationFrames > MAXIMUM_FRAME - startFrame) throw new RangeError(`${name} exceeds the safe frame range.`);
	return startFrame + durationFrames;
}

export function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return value as number;
}

export function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || (value as number) <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return value as number;
}

export function positiveFiniteNumber(value: unknown, name: string): number {
	const number = finiteNumber(value, name);
	if (number <= 0) throw new RangeError(`${name} must be positive.`);
	return number;
}

export function finiteNumber(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isFinite(number)) throw new TypeError(`${name} must be finite.`);
	return number;
}

export function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}
