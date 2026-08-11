/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	deepFreeze,
	frameTrimRecord,
	indexFrameTrimProject,
	nonEmptyString,
	positiveSafeInteger,
	safeInteger,
} from './frame-canonical-edge-trim-domain.ts';
import type {
	FrameCanonicalSlipSlideMode,
	FrameCanonicalSlipSlideRequest,
	VideoSourceTimingView,
} from './frame-canonical-slip-slide-domain.ts';
import {
	resolveFrameCanonicalSlideTargets,
	resolveFrameCanonicalSlipTargets,
} from './frame-canonical-slip-slide-targets.ts';
import {
	frameCanonicalTrimParticipant,
	frameCanonicalVideoAuthority,
} from './frame-canonical-trim-planning.ts';
import {
	shiftSourceTime,
	sourceTimeDifference,
	sourceTimeToVideoBoundary,
	videoBoundaryTime,
	videoSourceTimingView,
} from './frame-canonical-slip-slide-timing.ts';
import { isRuntimeProjectProjection } from './runtime-clip-projection.ts';

export interface FrameCanonicalSlipSlidePointerCapture {
	readonly mode: FrameCanonicalSlipSlideMode;
	readonly activeClipId: string;
	readonly pointerDownSample: number;
}

interface FrameCanonicalSlipSlidePointerAuthorityBase {
	readonly mode: FrameCanonicalSlipSlideMode;
	readonly activeClipId: string;
	readonly pointerDownSample: number;
}

export interface FrameCanonicalSlipPointerAuthority
	extends FrameCanonicalSlipSlidePointerAuthorityBase {
	readonly mode: 'slip';
	readonly sourceInFrame: number;
	readonly sourceOutFrame: number;
	readonly programDurationSamples: number;
	/** Opaque verified identity captured with the request-start project. */
	readonly timingView: VideoSourceTimingView;
}

export interface FrameCanonicalSlidePointerAuthority
	extends FrameCanonicalSlipSlidePointerAuthorityBase {
	readonly mode: 'slide';
	readonly programStartSample: number;
}

export type FrameCanonicalSlipSlidePointerAuthority =
	| FrameCanonicalSlipPointerAuthority
	| FrameCanonicalSlidePointerAuthority;

/** Capture all authority that must remain immutable for one whole-clip gesture. */
export function captureFrameCanonicalSlipSlidePointerAuthority(
	projectValue: unknown,
	timingViews: ReadonlyMap<string, VideoSourceTimingView>,
	capture: FrameCanonicalSlipSlidePointerCapture,
): FrameCanonicalSlipSlidePointerAuthority {
	if (!isRuntimeProjectProjection(projectValue)) {
		throw new TypeError('A slip/slide pointer capture requires the branded command projection.');
	}
	if (!(timingViews instanceof Map)) throw new TypeError('Video timing views must be a ReadonlyMap.');
	const project = frameTrimRecord(projectValue, 'project');
	const mode = slipSlideMode(capture?.mode);
	const activeClipId = nonEmptyString(capture?.activeClipId, 'capture.activeClipId');
	const pointerDownSample = safeInteger(capture?.pointerDownSample, 'capture.pointerDownSample');
	const index = indexFrameTrimProject(project);
	const active = frameCanonicalTrimParticipant(index, activeClipId);
	if (mode === 'slip') {
		const targets = resolveFrameCanonicalSlipTargets(project, index, activeClipId);
		const authority = frameCanonicalVideoAuthority(
			active.clip,
			targets.participants.filter(({ video }) => video !== null),
		);
		const timingView = videoSourceTimingView(timingViews, authority.source);
		if (!Object.isFrozen(timingView)) {
			throw new TypeError('A slip pointer authority requires an immutable verified timing view.');
		}
		return deepFreeze({
			mode,
			activeClipId,
			pointerDownSample,
			sourceInFrame: authority.video!.sourceIn,
			sourceOutFrame: authority.video!.sourceEnd,
			programDurationSamples: authority.timelineEnd - authority.timelineStart,
			timingView,
		});
	}
	const targets = resolveFrameCanonicalSlideTargets(project, index, activeClipId);
	const authority = frameCanonicalVideoAuthority(
		active.clip,
		targets.center.filter(({ video }) => video !== null),
	);
	return deepFreeze({
		mode,
		activeClipId,
		pointerDownSample,
		programStartSample: authority.timelineStart,
	});
}

