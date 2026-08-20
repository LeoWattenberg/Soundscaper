/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FramescaperCaptureSessionManifestV1,
	FramescaperCaptureStreamManifestV1,
} from '../framescaper-capture-session-manifest.ts';

export function timestamp(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be non-negative.`);
	return value;
}

export function sameManifest(
	left: FramescaperCaptureSessionManifestV1,
	right: FramescaperCaptureSessionManifestV1,
): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

export function sameManifestEvidence(
	left: FramescaperCaptureSessionManifestV1,
	right: FramescaperCaptureSessionManifestV1,
): boolean {
	const evidence = (manifest: FramescaperCaptureSessionManifestV1) => ({
		version: manifest.version,
		sessionId: manifest.sessionId,
		generation: manifest.generation,
		projectFence: manifest.projectFence,
		origin: manifest.origin,
		clock: manifest.clock,
		streams: manifest.streams.map(({ playability: _playability, ...stream }) => stream),
		createdAt: manifest.createdAt,
	});
	return JSON.stringify(evidence(left)) === JSON.stringify(evidence(right));
}

export function packetTiming(
	stream: FramescaperCaptureStreamManifestV1,
	presentationTimeUs: number,
	durationUs: number,
): FramescaperCaptureStreamManifestV1['timing'] {
	return Object.freeze({
		firstPresentationMicroseconds: stream.timing.firstPresentationMicroseconds ?? presentationTimeUs,
		lastPresentationEndMicroseconds: exactSum(
			presentationTimeUs,
			durationUs,
			'Framescaper capture packet presentation end',
		),
	});
}

export function exactSum(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} exceeds the safe integer range.`);
	return result;
}
