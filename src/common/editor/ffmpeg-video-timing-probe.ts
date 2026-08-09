/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	VIDEO_TIMING_ASSET_MAXIMUM_FRAMES,
	VIDEO_TIMING_ASSET_MAXIMUM_TIMESCALE,
	type VideoTimingAssetInput,
} from './video-timing-asset.ts';
import { normalizeRational, type RationalRate } from './timeline-time.ts';

export interface FfmpegVideoTimingProbeResult extends VideoTimingAssetInput {
	readonly nominalRate: RationalRate;
}

const CONFIG = /config in time_base:\s*(\d+)\s*\/\s*(\d+),\s*frame_rate:\s*(\d+)\s*\/\s*(\d+)/iu;
const FRAME = /\bn:\s*(\d+)\s+pts:\s*(-?\d+)/iu;
const DURATION = /\bduration:\s*(-?\d+)/iu;

/** Ask for one sentinel frame beyond the persisted ceiling so oversized media cannot be silently truncated. */
export function buildFfmpegVideoTimingProbeArgs(input: string): readonly string[] {
	if (typeof input !== 'string' || !input) throw new TypeError('An FFmpeg timing-probe input path is required.');
	return Object.freeze([
		'-hide_banner', '-nostdin', '-i', input,
		'-map', '0:v:0', '-an', '-sn', '-dn',
		'-vf', 'showinfo', '-fps_mode', 'passthrough',
		'-frames:v', String(VIDEO_TIMING_ASSET_MAXIMUM_FRAMES + 1),
		'-f', 'null', '-',
	]);
}

/** Parse the integer time base and per-frame PTS emitted by FFmpeg's showinfo filter. */
export function parseFfmpegVideoTimingLogs(
	lines: readonly string[],
): Readonly<FfmpegVideoTimingProbeResult> {
	if (!Array.isArray(lines)) throw new TypeError('FFmpeg timing logs must be an array.');
	let timeBaseNumerator = 0;
	let timescale = 0;
	let nominalRate: RationalRate | null = null;
	const frames = new Map<number, Readonly<{ pts: bigint; duration: bigint | null }>>();
	for (const line of lines) {
		if (typeof line !== 'string') throw new TypeError('Every FFmpeg timing log must be text.');
		const config = CONFIG.exec(line);
		if (config) {
			timeBaseNumerator = positiveSafeInteger(config[1], 'FFmpeg time-base numerator');
			timescale = positiveSafeInteger(config[2], 'FFmpeg time-base denominator');
			if (timescale > VIDEO_TIMING_ASSET_MAXIMUM_TIMESCALE) {
				throw new RangeError('FFmpeg video timescale exceeds the timing-asset bound.');
			}
			const rate = normalizeRational({
				num: positiveSafeInteger(config[3], 'FFmpeg frame-rate numerator'),
				den: positiveSafeInteger(config[4], 'FFmpeg frame-rate denominator'),
			});
			if (rate.num <= 0) throw new RangeError('FFmpeg reported a non-positive video rate.');
			nominalRate = rate;
		}
		if (!line.includes('showinfo')) continue;
		const frame = FRAME.exec(line);
		if (!frame) continue;
		const index = nonNegativeSafeInteger(frame[1], 'FFmpeg frame index');
		if (index >= VIDEO_TIMING_ASSET_MAXIMUM_FRAMES) {
			throw new RangeError('FFmpeg video frame count exceeds the timing-asset bound.');
		}
		const pts = BigInt(frame[2]);
		const durationValue = DURATION.exec(line)?.[1];
		const duration = durationValue == null || BigInt(durationValue) <= 0n ? null : BigInt(durationValue);
		const previous = frames.get(index);
		if (previous && (previous.pts !== pts || previous.duration !== duration)) {
			throw new Error(`FFmpeg reported conflicting timing for frame ${String(index)}.`);
		}
		frames.set(index, Object.freeze({ pts, duration }));
	}
	if (!timeBaseNumerator || !timescale || !nominalRate || !frames.size) {
		throw new Error('FFmpeg did not report a complete video timing stream.');
	}
	const ordered = [...frames.entries()].sort(([left], [right]) => left - right);
	for (const [offset, [index]] of ordered.entries()) if (index !== offset) {
		throw new Error('FFmpeg video timing frames are not contiguous.');
	}
	const origin = ordered[0][1].pts;
	const presentationTicks = ordered.map(([, frame]) => (frame.pts - origin) * BigInt(timeBaseNumerator));
	for (let index = 1; index < presentationTicks.length; index += 1) {
		if (presentationTicks[index] <= presentationTicks[index - 1]) {
			throw new Error('FFmpeg video presentation timestamps are not strictly increasing.');
		}
	}
	const finalFrame = ordered.at(-1)![1];
	const finalFrameDurationTicks = finalFrame.duration == null
		? presentationTicks.length > 1
			? presentationTicks.at(-1)! - presentationTicks.at(-2)!
			: roundedPositiveRatio(
				BigInt(timescale) * BigInt(nominalRate.den),
				BigInt(nominalRate.num),
			)
		: finalFrame.duration * BigInt(timeBaseNumerator);
	if (finalFrameDurationTicks <= 0n) throw new Error('FFmpeg reported a non-positive final-frame duration.');
	return Object.freeze({
		timescale,
		presentationTicks: Object.freeze(presentationTicks),
		finalFrameDurationTicks,
		nominalRate: Object.freeze(nominalRate),
	});
}

function roundedPositiveRatio(numerator: bigint, denominator: bigint): bigint {
	if (numerator <= 0n || denominator <= 0n) throw new RangeError('A positive timing ratio is required.');
	return (numerator * 2n + denominator) / (denominator * 2n);
}

function positiveSafeInteger(value: unknown, name: string): number {
	const result = Number(value);
	if (!Number.isSafeInteger(result) || result <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return result;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	const result = Number(value);
	if (!Number.isSafeInteger(result) || result < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return result;
}
