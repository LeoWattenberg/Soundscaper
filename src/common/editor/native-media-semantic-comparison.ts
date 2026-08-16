/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * How a native render is compared with the Web render of the same canonical
 * plan.
 *
 * Encoded bytes are not the comparison. Two conforming encoders — and the same
 * encoder on two hardware backends — legitimately produce different bitstreams
 * for the same semantic plan, so requiring byte identity would either forbid
 * hardware acceleration outright or force a false claim. What must agree is the
 * meaning: a lossless path is pixel exact, a lossy path stays within the
 * registered SSIM and PSNR thresholds, and the audio and video endpoints stay
 * within one output frame of each other.
 *
 * The thresholds themselves are the milestone-5B acceptance numbers and are not
 * negotiable per call site; a caller supplies measurements, never limits.
 */

/** Lossy comparisons require at least this structural similarity. */
export const NATIVE_MEDIA_MINIMUM_SSIM = 0.995;

/** Lossy comparisons require at least this peak signal-to-noise ratio. */
export const NATIVE_MEDIA_MINIMUM_PSNR_DB = 45;

/** A/V endpoints may differ by no more than one output frame. */
export const NATIVE_MEDIA_MAXIMUM_ENDPOINT_FRAME_DELTA = 1;

export type NativeMediaComparisonMode = 'lossless' | 'lossy';

export const NATIVE_MEDIA_COMPARISON_FAILURES = Object.freeze([
	'plan-fingerprint-diverged',
	'frame-count-diverged',
	'pixel-mismatch-in-lossless-path',
	'ssim-below-threshold',
	'psnr-below-threshold',
	'endpoint-drift-exceeded',
] as const);

export type NativeMediaComparisonFailure = (typeof NATIVE_MEDIA_COMPARISON_FAILURES)[number];

export interface NativeMediaComparisonMeasurementV1 {
	readonly mode: NativeMediaComparisonMode;
	/** Fingerprints of the canonical plan each side actually executed. */
	readonly referencePlanFingerprint: string;
	readonly candidatePlanFingerprint: string;
	readonly referenceFrameCount: number;
	readonly candidateFrameCount: number;
	/** Frames that differ by any pixel. Only meaningful for a lossless path. */
	readonly mismatchedFrameCount?: number;
	readonly ssim?: number;
	readonly psnrDb?: number;
	/** Signed difference, in output frames, between the audio and video ends. */
	readonly endpointFrameDelta: number;
}

export interface NativeMediaComparisonVerdictV1 {
	readonly agreed: boolean;
	readonly mode: NativeMediaComparisonMode;
	readonly failures: readonly NativeMediaComparisonFailure[];
}

export class NativeMediaComparisonError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NativeMediaComparisonError';
	}
}

/**
 * Judge one comparison. Every failure is collected rather than short-circuited,
 * because a report that names only the first divergence sends the next
 * investigation down one path at a time.
 */
export function evaluateNativeMediaSemanticComparison(
	measurement: NativeMediaComparisonMeasurementV1,
): NativeMediaComparisonVerdictV1 {
	const mode = assertMode(measurement.mode);
	const failures: NativeMediaComparisonFailure[] = [];
	if (fingerprint(measurement.referencePlanFingerprint) !== fingerprint(measurement.candidatePlanFingerprint)) {
		failures.push('plan-fingerprint-diverged');
	}
	if (frameCount(measurement.referenceFrameCount, 'reference')
		!== frameCount(measurement.candidateFrameCount, 'candidate')) {
		failures.push('frame-count-diverged');
	}
	if (mode === 'lossless') {
		if (mismatchedFrames(measurement.mismatchedFrameCount) !== 0) {
			failures.push('pixel-mismatch-in-lossless-path');
		}
	} else {
		if (ratio(measurement.ssim, 'ssim') < NATIVE_MEDIA_MINIMUM_SSIM) {
			failures.push('ssim-below-threshold');
		}
		if (decibels(measurement.psnrDb) < NATIVE_MEDIA_MINIMUM_PSNR_DB) {
			failures.push('psnr-below-threshold');
		}
	}
	if (Math.abs(endpointDelta(measurement.endpointFrameDelta)) > NATIVE_MEDIA_MAXIMUM_ENDPOINT_FRAME_DELTA) {
		failures.push('endpoint-drift-exceeded');
	}
	return Object.freeze({
		agreed: failures.length === 0,
		mode,
		failures: Object.freeze(failures),
	});
}

function assertMode(value: unknown): NativeMediaComparisonMode {
	if (value !== 'lossless' && value !== 'lossy') {
		throw new NativeMediaComparisonError('A native media comparison must declare a lossless or lossy mode.');
	}
	return value;
}

function fingerprint(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
		throw new NativeMediaComparisonError('A native media comparison requires both canonical plan fingerprints.');
	}
	return value;
}

function frameCount(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new NativeMediaComparisonError(`A native media comparison requires a ${label} frame count.`);
	}
	return value as number;
}

function mismatchedFrames(value: unknown): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new NativeMediaComparisonError('A lossless native media comparison requires a mismatched-frame count.');
	}
	return value as number;
}

function ratio(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
		throw new NativeMediaComparisonError(`A lossy native media comparison requires a measured ${label} in [0, 1].`);
	}
	return value;
}

/**
 * PSNR is +Infinity when the two frames carry no error at all, which is what a
 * measuring tool prints for an identical pair and the best result a lossy path
 * can reach; it clears every threshold rather than failing the comparison.
 */
function decibels(value: unknown): number {
	if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
		throw new NativeMediaComparisonError('A lossy native media comparison requires a measured PSNR in decibels.');
	}
	return value;
}

function endpointDelta(value: unknown): number {
	if (!Number.isSafeInteger(value)) {
		throw new NativeMediaComparisonError('A native media comparison requires an integer endpoint frame delta.');
	}
	return value as number;
}