/** Build one absolute request from the captured authority and current pointer point. */
export function buildFrameCanonicalSlipSlidePointerRequest(
	authorityValue: FrameCanonicalSlipSlidePointerAuthority,
	currentPointerSampleValue: number,
): Readonly<FrameCanonicalSlipSlideRequest> {
	const authority = pointerAuthority(authorityValue);
	const currentPointerSample = safeInteger(
		currentPointerSampleValue,
		'currentPointerSample',
	);
	const pointerDelta = BigInt(currentPointerSample) - BigInt(authority.pointerDownSample);
	if (authority.mode === 'slide') {
		return deepFreeze({
			mode: authority.mode,
			activeClipId: authority.activeClipId,
			requestedStartSample: saturatingSafeInteger(
				BigInt(authority.programStartSample) + pointerDelta,
			),
		});
	}
	const sourceInTime = videoBoundaryTime(authority.timingView, authority.sourceInFrame);
	const sourceOutTime = videoBoundaryTime(authority.timingView, authority.sourceOutFrame);
	const sourceDuration = sourceTimeDifference(sourceOutTime, sourceInTime);
	if (sourceDuration.numerator <= 0n) {
		throw new RangeError('A slip pointer source span must be positive.');
	}
	const pointerTime = {
		numerator: pointerDelta * sourceDuration.numerator,
		denominator: BigInt(authority.programDurationSamples) * sourceDuration.denominator,
	};
	const targetTime = shiftSourceTime(sourceInTime, pointerTime);
	const requestedSourceInFrame = authority.timingView.kind === 'cfr'
		? saturatingPointRound(
			targetTime.numerator * BigInt(authority.timingView.rate.num),
			targetTime.denominator * BigInt(authority.timingView.rate.den),
		)
		: sourceTimeToVideoBoundary(authority.timingView, targetTime);
	return deepFreeze({
		mode: authority.mode,
		activeClipId: authority.activeClipId,
		requestedSourceInFrame,
	});
}

function pointerAuthority(value: unknown): FrameCanonicalSlipSlidePointerAuthority {
	const authority = frameTrimRecord(value, 'pointer authority');
	const mode = slipSlideMode(authority.mode);
	const activeClipId = nonEmptyString(authority.activeClipId, 'pointer authority.activeClipId');
	const pointerDownSample = safeInteger(
		authority.pointerDownSample,
		'pointer authority.pointerDownSample',
	);
	if (mode === 'slide') {
		return {
			mode,
			activeClipId,
			pointerDownSample,
			programStartSample: safeInteger(
				authority.programStartSample,
				'pointer authority.programStartSample',
			),
		};
	}
	if (!authority.timingView || typeof authority.timingView !== 'object') {
		throw new TypeError('A slip pointer authority requires a timing view.');
	}
	const sourceInFrame = safeInteger(
		authority.sourceInFrame,
		'pointer authority.sourceInFrame',
	);
	const sourceOutFrame = safeInteger(
		authority.sourceOutFrame,
		'pointer authority.sourceOutFrame',
	);
	if (sourceOutFrame <= sourceInFrame) {
		throw new RangeError('A slip pointer source span must be positive.');
	}
	return {
		mode,
		activeClipId,
		pointerDownSample,
		sourceInFrame,
		sourceOutFrame,
		programDurationSamples: positiveSafeInteger(
			authority.programDurationSamples,
			'pointer authority.programDurationSamples',
		),
		timingView: authority.timingView as VideoSourceTimingView,
	};
}

function slipSlideMode(value: unknown): FrameCanonicalSlipSlideMode {
	if (value !== 'slip' && value !== 'slide') {
		throw new RangeError(`Unsupported slip/slide pointer mode: ${String(value)}.`);
	}
	return value;
}

function saturatingSafeInteger(value: bigint): number {
	const maximum = BigInt(Number.MAX_SAFE_INTEGER);
	const minimum = BigInt(Number.MIN_SAFE_INTEGER);
	if (value > maximum) return Number.MAX_SAFE_INTEGER;
	if (value < minimum) return Number.MIN_SAFE_INTEGER;
	return Number(value);
}

function saturatingPointRound(numerator: bigint, denominator: bigint): number {
	if (denominator <= 0n) throw new RangeError('A pointer timing denominator must be positive.');
	const quotient = numerator / denominator;
	const remainder = numerator % denominator;
	const rounded = remainder !== 0n && absoluteBigInt(remainder) * 2n >= denominator
		? quotient + (numerator < 0n ? -1n : 1n)
		: quotient;
	return saturatingSafeInteger(rounded);
}

function absoluteBigInt(value: bigint): bigint {
	return value < 0n ? -value : value;
}
