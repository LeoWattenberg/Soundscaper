/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned H.264 candidates and argv mapping; never part of a renderer plan. */

import { resolveVideoDeliveryWebCodecsBitrate } from '../src/common/editor/video-delivery-quality.js';
import type { DesktopVideoCodecOperationPlan } from './desktop-video-codec-operation-contract.js';

export type DesktopVideoH264Encoder = 'libx264' | 'h264_videotoolbox' | 'h264_mf';

const H264_ENCODERS: readonly DesktopVideoH264Encoder[] = Object.freeze([
	'libx264', 'h264_videotoolbox', 'h264_mf',
]);

/** Token eligibility is only the input to execution verification. */
export function desktopVideoH264EncoderCandidates(
	value: unknown,
	platform: NodeJS.Platform = process.platform,
): readonly DesktopVideoH264Encoder[] {
	const capabilities = record(value)?.capabilities;
	const encoders = record(capabilities)?.encoders;
	const tokens = new Set(Array.isArray(encoders) ? encoders : []);
	const native = platform === 'darwin' ? 'h264_videotoolbox'
		: platform === 'win32' ? 'h264_mf' : null;
	const candidates: readonly DesktopVideoH264Encoder[] = native ? [native, 'libx264'] : ['libx264'];
	return Object.freeze(candidates.filter((encoder) => tokens.has(encoder)));
}

/** Replace only the fixed x264 codec row, preserving main-owned endpoints and timing. */
export function withDesktopVideoH264Encoder(
	arguments_: readonly string[],
	plan: DesktopVideoCodecOperationPlan,
	encoder: DesktopVideoH264Encoder,
): readonly string[] {
	if (!H264_ENCODERS.includes(encoder)) throw new RangeError('Desktop video H264 encoder is unsupported.');
	if (encoder === 'libx264') return arguments_;
	if (plan.format !== 'mp4') throw new RangeError('A native H264 encoder requires MP4 delivery.');
	const index = arguments_.indexOf('-c:v');
	if (index < 0 || arguments_[index + 1] !== 'libx264'
		|| arguments_[index + 2] !== '-preset' || arguments_[index + 4] !== '-crf') {
		throw new Error('Desktop native H264 mapping requires the fixed admitted codec row.');
	}
	// OS rate control needs a bitrate. Keep miniature deliveries above a useful
	// floor while reading normal picture geometry from the shared quality tier.
	const bitrate = Math.max(64_000, resolveVideoDeliveryWebCodecsBitrate('h264', plan.quality, plan));
	return Object.freeze([
		...arguments_.slice(0, index), '-c:v', encoder, '-b:v', String(bitrate),
		...(encoder === 'h264_videotoolbox' ? ['-allow_sw', '1'] : []),
		...arguments_.slice(index + 6),
	]);
}

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown> : null;
}
