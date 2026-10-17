/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionExpressionAudioPreparation } from './motion-expression-audio-preparation.ts';
import type { MotionAsset } from './motion-asset.ts';
import type { MotionscaperRevision } from './motion-project-revision.ts';
import { normalizeRational, type Rational, type RationalInput } from './timeline-time.ts';
import { motionId, motionInteger } from './motion-values.ts';

export type MotionAudioAsset = Extract<MotionAsset, { kind: 'audio' | 'footage' }>;
export interface MotionAudioFormat { readonly sampleRate: number; readonly channels: 1 | 2; readonly sampleCount: number }
export interface MotionAudioReadRequest { readonly asset: MotionAudioAsset; readonly startSample: number; readonly sampleCount: number }
/** Provider retains/validates the asset digest and decodes only the requested native-rate window. */
export interface MotionAudioSampleProvider {
	describe(asset: MotionAudioAsset, signal?: AbortSignal): Promise<MotionAudioFormat>;
	read(request: MotionAudioReadRequest, signal?: AbortSignal): Promise<Float32Array>;
}
export interface MotionAudioBlockRequest {
	readonly compositionId: string; readonly startSample: RationalInput;
	readonly sampleRate: number; readonly sampleCount: number; readonly channels: 1 | 2;
}
export interface MotionAudioMixBlock extends Omit<MotionAudioBlockRequest, 'startSample'> {
	readonly startSample: Rational; readonly interleaved: Float32Array;
	readonly projectId: string; readonly revision: number; readonly revisionDigest: string;
}
export interface MotionAudioMixerOptions {
	readonly project: unknown; readonly provider: MotionAudioSampleProvider;
	/** A shared preparation lease remains owned by the caller; omitted leases are created/disposed by the mixer. */
	readonly expressionAudio?: MotionExpressionAudioPreparation;
	readonly maximumCacheBytes?: number; readonly maximumBlockSamples?: number;
	readonly maximumEvaluatedOccurrences?: number;
}
export interface MotionAudioMixer {
	readonly revision: MotionscaperRevision;
	mixBlock(request: MotionAudioBlockRequest, signal?: AbortSignal): Promise<MotionAudioMixBlock>;
	snapshot(): Readonly<{ cacheBytes: number; cacheWindows: number; rendering: boolean; disposed: boolean }>;
	dispose(): void;
}
export const MOTION_AUDIO_MAX_BLOCK_SAMPLES = 65536;
export const MOTION_AUDIO_WINDOW_SAMPLES = 4096;

export function normalizeMotionAudioFormat(format: Readonly<{ sampleRate: number; channels: number; sampleCount: number }>): MotionAudioFormat {
	const sampleRate = motionInteger(format.sampleRate, 'audio sample rate', 8000, 768000);
	const sampleCount = motionInteger(format.sampleCount, 'audio sample count', 0, Number.MAX_SAFE_INTEGER);
	if (format.channels !== 1 && format.channels !== 2) throw new RangeError('Motion audio currently requires a declared mono or stereo layout.');
	return Object.freeze({ sampleRate, sampleCount, channels: format.channels });
}
export function normalizeMotionAudioBlockRequest(request: MotionAudioBlockRequest, maximumSamples = MOTION_AUDIO_MAX_BLOCK_SAMPLES): MotionAudioBlockRequest & { readonly startSample: Rational } {
	const sampleCount = motionInteger(request.sampleCount, 'audio block sample count', 1, maximumSamples);
	const format = normalizeMotionAudioFormat({ sampleRate: request.sampleRate, channels: request.channels, sampleCount });
	const startSample = normalizeRational(request.startSample, { maximumDenominator: Number.MAX_SAFE_INTEGER });
	return Object.freeze({ compositionId: motionId(request.compositionId), startSample, ...format });
}
export function validateMotionAudioWindow(interleaved: Float32Array, sampleCount: number, format: MotionAudioFormat): void {
	if (!(interleaved instanceof Float32Array) || interleaved.length !== sampleCount * format.channels) throw new RangeError('Motion audio provider returned an invalid interleaved window length.');
	if (interleaved.some((value) => !Number.isFinite(value))) throw new RangeError('Motion audio provider samples must be finite.');
}
