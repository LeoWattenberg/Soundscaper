/* SPDX-License-Identifier: AGPL-3.0-only */
import { encodeMotionChannel, validateMotionSurface, type MotionSurface } from './motion-surface.ts';
import { motionInteger } from './motion-values.ts';
import { normalizeMotionRenderPlan, type MotionRenderPlan } from './controller/export/motion-render-pipeline.ts';
import { normalizeMotionAudioFormat } from './motion-audio-contract.ts';

export type MotionVideoFormat = 'mp4' | 'webm';
export type MotionVideoBackground = readonly [number, number, number];
/** Mediabunny 1.55.3 writes WebM TimecodeScale=1 ms. It rounds each absolute
 * timestamp and packet duration independently, so endpoint error is bounded
 * by one quantum without accumulating across the authored frame range. */
export const MOTION_WEBM_TIMECODE_QUANTUM_SECONDS = 0.001;
export interface MotionVideoAudioOptions { readonly sampleRate: number; readonly channels: 1 | 2; readonly bitrate?: number }
export interface MotionVideoAudioDelivery extends MotionVideoAudioOptions {
	readonly codec: 'aac' | 'opus'; readonly bitrate: number; readonly sampleCount: number; readonly maximumPacketCount: number;
}
export function motionVideoAudioBoundary(frame: number, plan: MotionRenderPlan, sampleRate: number): number {
	const numerator = BigInt(frame) * BigInt(sampleRate) * BigInt(plan.frameRate.den); const denominator = BigInt(plan.frameRate.num);
	const count = (numerator + denominator - 1n) / denominator;
	if (count > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Motion video exceeds exact audio sample coordinates.');
	return Number(count);
}
/** Audio indexes and one-frame interleaving queues have separate finite admission. */
export function normalizeMotionVideoAudio(plan: MotionRenderPlan, format: MotionVideoFormat, options: MotionVideoAudioOptions): MotionVideoAudioDelivery {
	const audio = normalizeMotionAudioFormat({ ...options, sampleCount: 0 });
	if (audio.sampleRate !== 48000) throw new RangeError('Browser motion video audio currently requires 48000 Hz.');
	if (motionVideoAudioBoundary(1, plan, audio.sampleRate) > 65536) throw new RangeError('Audio/video interleaving requires at most 65536 samples per video frame.');
	const sampleCount = motionVideoAudioBoundary(plan.frameCount, plan, audio.sampleRate);
	const maximumPacketCount = Math.ceil(sampleCount / 960) + 8;
	if (maximumPacketCount > 32768) throw new RangeError('The selected range exceeds browser audio packet index admission. Choose a shorter work area.');
	return Object.freeze({ ...audio, sampleCount, maximumPacketCount, codec: format === 'mp4' ? 'aac' : 'opus',
		bitrate: motionInteger(options.bitrate ?? 128000, 'audio bitrate', 32000, 320000) });
}
export interface MotionVideoDelivery {
	readonly plan: MotionRenderPlan; readonly format: MotionVideoFormat;
	readonly bitrate: number; readonly background: MotionVideoBackground;
}
/** The pinned muxer retains packet indexes: admit that finite closure before acquiring output. */
export function normalizeMotionVideoDelivery(options: { readonly plan: MotionRenderPlan; readonly format: MotionVideoFormat;
	readonly bitrate?: number; readonly background?: MotionVideoBackground }): MotionVideoDelivery {
	const plan = normalizeMotionRenderPlan(options.plan);
	if (options.format !== 'mp4' && options.format !== 'webm') throw new TypeError('Unknown motion video container.');
	if (plan.frameCount > 32768) throw new RangeError('The selected video range is too long for browser export. Choose a shorter work area or a PNG sequence.');
	if (options.format === 'mp4' && (plan.width % 2 !== 0 || plan.height % 2 !== 0)) throw new RangeError('MP4 delivery requires even canvas dimensions.');
	const rate = plan.frameRate.num / plan.frameRate.den;
	if (rate > 240 || rate < 0.001) throw new RangeError('Browser video delivery requires a frame rate between 0.001 and 240 fps.');
	const background = [...options.background ?? [0, 0, 0]] as [number, number, number];
	if (background.length !== 3 || background.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) throw new TypeError('Video background must be a linear SDR color.');
	motionVideoFrameTimestamp(plan.frameCount, plan.frameRate);
	return Object.freeze({ plan, format: options.format, bitrate: motionInteger(options.bitrate ?? 8_000_000, 'video bitrate', 100_000, 200_000_000), background: Object.freeze(background) });
}
/** Integer microseconds, rounded only once from exact rational frame coordinates. */
export function motionVideoFrameTimestamp(index: number, rate: Readonly<{ num: number; den: number }>): number {
	motionInteger(index, 'video frame index'); motionInteger(rate.num, 'video rate numerator', 1); motionInteger(rate.den, 'video rate denominator', 1);
	const numerator = BigInt(index) * 1_000_000n * BigInt(rate.den); const denominator = BigInt(rate.num);
	const timestamp = (numerator * 2n + denominator) / (denominator * 2n);
	if (timestamp > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Motion video timestamp exceeds exact microsecond coordinates.');
	return Number(timestamp);
}
/** Opaque containers flatten coverage in linear light, then encode full-range Rec.709 RGB. */
export function motionVideoPixels(surface: MotionSurface, background: MotionVideoBackground): Uint8Array<ArrayBuffer> {
	validateMotionSurface(surface);
	const bytes = new Uint8Array(surface.pixels.length);
	for (let index = 0; index < bytes.length; index += 4) {
		const remaining = 1 - surface.pixels[index + 3]!;
		for (let channel = 0; channel < 3; channel++) bytes[index + channel] = Math.round(255 * encodeMotionChannel(Math.min(1, surface.pixels[index + channel]! + background[channel]! * remaining), 'rec709'));
		bytes[index + 3] = 255;
	}
	return bytes;
}
