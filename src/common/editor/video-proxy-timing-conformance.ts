/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	boundVideoSourceTimingViewInfo,
	videoSourceFrameTime,
	type BoundVideoSourceTimingView,
} from './video-source-timing-view.ts';

export const VIDEO_PROXY_TIMING_MAXIMUM_FRAMES = 2_000_000;

export interface VideoProxyTimingConformanceInfo {
	readonly kind: 'video-proxy-timing-conformance';
	readonly version: 1;
	readonly rule: 'exact-presentation-boundaries-v1';
	readonly originalSourceId: string;
	readonly proxySourceId: string;
	readonly frameCount: number;
	readonly boundaryCount: number;
}

export interface VideoProxyTimingConformance {
	readonly kind: 'video-proxy-timing-conformance';
	readonly version: 1;
}

const VIDEO_PROXY_TIMING_CONFORMANCES = new WeakMap<
	object,
	VideoProxyTimingConformanceInfo
>();

/** Prove that two authenticated source views own exactly the same picture boundaries. */
export function proveVideoProxyTimingConformance(
	original: BoundVideoSourceTimingView,
	proxy: BoundVideoSourceTimingView,
): VideoProxyTimingConformance {
	const originalInfo = boundVideoSourceTimingViewInfo(original);
	const proxyInfo = boundVideoSourceTimingViewInfo(proxy);
	const originalSourceId = originalInfo.sourceId;
	const proxySourceId = proxyInfo.sourceId;
	const frameCount = originalInfo.frameCount;

	if (!originalSourceId || !proxySourceId) {
		throw new TypeError('Video proxy timing requires non-empty source identities.');
	}
	if (originalSourceId === proxySourceId) {
		throw new RangeError('The original and proxy source identities must be distinct.');
	}
	if (!Number.isSafeInteger(frameCount) || frameCount <= 0
		|| !Number.isSafeInteger(proxyInfo.frameCount) || proxyInfo.frameCount <= 0) {
		throw new RangeError('Video proxy timing frame counts must be positive safe integers.');
	}
	if (frameCount !== proxyInfo.frameCount) {
		throw new RangeError('Video proxy timing frame counts must match exactly.');
	}
	if (frameCount > VIDEO_PROXY_TIMING_MAXIMUM_FRAMES) {
		throw new RangeError('Video proxy timing frame count exceeds its maximum bound.');
	}

	if (originalInfo.kind === 'cfr' && proxyInfo.kind === 'cfr') {
		assertSameExactBoundary(original, proxy, 1);
	} else {
		for (let boundary = 0; boundary <= frameCount; boundary += 1) {
			assertSameExactBoundary(original, proxy, boundary);
		}
	}

	const proof: VideoProxyTimingConformance = Object.freeze({
		kind: 'video-proxy-timing-conformance',
		version: 1,
	});
	const info: VideoProxyTimingConformanceInfo = Object.freeze({
		kind: 'video-proxy-timing-conformance',
		version: 1,
		rule: 'exact-presentation-boundaries-v1',
		originalSourceId,
		proxySourceId,
		frameCount,
		boundaryCount: frameCount + 1,
	});
	VIDEO_PROXY_TIMING_CONFORMANCES.set(proof, info);
	return proof;
}

/** Read diagnostic facts only from the exact live proof identity this module issued. */
export function videoProxyTimingConformanceInfo(
	proof: VideoProxyTimingConformance,
): VideoProxyTimingConformanceInfo {
	if (!proof || typeof proof !== 'object') {
		throw new TypeError('An authenticated video proxy timing conformance proof is required.');
	}
	const info = VIDEO_PROXY_TIMING_CONFORMANCES.get(proof);
	if (!info) {
		throw new TypeError('An authenticated video proxy timing conformance proof is required.');
	}
	return info;
}

function assertSameExactBoundary(
	original: BoundVideoSourceTimingView,
	proxy: BoundVideoSourceTimingView,
	boundary: number,
): void {
	const position = Object.freeze({ numerator: BigInt(boundary), denominator: 1n });
	const originalTime = videoSourceFrameTime(original, position);
	const proxyTime = videoSourceFrameTime(proxy, position);
	if (originalTime.numerator !== proxyTime.numerator
		|| originalTime.denominator !== proxyTime.denominator) {
		throw new RangeError(`Video proxy timing boundary ${String(boundary)} does not conform exactly.`);
	}
}
